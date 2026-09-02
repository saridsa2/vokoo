//! Reading a finished call into a shape.
//!
//! The node names a shape. **The model is the workspace's** —
//! `organizations.intelligence_provider` and `intelligence_model` — because one
//! organisation reads its calls with one model, and a copy of that choice on
//! every node is four places for it to disagree with itself. Changing what
//! reads your calls is one row, not one board per flow.
//!
//! **A one-shot HTTP call, not the pipeline's LLM handler.** `OpenAILLMHandler`
//! is a `FrameProcessor` built to stream into a live conversation with an
//! aggregator either side of it. This is one request and one object, with
//! nobody on the line. Reusing the pipeline handler here would drag the whole
//! frame machinery off the call path to do something a small client does
//! better.

use serde_json::{json, Value};

use super::graph::{vendor_secret, FlowNode};

/// Where a provider's Anthropic-shaped Messages API lives.
///
/// One request shape, not three. The first version of this node asked an
/// OpenAI-compatible endpoint for `json_object` and parsed whatever came
/// back — and the first real test returned a reasoning model's `<think>`
/// block. The obvious next move was to strip tags and balance braces, which is
/// a parser that is wrong in a new way every time a model changes.
///
/// The answer is to let the provider enforce the shape. Anthropic's Messages
/// API takes `output_config.format` with a JSON schema and returns something
/// that conforms, so this parses once and never repairs. **MiniMax serves the
/// same API** at `/anthropic`, so both providers are one code path and one
/// host lookup.
///
/// OpenAI is deliberately absent: its `json_schema` mode refuses a schema whose
/// objects do not declare `additionalProperties: false`, which would mean
/// translating a shape somebody wrote into a provider's dialect. Worth doing
/// when somebody wants OpenAI; not worth doing to have a second way to do this.
fn host(provider: &str) -> Option<&'static str> {
    match provider {
        "anthropic" => Some("https://api.anthropic.com/v1"),
        // The SDK base ends at `/anthropic` and the SDK appends `/v1/messages`.
        "minimax" => Some("https://api.minimax.io/anthropic/v1"),
        _ => None,
    }
}

/// The one tool the model is given, and required to call. Its arguments are the
/// reading.
const RECORD_TOOL: &str = "record_the_call";

/// Fill in the node's shape from the call.
///
/// Returns the outcome the flow branches on, and what was extracted.
pub async fn run(
    base: &str,
    key: &str,
    org_id: &str,
    node: &FlowNode,
    context: &Value,
    call_id: &str,
    // Read the call, and write nothing.
    //
    // A dry run still asks the model — seeing what it extracts is the point of
    // running one — but must not overwrite the reading on a finished call. A
    // test that changes the record it is testing against is not a test.
    dry: bool,
) -> (String, Option<Value>) {
    let transcript = context.get("transcript").cloned().unwrap_or(json!([]));
    let lines = transcript.as_array().map(Vec::len).unwrap_or(0);

    // A call where nothing was said has nothing to read. Asked to fill a shape
    // from an empty transcript a model does not decline — it invents a
    // plausible lead, which then goes to a CRM as though somebody said it.
    // Its own branch, because "we could not reach the model" and "there was
    // nothing there" want different handling.
    if lines == 0 {
        log::info!("[intelligence] the call has no transcript — nothing to read");
        return ("empty".to_string(), None);
    }

    let Some(shape_id) = node.config_str("shape_id").filter(|id| !id.is_empty()) else {
        log::warn!("[intelligence] no shape chosen");
        return ("failed".to_string(), None);
    };

    let shape = match load_shape(base, key, shape_id).await {
        Ok(shape) => shape,
        Err(problem) => {
            log::warn!("[intelligence] {problem}");
            return ("failed".to_string(), None);
        }
    };

    // The workspace's reader, not the node's. One organisation reads its calls
    // with one model, and a copy on every node meant changing it involved
    // opening every board and hoping you found them all.
    let (provider, model) = match reader(base, key, org_id).await {
        Some(chosen) => chosen,
        None => {
            log::warn!("[intelligence] could not read the organisation's intelligence provider");
            return ("failed".to_string(), None);
        }
    };
    let (provider, model) = (provider.as_str(), model.as_str());
    let Some(host) = host(provider) else {
        log::warn!(
            "[intelligence] {provider} does not serve the Messages API — use anthropic or minimax"
        );
        return ("failed".to_string(), None);
    };

    let secret = match vendor_secret(base, key, org_id, provider).await {
        Some(secret) => secret,
        None => {
            log::warn!("[intelligence] no {provider} key is connected for this organisation");
            return ("failed".to_string(), None);
        }
    };

    let extracted = match ask(host, &secret, model, &shape, context, node.config_str("instruction")).await {
        Ok(value) => value,
        Err(problem) => {
            log::warn!("[intelligence] {provider}/{model}: {problem}");
            return ("failed".to_string(), None);
        }
    };

    // Written to the call **before** anything is sent anywhere. A restart after
    // this point loses a delivery; it never loses the reading. That is most of
    // what a durable queue buys, and the queue can arrive the first time an
    // outage costs something.
    if !dry {
        if let Err(problem) = store(base, key, call_id, &extracted).await {
            log::warn!("[intelligence] could not write the reading to the call: {problem}");
        }
    }

    log::info!("[intelligence] filled in {} field(s) from {lines} line(s)",
        extracted.as_object().map(|o| o.len()).unwrap_or(0));
    ("ok".to_string(), Some(extracted))
}

