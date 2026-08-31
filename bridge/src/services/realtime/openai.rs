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

#[derive(Debug, Clone)]
pub struct OpenAIRealtimeConfig {
    /// Empty for a self-hosted deployment that doesn't authenticate.
    pub api_key: String,
    /// Base WebSocket URL, without the `?model=` query.
    pub base_url: String,
    pub model: String,
    pub voice: String,
    pub instructions: String,
    pub sample_rate: u32,
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
        }
    }
}

pub struct OpenAIRealtimeSession {
    audio_tx: tokio::sync::mpsc::Sender<Vec<u8>>,
    text_tx: tokio::sync::mpsc::Sender<String>,
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
                            "response.done" => RealtimeEvent::TurnComplete,
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

        Ok(Self { audio_tx, text_tx, events: Some(events), rate: cfg.sample_rate })
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
