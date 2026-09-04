//! Reading a finished call into a shape.
//!
//! The node names a shape. **The model is the workspace's** —
//! `organizations.intelligence_provider` and `intelligence_model` — because one
//! organisation reads its calls with one model, and a copy of that choice on
//! every node is four places for it to disagree with itself. Changing what
//! reads your calls is one row, not one board per flow.
//!
//! ## Why `aisdk` here and nowhere else
//!
//! This file spoke one provider dialect by hand, which is why it supported
//! exactly two providers. Every AI feature after it — the workspace chat, the
//! skill suggestions — needs the same thing, and hand-rolling each is the
//! "second implementation that can disagree with the first" fault this project
//! keeps recording against itself.
//!
//! The crate is **vendored**, with two overrides, because two of its choices
//! are wrong for a schema authored at runtime. See `docs/vendor-overrides.md`.
//!
//! It is used off the call path only. Realtime is bidirectional audio over a
//! WebSocket, which the crate does not do; the relay's LLM step streams into a
//! live pipeline where the carrier ends the call if our socket errors. Nobody
//! is waiting on this file, so a failure here costs a CRM delivery.
//!
//! **A one-shot request, not the pipeline's LLM handler.** `OpenAILLMHandler`
//! is a `FrameProcessor` built to stream into a live conversation with an
//! aggregator either side of it. This is one request and one object, with
//! nobody on the line. Reusing the pipeline handler here would drag the whole
//! frame machinery off the call path to do something a small client does
//! better.

use std::sync::{Arc, Mutex};

use aisdk::core::tools::ToolExecute;
use aisdk::core::{DynamicModel, LanguageModelRequest, Tool};
use aisdk::providers::{Anthropic, OpenAI};
use schemars::Schema;
use serde_json::{json, Value};

use super::graph::{vendor_secret, FlowNode};

/// Where a provider that speaks the Anthropic Messages API lives.
///
/// MiniMax serves that API's *shape* under its own host, so it is the Anthropic
/// provider pointed elsewhere rather than a provider of its own.
///
/// **The version segment belongs to the base URL.** The default is
/// `https://api.anthropic.com/v1/` and the client appends only the endpoint
/// name, so a base without `/v1/` produces a 404 that says nothing about which
/// half was wrong.
fn anthropic_base(provider: &str) -> Option<&'static str> {
    match provider {
        "anthropic" => Some("https://api.anthropic.com/v1/"),
        "minimax" => Some("https://api.minimax.io/anthropic/v1/"),
        _ => None,
    }
}

/// Make the tool call required rather than offered.
///
/// The crate sends no `tool_choice` of its own, so this goes through the
/// request's `body`, which providers merge into the outgoing JSON.
///
/// It carries the guarantee this whole file rests on: the arguments come back
/// as an object *by construction*, so there is no prose to parse and nothing to
/// repair. Offered rather than required, MiniMax answers in prose about one run
/// in seven.
///
/// **The two dialects disagree, and OpenAI disagrees with itself.** Anthropic
/// names the tool directly. OpenAI's Responses API takes `{type, name}` flat,
/// while chat completions takes it nested under `function` — same vendor, two
/// APIs, each refusing the other's shape with a 400. `CLAUDE.md` records that
/// trap for OpenAI Realtime's declarations already; this is the second door.
fn force_tool(provider: &str) -> Value {
    if anthropic_base(provider).is_some() {
        json!({ "tool_choice": { "type": "tool", "name": RECORD_TOOL } })
    } else {
        json!({ "tool_choice": { "type": "function", "name": RECORD_TOOL } })
    }
}