/// Which model this organisation reads its calls with.
///
/// On the organisation rather than the node, for the same reason the schema is
/// in a registry: it is one decision, and a copy of it on every node is four
/// places for it to disagree with itself.
async fn reader(base: &str, key: &str, org_id: &str) -> Option<(String, String)> {
    let client = http().ok()?;
    let response = client
        .get(format!("{base}/rest/v1/organizations"))
        .query(&[
            ("id", format!("eq.{org_id}")),
            ("select", "intelligence_provider,intelligence_model".into()),
        ])
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .await
        .ok()?;

    let rows: Vec<Value> = response.json().await.ok()?;
    let row = rows.first()?;
    Some((
        row["intelligence_provider"].as_str()?.to_string(),
        row["intelligence_model"].as_str()?.to_string(),
    ))
}

/// The named JSON schema this node fills in.
async fn load_shape(base: &str, key: &str, shape_id: &str) -> Result<Value, String> {
    let client = http()?;
    let response = client
        .get(format!("{base}/rest/v1/structured_outputs"))
        .query(&[("id", format!("eq.{shape_id}")), ("select", "name,description,schema".into())])
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .await
        .map_err(|e| format!("could not read the shape: {e}"))?;

    let rows: Vec<Value> = response.json().await.map_err(|e| e.to_string())?;
    rows.into_iter().next().ok_or_else(|| format!("no shape with id {shape_id}"))
}

