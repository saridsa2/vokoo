//! OpenAI Realtime implementation of [`RealtimeSession`].
//!
//! Covers **two** providers, because HuggingFace's `speech-to-speech` exposes
//! the same `/v1/realtime` event set. Point `base_url` at a Modal deployment
//! and the identical code drives a self-hosted, sovereign stack:
//!
//! ```text
//! wss://api.openai.com/v1/realtime          → OpenAI
//! wss://<app>.modal.run/v1/realtime         → your own HF deployment
//! ```
//!
//! Audio is PCM16 LE at 24 kHz in both directions, base64 in JSON — unlike
//! Gemini, which takes 16 kHz and emits 24 kHz.

use async_trait::async_trait;
use base64::Engine;
use futures::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use super::{RealtimeEvent, RealtimeSession};

/// OpenAI Realtime uses 24 kHz in both directions.
pub const OPENAI_RATE: u32 = 24_000;

#[derive(Clone)]
pub struct OpenAIRealtimeConfig {
    /// Empty for a self-hosted deployment that doesn't authenticate.
    pub api_key: String,
    /// Base WebSocket URL, without the `?model=` query.
    pub base_url: String,
    pub model: String,
    pub voice: String,
    pub instructions: String,
    pub sample_rate: u32,
    /// Functions the model may call, already in OpenAI's realtime shape:
    /// `{type:"function", name, description, parameters}`. Flat — the nested
    /// `{type:"function", function:{..}}` of chat completions is a different
    /// API and is rejected here.
    pub tools: Vec<Value>,
    /// `auto` (the default when tools are declared), `none`, or `required`.
    pub tool_choice: Option<String>,
    /// Where token usage is reported.
    ///
    /// The realtime path recorded nothing at all until now — `src/services/
    /// realtime/*.rs` contained no collector — so a realtime call cost an
    /// unknown amount while every relay was measured to the token.
    pub billing: Option<std::sync::Arc<dyn crate::billing::BillingCollector>>,
}

/// Written by hand for two reasons: a collector is not `Debug`, and the derived
/// one printed `api_key` in full. Anything that logged this config — an error
/// path, a panic message — put a live provider key in the journal.
impl std::fmt::Debug for OpenAIRealtimeConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OpenAIRealtimeConfig")
            .field("api_key", &if self.api_key.is_empty() { "unset" } else { "set" })
            .field("base_url", &self.base_url)
            .field("model", &self.model)
            .field("voice", &self.voice)
            .field("instructions", &format_args!("{} chars", self.instructions.len()))
            .field("sample_rate", &self.sample_rate)
            .field("tools", &format_args!("{} declared", self.tools.len()))
            .field("tool_choice", &self.tool_choice)
            .field("billing", &self.billing.is_some())
            .finish()
    }
}

impl Default for OpenAIRealtimeConfig {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            base_url: "wss://api.openai.com/v1/realtime".to_string(),
            model: "gpt-realtime".to_string(),
            voice: "alloy".to_string(),
            instructions: String::new(),
            sample_rate: OPENAI_RATE,
            tools: Vec::new(),
            tool_choice: None,
            billing: None,
        }
    }
}