/// Whether this provider can be a reader at all.
pub fn is_reader(provider: &str) -> bool {
    anthropic_base(provider).is_some() || provider == "openai"
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
    if !is_reader(provider) {
        log::warn!("[intelligence] {provider} cannot read a call — use anthropic, minimax or openai");
        return ("failed".to_string(), None);
    }

    let secret = match vendor_secret(base, key, org_id, provider).await {
        Some(secret) => secret,
        None => {
            log::warn!("[intelligence] no {provider} key is connected for this organisation");
            return ("failed".to_string(), None);
        }
    };

    let extracted = match ask(provider, &secret, model, &shape, context, node.config_str("instruction")).await {
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
        // **The reading is a billable service, and nothing recorded it before
        // this.** Every post-call flow ran a model on the workspace's behalf
        // and left no trace a bill could be built from — the same gap realtime
        // still has.
        //
        // After `store`, and never fatal. A reading that was taken and not
        // billed is a loss; a reading lost because the meter was unreachable
        // is a customer's data gone for an accounting reason.
        //
        // Not written on a dry run: a test that bills is not a test.
        if let Err(problem) = meter(base, key, org_id, call_id, provider, model).await {
            log::warn!("[intelligence] the reading was not metered: {problem}");
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
    provider: &str,
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
    // tool exists to fix on the live call, arriving one layer along — and a
    // date nobody notices is worse in a CRM than in a conversation, because
    // nobody hears it read back.
    let when = context
        .get("started_at")
        .and_then(Value::as_str)
        .map(|at| format!("This call took place on {at}. Any date the caller gives is relative to that.\n\n"))
        .unwrap_or_default();

    let prompt = format!("{when}Call transcript:\n\n{transcript}");

    // The customer's shape, as the tool's input schema.
    //
    // A runtime value, not the crate's `schema::<T>()`, which derives one from
    // a Rust type at compile time. Ours is authored in the console and loaded
    // from `structured_outputs`, so there is no type to derive from —
    // `Tool.input_schema` takes a `schemars::Schema` value, which a JSON Schema
    // converts into directly.
    let raw = shape
        .get("schema")
        .cloned()
        .unwrap_or_else(|| json!({ "type": "object" }));
    let input_schema = Schema::try_from(raw)
        .map_err(|e| format!("the shape is not a usable JSON Schema: {e}"))?;

    // Where the arguments land. The tool's body is the only place they exist:
    // the crate hands them to `execute` and keeps no copy to read afterwards.
    let captured: Arc<Mutex<Option<Value>>> = Arc::new(Mutex::new(None));
    let sink = captured.clone();

    let tool = Tool::builder()
        .name(RECORD_TOOL)
        .description(
            shape
                .get("description")
                .and_then(Value::as_str)
                .filter(|text| !text.trim().is_empty())
                .unwrap_or("Record what the call says."),
        )
        .input_schema(input_schema)
        .execute(ToolExecute::from_sync(move |_ctx, params: Value| {
            if let Ok(mut slot) = sink.lock() {
                *slot = Some(params);
            }
            // The model is told the reading is filed. Handing the arguments
            // back would invite a second, differing attempt.
            Ok("recorded".to_string())
        }))
        .build()
        .map_err(|e| format!("could not build the recording tool: {e}"))?;

    let forced = force_tool(provider);

    let answered = if let Some(base) = anthropic_base(provider) {
        let chosen = Anthropic::<DynamicModel>::builder()
            .model_name(model)
            .api_key(secret)
            .base_url(base)
            .build()
            .map_err(|e| format!("could not build the {provider} client: {e}"))?;

        LanguageModelRequest::builder()
            .model(chosen)
            .system(system)
            .prompt(prompt)
            .with_tool(tool)
            .body(forced)
            // One round trip. Without this the crate feeds the tool result back
            // and asks again, paying for a second request to be told something
            // we already hold.
            .stop_when(|_| true)
            .build()
            .generate_text()
            .await
    } else {
        let chosen = OpenAI::<DynamicModel>::builder()
            .model_name(model)
            .api_key(secret)
            .build()
            .map_err(|e| format!("could not build the openai client: {e}"))?;

        LanguageModelRequest::builder()
            .model(chosen)
            .system(system)
            .prompt(prompt)
            .with_tool(tool)
            .body(forced)
            .stop_when(|_| true)
            .build()
            .generate_text()
            .await
    }
    .map_err(|e| format!("could not reach the model: {e}"))?;

    let taken = captured
        .lock()
        .map_err(|_| "the recording tool panicked".to_string())?
        .take();

    taken.filter(Value::is_object).ok_or_else(|| {
        // Said in terms of what the provider did, because the fix is a
        // different provider or model rather than anything on this side.
        format!(
            "the model answered without calling the tool it was required to call. It said: {}",
            // `text()` is an Option: a reply that was only a tool call carries
            // no prose at all, which is the successful case rather than a fault.
            answered.text().unwrap_or_default().chars().take(200).collect::<String>()
        )
    })
}

/// Record that a reading happened, so it can be billed.
///
/// Its own ledger rather than `billing_sessions`: that pipeline is keyed on a
/// live session and this runs after the call has ended and been checkpointed,
/// so it would mean reopening a closed row for something that is not part of
/// the audio path at all.
///
/// One row per reading, quantity 1. The provider and model are recorded and
/// **not** used for pricing — the price is the platform's and does not move
/// when we change model — but without them there is no way to work out the
/// margin later.
async fn meter(
    base: &str,
    key: &str,
    org_id: &str,
    call_id: &str,
    provider: &str,
    model: &str,
) -> Result<(), String> {
    let response = http()?
        .post(format!("{base}/rest/v1/platform_service_usage"))
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/json")
        // Nothing is read back, and asking for it would be a second thing that
        // can fail after the row is already written.
        .header("Prefer", "return=minimal")
        .json(&json!({
            "org_id": org_id,
            "service_id": "intelligence.read",
            "call_id": call_id,
            "quantity": 1,
            "provider": provider,
            "model": model,
        }))
        .send()
        .await
        .map_err(|e| format!("could not reach the ledger: {e}"))?;

    if response.status().is_success() {
        return Ok(());
    }
    Err(format!(
        "the ledger answered {}: {}",
        response.status(),
        response.text().await.unwrap_or_default().chars().take(200).collect::<String>()
    ))
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