/// One completion, with the shape enforced by a forced tool call.
///
/// **Not `output_config.format`.** That is Anthropic's documented mechanism and
/// it is the better one, but MiniMax serves the Messages API *shape* without
/// implementing it: the request is accepted, the field is ignored, and the
/// model answers "Based on the phone call, here is the information:" in prose.
/// Measured on 1 September, not assumed.
///
/// A forced tool call gets the same guarantee from a mechanism both implement.
/// The model is given one tool whose `input_schema` is the shape and is
/// required to call it, so the arguments come back as a JSON object by
/// construction — there is no text to parse, and therefore nothing to strip,
/// balance or repair. It also works unchanged against Anthropic proper.
async fn ask(
    host: &str,
    secret: &str,
    model: &str,
    shape: &Value,
    context: &Value,
    instruction: Option<&str>,
) -> Result<Value, String> {
    let transcript = context
        .get("transcript")
        .and_then(Value::as_array)
        .map(|lines| {
            lines
                .iter()
                .filter_map(|line| {
                    Some(format!(
                        "{}: {}",
                        line.get("speaker")?.as_str()?,
                        line.get("text")?.as_str()?
                    ))
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();

    let mut system = "Read the phone call and fill in the shape you have been given. Use only what \
         the call actually says: leave a field out rather than guessing at it, because whatever \
         reads this cannot tell an invented value from an observed one."
        .to_string();
    if let Some(extra) = instruction.filter(|extra| !extra.trim().is_empty()) {
        system.push_str("\n\n");
        system.push_str(extra);
    }

    // When the call happened, because the transcript almost never says.
    //
    // A caller says "day after tomorrow" and a model with no clock fills in a
    // year from its training: a real reading of a call taken on 1 September
    // 2026 produced `2024-09-03T16:00:00`. It is the same fault the `today`
    // tool exists to fix on the live call, arriving again one layer along —
    // and a date nobody notices is worse in a CRM than in a conversation,
    // because nobody hears it read back.
    let when = context
        .get("started_at")
        .and_then(Value::as_str)
        .map(|at| format!("This call took place on {at}. Any date the caller gives is relative to that.\n\n"))
        .unwrap_or_default();

    let response = http()?
        .post(format!("{host}/messages"))
        // Both spellings. Anthropic documents `x-api-key`; MiniMax's
        // Anthropic-compatible endpoint is documented with both it and a bearer
        // token, and sending both costs nothing.
        .header("x-api-key", secret)
        .header("Authorization", format!("Bearer {secret}"))
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&json!({
            "model": model,
            "max_tokens": 2048,
            "system": system,
            "messages": [{ "role": "user", "content": format!("{when}Call transcript:\n\n{transcript}") }],
            "tools": [{
                "name": RECORD_TOOL,
                "description": shape
                    .get("description")
                    .and_then(Value::as_str)
                    .filter(|text| !text.trim().is_empty())
                    .unwrap_or("Record what the call says."),
                "input_schema": shape.get("schema").cloned().unwrap_or(json!({ "type": "object" })),
            }],
            // Required, not offered. Without this the model may answer in prose
            // and the guarantee is gone.
            "tool_choice": { "type": "tool", "name": RECORD_TOOL },
        }))
        .send()
        .await
        .map_err(|e| format!("could not reach the model: {e}"))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("answered {status}: {}", body.chars().take(400).collect::<String>()));
    }

    let parsed: Value =
        serde_json::from_str(&body).map_err(|e| format!("reply was not JSON: {e}"))?;

    // The arguments of the tool call, which are an object already. Nothing here
    // parses text, which is the point of asking this way.
    parsed["content"]
        .as_array()
        .and_then(|blocks| {
            blocks
                .iter()
                .find(|block| block["type"] == "tool_use" && block["name"] == RECORD_TOOL)
        })
        .map(|block| block["input"].clone())
        .filter(|input| input.is_object())
        .ok_or_else(|| {
            // Said in terms of what the provider did, because the fix is a
            // different provider or model rather than anything on this side.
            let said = parsed["content"]
                .as_array()
                .and_then(|blocks| blocks.first())
                .and_then(|block| block["text"].as_str())
                .unwrap_or("");
            format!(
                "the model answered without calling the tool it was required to call. It said: {}",
                said.chars().take(200).collect::<String>()
            )
        })
}

/// Put the reading on the call, where a reader can see what was sent.
async fn store(base: &str, key: &str, call_id: &str, extracted: &Value) -> Result<(), String> {
    if call_id.is_empty() {
        return Err("no call row to write to".into());
    }
    let response = http()?
        .patch(format!("{base}/rest/v1/calls"))
        .query(&[("id", format!("eq.{call_id}"))])
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/json")
        .json(&json!({ "analysis": extracted }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("answered {}", response.status()))
    }
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        // Generous on purpose. Nobody is on the line, and a model that takes
        // twenty seconds is still a better answer than no reading at all.
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_reading_is_the_tool_calls_arguments() {
        // The shape of a real reply, and the reason there is no parser here:
        // `input` is an object already. Anything that had to be dug out of
        // `text` would be a guess about what the model meant.
        let reply = json!({
            "content": [
                { "type": "text", "text": "Let me record that." },
                { "type": "tool_use", "name": RECORD_TOOL, "id": "toolu_1",
                  "input": { "patient_name": "Satya", "intent": "book" } }
            ]
        });

        let reading = reply["content"]
            .as_array()
            .and_then(|blocks| {
                blocks.iter().find(|b| b["type"] == "tool_use" && b["name"] == RECORD_TOOL)
            })
            .map(|block| block["input"].clone())
            .expect("the tool call carries the reading");

        assert_eq!(reading["patient_name"], "Satya");
        assert!(reading.is_object());
    }

    #[test]
    fn prose_without_a_tool_call_is_not_a_reading() {
        // What MiniMax returned when asked with `output_config.format`, which
        // it accepts and ignores: "Based on the phone call, here is the
        // information:". A reply with no tool call has to fail rather than be
        // mined for JSON.
        let reply = json!({
            "content": [{ "type": "text", "text": "Based on the phone call, here is the information:" }]
        });

        let reading = reply["content"]
            .as_array()
            .and_then(|blocks| blocks.iter().find(|b| b["type"] == "tool_use"));

        assert!(reading.is_none(), "prose must not be read as a filled-in shape");
    }
}
