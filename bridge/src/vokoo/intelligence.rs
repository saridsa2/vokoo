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
use serde::{Deserialize, Serialize};

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
const ROUTE_DOCUMENT_TOOL: &str = "route_document";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DocumentCitation {
    pub page: Option<usize>,
    #[serde(default)]
    pub chunk_id: Option<String>,
    #[serde(default)]
    pub version_id: Option<String>,
    #[serde(default)]
    pub page_end: Option<usize>,
    #[serde(default)]
    pub section_path: Vec<String>,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct CompilerRecommendation {
    pub compiler_id: String,
    pub confidence: f64,
    pub reason: String,
    #[serde(default)]
    pub evidence: Vec<DocumentCitation>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DocumentInspection {
    pub summary: String,
    #[serde(default)]
    pub recommendations: Vec<CompilerRecommendation>,
    #[serde(default)]
    pub gaps: Vec<String>,
}

/// The model may only route to compilers registered by the platform.
/// JSON Schema constrains the normal path; this second boundary protects
/// persisted or provider-mutated output before the console can act on it.
pub fn bound_document_inspection(mut inspection: DocumentInspection) -> DocumentInspection {
    inspection.recommendations.retain(|item| item.compiler_id == "care_path");
    for recommendation in &mut inspection.recommendations {
        recommendation.confidence = recommendation.confidence.clamp(0.0, 1.0);
        recommendation.evidence.retain(|item| !item.text.trim().is_empty());
        recommendation.evidence.truncate(5);
    }
    inspection
}

pub fn extract_document_text(mime_type: &str, bytes: &[u8]) -> Result<String, String> {
    super::documents::extract_document(mime_type, bytes)
        .map(|document| document.text)
        .map_err(|problem| problem.to_string())
}

/// Inspect one immutable document version and recommend registered compilers.
/// This is routing only: it creates no agents, flows, or compiler run.
pub async fn inspect_document(
    base: &str,
    key: &str,
    org_id: &str,
    document_id: &str,
    version: i64,
) -> Result<DocumentInspection, String> {
    let source = load_document_version(base, key, org_id, document_id, version).await?;
    let mime_type = source["mime_type"].as_str().unwrap_or_default();
    let encoded = source["content"]
        .as_str()
        .and_then(|value| value.strip_prefix("\\x"))
        .ok_or_else(|| "the document source was not returned as bytea".to_string())?;
    let bytes = hex::decode(encoded).map_err(|error| format!("the document source is invalid: {error}"))?;
    let text = extract_document_text(mime_type, &bytes)?;
    if text.trim().is_empty() {
        return Err("the document contains no extractable text".into());
    }

    let (provider, model) = reader(base, key, org_id)
        .await
        .ok_or_else(|| "could not read the workspace intelligence provider".to_string())?;
    if !is_reader(&provider) {
        return Err(format!("{provider} cannot inspect documents"));
    }
    let secret = super::graph::vendor_secret(base, key, org_id, &provider)
        .await
        .ok_or_else(|| format!("no {provider} key is connected for this workspace"))?;
    let prompt = numbered_document(&text);
    let inspection = ask_document(&provider, &secret, &model, prompt).await?;
    let inspection = bound_document_inspection(inspection);
    store_document_inspection(base, key, org_id, document_id, version, &text, &inspection).await?;
    Ok(inspection)
}

/// Route a document from indexed, version-scoped evidence. The model may quote
/// only chunks supplied here; persisted citations are rebound to their stored
/// provenance before they leave this boundary.
pub async fn inspect_document_evidence(
    base: &str,
    key: &str,
    org_id: &str,
    evidence: &super::documents::DocumentEvidence,
) -> Result<DocumentInspection, String> {
    let (provider, model) = reader(base, key, org_id)
        .await
        .ok_or_else(|| "could not read the workspace intelligence provider".to_string())?;
    if !is_reader(&provider) {
        return Err(format!("{provider} cannot inspect documents"));
    }
    let secret = super::graph::vendor_secret(base, key, org_id, &provider)
        .await
        .ok_or_else(|| format!("no {provider} key is connected for this workspace"))?;
    let prompt = format!(
        "Review only this indexed document evidence. Every citation must name one supplied chunk_id and version_id.\n\n{}",
        serde_json::to_string(evidence)
            .map_err(|error| format!("could not encode document evidence: {error}"))?
    );
    let inspection = ask_document(&provider, &secret, &model, prompt).await?;
    Ok(bound_indexed_document_inspection(inspection, evidence))
}

fn bound_indexed_document_inspection(
    inspection: DocumentInspection,
    evidence: &super::documents::DocumentEvidence,
) -> DocumentInspection {
    let mut inspection = bound_document_inspection(inspection);
    for recommendation in &mut inspection.recommendations {
        recommendation.evidence.retain_mut(|citation| {
            let Some(chunk_id) = citation.chunk_id.as_deref() else {
                return false;
            };
            let Some(chunk) = evidence
                .representative_chunks
                .iter()
                .find(|chunk| chunk.chunk_id == chunk_id)
            else {
                return false;
            };
            if citation.version_id.as_deref() != Some(chunk.version_id.as_str()) {
                return false;
            }
            citation.page = chunk.page_start;
            citation.page_end = chunk.page_end;
            citation.section_path = chunk.section_path.clone();
            if !chunk.text.contains(citation.text.trim()) {
                citation.text = chunk.text.chars().take(320).collect();
            }
            true
        });
    }
    inspection
}

async fn load_document_version(
    base: &str,
    key: &str,
    org_id: &str,
    document_id: &str,
    version: i64,
) -> Result<Value, String> {
    let response = http()?
        .get(format!("{base}/rest/v1/file_versions"))
        .query(&[
            ("org_id", format!("eq.{org_id}")),
            ("file_id", format!("eq.{document_id}")),
            ("version", format!("eq.{version}")),
            ("select", "id,mime_type,content".into()),
        ])
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .await
        .map_err(|error| format!("could not load the document: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("could not load the document: answered {}", response.status()));
    }
    let rows: Vec<Value> = response.json().await.map_err(|error| error.to_string())?;
    rows.into_iter().next().ok_or_else(|| "the document version was not found".into())
}

async fn ask_document(
    provider: &str,
    secret: &str,
    model: &str,
    prompt: String,
) -> Result<DocumentInspection, String> {
    let schema = Schema::try_from(json!({
        "type": "object",
        "required": ["summary", "recommendations", "gaps"],
        "properties": {
            "summary": {"type": "string"},
            "recommendations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["compiler_id", "confidence", "reason", "evidence"],
                    "properties": {
                        "compiler_id": {"type": "string", "enum": ["care_path"]},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                        "reason": {"type": "string"},
                        "evidence": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "required": ["page", "text"],
                                "properties": {
                                    "page": {"type": ["integer", "null"]},
                                    "chunk_id": {"type": ["string", "null"]},
                                    "version_id": {"type": ["string", "null"]},
                                    "page_end": {"type": ["integer", "null"]},
                                    "section_path": {"type": "array", "items": {"type": "string"}},
                                    "text": {"type": "string"}
                                }
                            }
                        }
                    }
                }
            },
            "gaps": {"type": "array", "items": {"type": "string"}}
        }
    })).map_err(|error| format!("could not build the routing schema: {error}"))?;
    let captured: Arc<Mutex<Option<DocumentInspection>>> = Arc::new(Mutex::new(None));
    let sink = Arc::clone(&captured);
    let tool = Tool::builder()
        .name(ROUTE_DOCUMENT_TOOL)
        .description("Record which registered workspace compilers are suitable for this document.")
        .input_schema(schema)
        .execute(ToolExecute::from_sync(move |_context, value: Value| {
            let inspection = serde_json::from_value(value)
                .map_err(|error| aisdk::error::Error::ToolCallError(error.to_string()))?;
            *sink.lock().map_err(|_| aisdk::error::Error::ToolCallError("routing lock poisoned".into()))? = Some(inspection);
            Ok("routing recorded".to_string())
        }))
        .build()
        .map_err(|error| format!("could not build the routing tool: {error}"))?;
    let system = "You are Workspace Intelligence. Identify what this source document is and which registered compiler can translate it into workspace artifacts. The only registered compiler is care_path, which applies to clinical guidelines defining longitudinal care, monitoring, timing, escalation, or patient follow-up. Do not recommend it for invoices, policies, FAQs, marketing material, or patient-specific clinical records. Cite short source evidence with its supplied chunk, version, section, and physical page provenance. A recommendation is advisory and must not run the compiler. You must call route_document exactly once.";
    let prompt = prompt.chars().take(160_000).collect::<String>();
    let body = if anthropic_base(provider).is_some() {
        json!({ "tool_choice": { "type": "tool", "name": ROUTE_DOCUMENT_TOOL } })
    } else {
        json!({ "tool_choice": { "type": "function", "name": ROUTE_DOCUMENT_TOOL } })
    };

    if let Some(base_url) = anthropic_base(provider) {
        let chosen = Anthropic::<DynamicModel>::builder()
            .model_name(model).api_key(secret).base_url(base_url).build()
            .map_err(|error| format!("could not build the {provider} client: {error}"))?;
        LanguageModelRequest::builder().model(chosen).system(system).prompt(prompt)
            .with_tool(tool).body(body).stop_when(|_| true).build().generate_text().await
            .map_err(|error| format!("could not reach Workspace Intelligence: {error}"))?;
    } else {
        let chosen = OpenAI::<DynamicModel>::builder().model_name(model).api_key(secret).build()
            .map_err(|error| format!("could not build the openai client: {error}"))?;
        LanguageModelRequest::builder().model(chosen).system(system).prompt(prompt)
            .with_tool(tool).body(body).stop_when(|_| true).build().generate_text().await
            .map_err(|error| format!("could not reach Workspace Intelligence: {error}"))?;
    }
    let result = captured
        .lock()
        .map_err(|_| "routing lock poisoned".to_string())?
        .take()
        .ok_or_else(|| "Workspace Intelligence answered without routing the document".into());
    result
}