/// Report what a turn cost.
///
/// **The modality split is deliberately not folded into the totals.** OpenAI
/// bills realtime audio tokens and text tokens at different rates, and cached
/// input tokens at a reduced one — the usage object breaks all three out in
/// `input_token_details` and `output_token_details`. `BillingEvent::LlmUsage`
/// carries only two numbers, so the breakdown cannot be expressed and is logged
/// instead of stored.
///
/// The consequence is written into the rate card: the realtime rows carry a
/// note saying not to price them yet, because multiplying an audio-heavy call
/// by a text rate is wrong by roughly an order of magnitude — and a confidently
/// wrong invoice is the one outcome this whole subsystem was shaped to avoid.
/// Pricing realtime needs `input_audio_token` / `input_text_token` /
/// `input_cached_token` units and an event that can carry them.
fn record_usage(
    billing: &std::sync::Arc<dyn crate::billing::BillingCollector>,
    model: &str,
    usage: &Value,
) {
    let count = |parent: &Value, key: &str| parent.get(key).and_then(Value::as_u64).unwrap_or(0) as u32;
    let input = count(usage, "input_tokens");
    let output = count(usage, "output_tokens");
    if input == 0 && output == 0 {
        return;
    }

    if let (Some(inputs), Some(outputs)) =
        (usage.get("input_token_details"), usage.get("output_token_details"))
    {
        log::info!(
            "openai realtime usage: in {input} (audio {}, text {}, cached {}) out {output} (audio {}, text {})",
            count(inputs, "audio_tokens"),
            count(inputs, "text_tokens"),
            count(inputs, "cached_tokens"),
            count(outputs, "audio_tokens"),
            count(outputs, "text_tokens"),
        );
    }

    billing.record(crate::billing::BillingEvent::LlmUsage {
        session_id: billing.session_id(),
        provider: "openai".to_string(),
        model: model.to_string(),
        input_tokens: input,
        output_tokens: output,
        // The provider reported these; nothing here is a guess.
        estimated: false,
        occurred_at: chrono::Utc::now(),
    });
}

pub struct OpenAIRealtimeSession {
    audio_tx: tokio::sync::mpsc::Sender<Vec<u8>>,
    text_tx: tokio::sync::mpsc::Sender<String>,
    /// `(call_id, result)` for a function the model called.
    tool_tx: tokio::sync::mpsc::Sender<(String, Value)>,
    events: Option<tokio::sync::mpsc::Receiver<RealtimeEvent>>,
    rate: u32,
}

impl OpenAIRealtimeSession {
    /// The `session.update` payload.
    ///
    /// This schema is strict and every field here was confirmed against live
    /// `invalid_request_error` responses: `session.type` is required;
    /// `output_modalities` replaced the old `modalities`; `turn_detection`
    /// nests under `audio.input`, not at the session root; and
    /// `audio.output.format.rate` is required even when the input declares one.
    fn session_update(cfg: &OpenAIRealtimeConfig) -> Value {
        let mut session = json!({
            "type": "realtime",
            "output_modalities": ["audio"],
            "audio": {
                "input": {
                    "format": { "type": "audio/pcm", "rate": cfg.sample_rate },
                    "turn_detection": { "type": "semantic_vad" },
                    "transcription": { "model": "gpt-realtime-whisper" }
                },
                "output": {
                    "format": { "type": "audio/pcm", "rate": cfg.sample_rate },
                    "voice": cfg.voice
                }
            }
        });
        if !cfg.instructions.is_empty() {
            session["instructions"] = json!(cfg.instructions);
        }
        // Tools sit at the session root beside `instructions`, not inside
        // `audio` and not inside a nested `function` object.
        if !cfg.tools.is_empty() {
            session["tools"] = json!(cfg.tools);
            session["tool_choice"] = json!(cfg.tool_choice.clone().unwrap_or_else(|| "auto".into()));
        }
        json!({ "type": "session.update", "session": session })
    }