fn numbered_document(text: &str) -> String {
    text
        .split('\u{000c}')
        .enumerate()
        .map(|(index, page)| format!("[physical page {}]\n{}", index + 1, page))
        .collect::<Vec<_>>()
        .join("\n\n")
        .chars()
        .take(160_000)
        .collect::<String>()
}

async fn store_document_inspection(
    base: &str,
    key: &str,
    org_id: &str,
    document_id: &str,
    version: i64,
    text: &str,
    inspection: &DocumentInspection,
) -> Result<(), String> {
    let client = http()?;
    let version_response = client
        .patch(format!("{base}/rest/v1/file_versions"))
        .query(&[("org_id", format!("eq.{org_id}")), ("file_id", format!("eq.{document_id}")), ("version", format!("eq.{version}"))])
        .header("apikey", key).header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/json")
        .json(&json!({ "status": "analyzed", "extracted_text": text, "intelligence": inspection }))
        .send().await.map_err(|error| error.to_string())?;
    if !version_response.status().is_success() {
        return Err(format!("could not store the document analysis: answered {}", version_response.status()));
    }
    let file_response = client
        .patch(format!("{base}/rest/v1/files"))
        .query(&[("org_id", format!("eq.{org_id}")), ("id", format!("eq.{document_id}"))])
        .header("apikey", key).header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/json")
        .json(&json!({ "status": "analyzed", "intelligence": inspection }))
        .send().await.map_err(|error| error.to_string())?;
    if file_response.status().is_success() { Ok(()) } else {
        Err(format!("could not update the document: answered {}", file_response.status()))
    }
}

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

    #[test]
    fn document_routing_cannot_name_an_unregistered_compiler() {
        let routed = DocumentInspection {
            summary: "A clinical guideline with timed recommendations.".into(),
            recommendations: vec![
                CompilerRecommendation {
                    compiler_id: "care_path".into(),
                    confidence: 0.92,
                    reason: "Defines longitudinal care steps.".into(),
                    evidence: vec![DocumentCitation {
                        page: Some(12),
                        chunk_id: None,
                        version_id: None,
                        page_end: None,
                        section_path: Vec::new(),
                        text: "within 36 hours".into(),
                    }],
                },
                CompilerRecommendation {
                    compiler_id: "invented".into(),
                    confidence: 1.0,
                    reason: "Not in the platform registry.".into(),
                    evidence: vec![],
                },
            ],
            gaps: vec![],
        };

        let bounded = bound_document_inspection(routed);
        assert_eq!(bounded.recommendations.len(), 1);
        assert_eq!(bounded.recommendations[0].compiler_id, "care_path");
    }

    #[test]
    fn indexed_routing_rejects_unknown_citations_and_rebinds_provenance() {
        let evidence = super::super::documents::DocumentEvidence {
            outline: vec!["Diabetes > Escalation".into()],
            compiler_matches: vec!["care_path".into()],
            representative_chunks: vec![super::super::documents::EvidenceChunk {
                chunk_id: "chunk-1".into(),
                version_id: "version-2".into(),
                page_start: Some(7),
                page_end: Some(8),
                section_path: vec!["Diabetes".into(), "Escalation".into()],
                text: "Escalate to specialist review after fourteen days.".into(),
            }],
        };
        let inspection = DocumentInspection {
            summary: "A guideline".into(),
            recommendations: vec![CompilerRecommendation {
                compiler_id: "care_path".into(),
                confidence: 0.9,
                reason: "Timed escalation".into(),
                evidence: vec![
                    DocumentCitation {
                        page: None,
                        chunk_id: Some("chunk-1".into()),
                        version_id: Some("version-2".into()),
                        page_end: None,
                        section_path: vec![],
                        text: "after fourteen days".into(),
                    },
                    DocumentCitation {
                        page: Some(99),
                        chunk_id: Some("invented".into()),
                        version_id: Some("version-2".into()),
                        page_end: None,
                        section_path: vec![],
                        text: "invented evidence".into(),
                    },
                ],
            }],
            gaps: vec![],
        };

        let bounded = bound_indexed_document_inspection(inspection, &evidence);

        assert_eq!(bounded.recommendations[0].evidence.len(), 1);
        let citation = &bounded.recommendations[0].evidence[0];
        assert_eq!(citation.page, Some(7));
        assert_eq!(citation.page_end, Some(8));
        assert_eq!(citation.section_path, evidence.representative_chunks[0].section_path);
    }

    #[test]
    fn plain_text_documents_are_extracted_without_a_system_command() {
        let text = extract_document_text("text/plain", b"First line\nSecond line")
            .expect("plain text is directly readable");
        assert_eq!(text, "First line\nSecond line");
    }
}