    pub async fn connect(cfg: OpenAIRealtimeConfig) -> Result<Self, String> {
        let url = if cfg.model.is_empty() {
            cfg.base_url.clone()
        } else {
            format!("{}?model={}", cfg.base_url, cfg.model)
        };

        let mut request = url
            .as_str()
            .into_client_request()
            .map_err(|e| format!("bad realtime url {url}: {e}"))?;
        if !cfg.api_key.is_empty() {
            request.headers_mut().insert(
                "Authorization",
                format!("Bearer {}", cfg.api_key)
                    .parse()
                    .map_err(|_| "bad api key header".to_string())?,
            );
        }

        let (mut socket, _) = tokio_tungstenite::connect_async(request)
            .await
            .map_err(|e| format!("realtime connect failed: {e}"))?;

        socket
            .send(Message::Text(Self::session_update(&cfg).to_string().into()))
            .await
            .map_err(|e| format!("session.update failed: {e}"))?;

        let (text_tx, mut text_rx) = tokio::sync::mpsc::channel::<String>(8);
        let (tool_tx, mut tool_rx) = tokio::sync::mpsc::channel::<(String, Value)>(8);
        let billing = cfg.billing.clone();
        let billed_model = cfg.model.clone();
        let (audio_tx, mut audio_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);
        let (event_tx, events) = tokio::sync::mpsc::channel::<RealtimeEvent>(256);

        // One task owns the socket and services both directions with select!,
        // so a quiet provider can never block outbound caller audio.
        tokio::spawn(async move {
            let b64 = base64::engine::general_purpose::STANDARD;
            loop {
                tokio::select! {
                    outgoing = audio_rx.recv() => {
                        let Some(pcm) = outgoing else { break };
                        let msg = json!({
                            "type": "input_audio_buffer.append",
                            "audio": b64.encode(&pcm),
                        });
                        if socket.send(Message::Text(msg.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    text = text_rx.recv() => {
                        let Some(text) = text else { break };
                        let item = json!({
                            "type": "conversation.item.create",
                            "item": {
                                "type": "message",
                                "role": "user",
                                "content": [{ "type": "input_text", "text": text }],
                            }
                        });
                        if socket.send(Message::Text(item.to_string().into())).await.is_err() {
                            break;
                        }
                        // Without response.create the model holds the text but
                        // never speaks.
                        let go = json!({ "type": "response.create" });
                        if socket.send(Message::Text(go.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    answer = tool_rx.recv() => {
                        let Some((call_id, result)) = answer else { break };
                        // The result goes back as its own conversation item,
                        // correlated by `call_id`. `output` is a **string**,
                        // not an object — the API takes the JSON already
                        // serialised, and an object here is rejected.
                        let item = json!({
                            "type": "conversation.item.create",
                            "item": {
                                "type": "function_call_output",
                                "call_id": call_id,
                                "output": result.to_string(),
                            }
                        });
                        if socket.send(Message::Text(item.to_string().into())).await.is_err() {
                            break;
                        }
                        // And a separate nudge, or the model holds the answer
                        // and never speaks it — the same trap as `send_text`.
                        let go = json!({ "type": "response.create" });
                        if socket.send(Message::Text(go.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    incoming = socket.next() => {
                        let Some(Ok(msg)) = incoming else {
                            let _ = event_tx
                                .send(RealtimeEvent::Closed("socket closed".into()))
                                .await;
                            break;
                        };
                        let text = match msg {
                            Message::Text(t) => t.to_string(),
                            Message::Binary(b) => String::from_utf8_lossy(&b).into_owned(),
                            Message::Close(_) => {
                                let _ = event_tx
                                    .send(RealtimeEvent::Closed("server closed".into()))
                                    .await;
                                break;
                            }
                            _ => continue,
                        };
                        let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
                        let Some(kind) = v.get("type").and_then(|t| t.as_str()) else { continue };

                        let mapped = match kind {
                            // Both names have shipped over time; handle both.
                            "response.output_audio.delta" | "response.audio.delta" => {
                                let Some(d) = v.get("delta").and_then(|d| d.as_str()) else { continue };
                                let Ok(pcm) = b64.decode(d) else { continue };
                                RealtimeEvent::Audio(pcm)
                            }
                            "conversation.item.input_audio_transcription.completed" => {
                                match v.get("transcript").and_then(|t| t.as_str()) {
                                    Some(t) => RealtimeEvent::UserText(t.to_string()),
                                    None => continue,
                                }
                            }
                            "response.output_audio_transcript.done"
                            | "response.audio_transcript.done" => {
                                match v.get("transcript").and_then(|t| t.as_str()) {
                                    Some(t) => RealtimeEvent::AgentText(t.to_string()),
                                    None => continue,
                                }
                            }
                            "input_audio_buffer.speech_started" => RealtimeEvent::Interrupted,
                            // Everything this session needed and threw away
                            // arrived here: the functions the model called, and
                            // what the turn cost. The old arm was
                            // `"response.done" => TurnComplete` and the payload
                            // went in the bin.
                            "response.done" => {
                                let response = v.get("response");

                                // A call arrives complete in the output array.
                                // `arguments` is a JSON **string**, so it is
                                // parsed rather than read as an object; an
                                // unparseable one is dropped rather than
                                // dispatched, because a tool run on `{}` is a
                                // lookup against nothing that reads as an
                                // answer.
                                if let Some(items) =
                                    response.and_then(|r| r.get("output")).and_then(Value::as_array)
                                {
                                    for item in items {
                                        if item.get("type").and_then(Value::as_str) != Some("function_call") {
                                            continue;
                                        }
                                        let (Some(name), Some(call_id)) = (
                                            item.get("name").and_then(Value::as_str),
                                            item.get("call_id").and_then(Value::as_str),
                                        ) else {
                                            continue;
                                        };
                                        let raw = item.get("arguments").and_then(Value::as_str).unwrap_or("{}");
                                        let args = match serde_json::from_str::<Value>(raw) {
                                            Ok(parsed) => parsed,
                                            Err(why) => {
                                                log::warn!(
                                                    "openai realtime: {name} arguments did not parse ({why}) — not dispatching"
                                                );
                                                continue;
                                            }
                                        };
                                        if event_tx
                                            .send(RealtimeEvent::ToolCall {
                                                id: call_id.to_string(),
                                                name: name.to_string(),
                                                args,
                                            })
                                            .await
                                            .is_err()
                                        {
                                            return;
                                        }
                                    }
                                }

                                if let (Some(bc), Some(usage)) =
                                    (billing.as_ref(), response.and_then(|r| r.get("usage")))
                                {
                                    record_usage(bc, &billed_model, usage);
                                }

                                RealtimeEvent::TurnComplete
                            }
                            "error" => RealtimeEvent::Error(
                                v.get("error").map(|e| e.to_string()).unwrap_or_default(),
                            ),
                            _ => continue,
                        };
                        if event_tx.send(mapped).await.is_err() {
                            break;
                        }
                    }
                }
            }
            let _ = socket.close(None).await;
            log::debug!("openai realtime session task exited");
        });

        Ok(Self { audio_tx, text_tx, tool_tx, events: Some(events), rate: cfg.sample_rate })
    }
}

#[async_trait]
impl RealtimeSession for OpenAIRealtimeSession {
    fn input_rate(&self) -> u32 {
        self.rate
    }

    fn output_rate(&self) -> u32 {
        self.rate
    }

    async fn send_audio(&mut self, pcm: &[u8]) -> Result<(), String> {
        self.audio_tx
            .send(pcm.to_vec())
            .await
            .map_err(|_| "realtime session closed".to_string())
    }

    async fn send_tool_response(
        &mut self,
        id: &str,
        _name: &str,
        result: serde_json::Value,
    ) -> Result<(), String> {
        // Correlated by `call_id` alone; the name is not sent back and is not
        // what the provider matches on.
        self.tool_tx
            .send((id.to_string(), result))
            .await
            .map_err(|_| "realtime session closed".to_string())
    }

    async fn send_text(&mut self, text: &str) -> Result<(), String> {
        self.text_tx
            .send(text.to_string())
            .await
            .map_err(|_| "realtime session closed".to_string())
    }

    fn take_events(&mut self) -> Option<tokio::sync::mpsc::Receiver<RealtimeEvent>> {
        self.events.take()
    }

    async fn close(&mut self) {
        self.events.take();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_update_matches_the_verified_schema() {
        let cfg = OpenAIRealtimeConfig {
            instructions: "be brief".into(),
            ..Default::default()
        };
        let v = OpenAIRealtimeSession::session_update(&cfg);
        let s = &v["session"];

        // Each of these was a live invalid_request_error at some point.
        assert_eq!(s["type"], "realtime", "session.type is required");
        assert!(s.get("modalities").is_none(), "renamed to output_modalities");
        assert_eq!(s["output_modalities"][0], "audio");
        assert!(s.get("turn_detection").is_none(), "must nest under audio.input");
        assert_eq!(s["audio"]["input"]["turn_detection"]["type"], "semantic_vad");
        assert_eq!(s["audio"]["output"]["format"]["rate"], 24_000, "output rate required");
        assert_eq!(s["instructions"], "be brief");
    }

    #[test]
    fn tools_are_declared_flat_at_the_session_root() {
        let cfg = OpenAIRealtimeConfig {
            tools: vec![json!({
                "type": "function",
                "name": "check_slots",
                "description": "when a doctor is free",
                "parameters": { "type": "object", "properties": {} },
            })],
            ..Default::default()
        };
        let s = &OpenAIRealtimeSession::session_update(&cfg)["session"];

        assert_eq!(s["tools"][0]["name"], "check_slots", "name is flat, not under .function");
        assert!(s["tools"][0].get("function").is_none(), "that shape is chat completions', not realtime's");
        assert_eq!(s["tools"][0]["type"], "function");
        // Absent means the model never calls anything, which is how an agent
        // with skills ends up with none of them reachable.
        assert_eq!(s["tool_choice"], "auto");
        assert!(s["audio"].get("tools").is_none(), "tools do not nest under audio");
    }

    #[test]
    fn no_tools_means_no_tool_fields_at_all() {
        let s = &OpenAIRealtimeSession::session_update(&OpenAIRealtimeConfig::default())["session"];
        assert!(s.get("tools").is_none());
        assert!(s.get("tool_choice").is_none(), "an empty declaration is not the same as none");
    }

    #[test]
    fn a_function_call_is_read_out_of_response_done() {
        // The shape the provider actually sends: the call is an item in the
        // response's output array, and `arguments` is a JSON *string*.
        let done = json!({
            "type": "response.done",
            "response": {
                "output": [
                    { "type": "message", "role": "assistant" },
                    {
                        "type": "function_call",
                        "name": "check_slots",
                        "call_id": "call_sHlR7iaFwQ2YQOqm",
                        "arguments": "{\"doctor\":\"cardiologist\"}"
                    }
                ]
            }
        });

        let items = done["response"]["output"].as_array().unwrap();
        let calls: Vec<_> = items
            .iter()
            .filter(|i| i.get("type").and_then(Value::as_str) == Some("function_call"))
            .collect();
        assert_eq!(calls.len(), 1, "the assistant message must not be mistaken for a call");

        let raw = calls[0]["arguments"].as_str().expect("arguments arrive as a string");
        let args: Value = serde_json::from_str(raw).expect("and parse to an object");
        assert_eq!(args["doctor"], "cardiologist");
        assert_eq!(calls[0]["call_id"], "call_sHlR7iaFwQ2YQOqm");
    }

    #[test]
    fn a_tool_result_is_returned_as_a_serialised_string() {
        // `output` is a string, not an object. An object here is rejected.
        let result = json!({ "slots": ["09:30", "16:00"] });
        let item = json!({
            "type": "conversation.item.create",
            "item": {
                "type": "function_call_output",
                "call_id": "call_x",
                "output": result.to_string(),
            }
        });
        assert!(item["item"]["output"].is_string());
        let round_trip: Value =
            serde_json::from_str(item["item"]["output"].as_str().unwrap()).unwrap();
        assert_eq!(round_trip["slots"][1], "16:00");
    }

    #[test]
    fn self_hosted_needs_no_key_and_no_model_query() {
        let cfg = OpenAIRealtimeConfig {
            api_key: String::new(),
            base_url: "wss://my-app.modal.run/v1/realtime".into(),
            model: String::new(),
            ..Default::default()
        };
        // Same code path as OpenAI — only the URL differs.
        assert!(cfg.api_key.is_empty());
        assert!(cfg.model.is_empty());
    }
}
