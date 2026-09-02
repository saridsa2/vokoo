//! Gemini Live implementation of [`RealtimeSession`].
//!
//! Wraps the `gemini-live` crate. Audio in is PCM16 LE at 16 kHz; audio out is
//! PCM16 LE at 24 kHz — the asymmetry is Google's, and it is why
//! [`RealtimeSession`] declares the two rates separately instead of assuming
//! one.

use async_trait::async_trait;
// lib.rs does `pub use types::*`, so the protocol types come straight off the
// crate root. SetupConfig lives under client_message, not config — the two are
// easy to confuse.
use gemini_live::{
    Auth, Content, FunctionDeclaration, FunctionResponse, GenerationConfig, Modality, Part,
    PrebuiltVoiceConfig,
    ReconnectPolicy, ServerEvent, Session, SessionConfig, SetupConfig, SpeechConfig, Tool,
    TransportConfig, VoiceConfig,
};

use super::{RealtimeEvent, RealtimeSession};

/// Gemini Live takes 16 kHz in.
pub const GEMINI_INPUT_RATE: u32 = 16_000;
/// Gemini Live emits 24 kHz out.
pub const GEMINI_OUTPUT_RATE: u32 = 24_000;

#[derive(Debug, Clone)]
pub struct GeminiLiveConfig {
    pub api_key: String,
    pub model: String,
    pub voice: Option<String>,
    pub instructions: String,
    /// Functions the model may call. A flow declares one so the agent can
    /// report how it finished rather than the bridge inferring it.
    pub functions: Vec<FunctionDeclaration>,
    /// BCP-47 codes the caller is expected to speak, most likely first.
    pub language_codes: Vec<String>,
    /// How much the model wanders. A receptionist wants low.
    pub temperature: Option<f32>,
    /// Caps reply length. Too low and replies truncate mid-sentence, which on a
    /// call sounds like a dropped line.
    pub max_output_tokens: Option<u32>,
    /// Listen without speaking.
    ///
    /// After a transfer the agent stays on the call as a silent participant, so
    /// the human-to-human part still reaches the record. Asking for text back
    /// rather than audio is what makes that safe: a session that cannot produce
    /// speech cannot accidentally talk over the two people on the line.
    pub transcribe_only: bool,
}

impl Default for GeminiLiveConfig {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            model: "models/gemini-3.1-flash-live-preview".to_string(),
            voice: None,
            instructions: String::new(),
            functions: Vec::new(),
            // Indian English first: this line is answered in Hyderabad.
            language_codes: vec!["en-IN".into(), "en-US".into()],
            temperature: None,
            max_output_tokens: None,
            transcribe_only: false,
        }
    }
}

/// Send and receive must not contend.
///
/// A single object holding the socket forces `send_audio` and `next_event`
/// through one lock, and `next_event` is idle for seconds between turns — so
/// inbound caller audio would stall waiting for outbound agent audio, and the
/// call becomes half-duplex. Instead an owning task holds the session and the
/// two directions are plain channels.
pub struct GeminiLiveSession {
    audio_tx: tokio::sync::mpsc::Sender<Vec<u8>>,
    text_tx: tokio::sync::mpsc::Sender<String>,
    tool_tx: tokio::sync::mpsc::Sender<FunctionResponse>,
    events: Option<tokio::sync::mpsc::Receiver<RealtimeEvent>>,
}

impl GeminiLiveSession {
    pub async fn connect(cfg: GeminiLiveConfig) -> Result<Self, String> {
        let mut generation = GenerationConfig {
            // Audio only — we are a phone line, not a chat window. Except when
            // listening in, where text is the point and audio would be a bug.
            response_modalities: Some(vec![if cfg.transcribe_only {
                Modality::Text
            } else {
                Modality::Audio
            }]),
            temperature: cfg.temperature,
            max_output_tokens: cfg.max_output_tokens,
            ..Default::default()
        };
        if let Some(voice_name) = cfg.voice.clone().filter(|_| !cfg.transcribe_only) {
            generation.speech_config = Some(SpeechConfig {
                voice_config: VoiceConfig {
                    prebuilt_voice_config: PrebuiltVoiceConfig { voice_name },
                },
            });
        }

        let setup = SetupConfig {
            model: cfg.model.clone(),
            generation_config: Some(generation),
            system_instruction: (!cfg.instructions.is_empty()).then(|| Content {
                role: None,
                parts: vec![Part { text: Some(cfg.instructions.clone()), inline_data: None }],
            }),
            // Both transcriptions on. Without them the call log holds no record
            // of what was said, and the turn timing has nothing to key off —
            // there is no local VAD in realtime mode, so the caller's
            // transcript is the only turn boundary available.
            // A language hint rather than automatic detection, which put
            // German in the record of an English call. The crate notes that a
            // regular Live model may treat this as a bare presence marker and
            // ignore the inner fields — so this is correct configuration, not a
            // guaranteed fix, and a real call is what settles it.
            input_audio_transcription: Some(gemini_live::AudioTranscriptionConfig {
                language_codes: Some(cfg.language_codes.clone()),
                ..Default::default()
            }),
            output_audio_transcription: Some(Default::default()),
            tools: (!cfg.functions.is_empty())
                .then(|| vec![Tool::FunctionDeclarations(cfg.functions.clone())]),
            ..Default::default()
        };

        let mut session = Session::connect(SessionConfig {
            transport: TransportConfig {
                auth: Auth::ApiKey(cfg.api_key),
                ..Default::default()
            },
            setup,
            reconnect: ReconnectPolicy::default(),
        })
        .await
        .map_err(|e| format!("gemini live connect failed: {e}"))?;

        let (text_tx, mut text_rx) = tokio::sync::mpsc::channel::<String>(8);
        let (audio_tx, mut audio_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);
        // Tool answers go through the task that owns the session, like audio
        // and text. Sending from the caller's thread would need the session
        // shared across both, and the whole point of this task is that it does
        // not have to be.
        let (tool_tx, mut tool_rx) = tokio::sync::mpsc::channel::<FunctionResponse>(8);
        let (event_tx, events) = tokio::sync::mpsc::channel::<RealtimeEvent>(256);

        // One task owns the session and services both directions with select!,
        // so neither can block the other.
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    text = text_rx.recv() => {
                        let Some(text) = text else { break };
                        if let Err(e) = session.send_text(&text).await {
                            let _ = event_tx.send(RealtimeEvent::Error(e.to_string())).await;
                        }
                    }
                    reply = tool_rx.recv() => {
                        let Some(reply) = reply else { break };
                        if let Err(e) = session.send_tool_response(vec![reply]).await {
                            let _ = event_tx.send(RealtimeEvent::Error(e.to_string())).await;
                        }
                    }
                    outgoing = audio_rx.recv() => {
                        let Some(pcm) = outgoing else { break };
                        if let Err(e) = session.send_audio(&pcm).await {
                            let _ = event_tx.send(RealtimeEvent::Error(e.to_string())).await;
                            break;
                        }
                    }
                    incoming = session.next_event() => {
                        let Some(event) = incoming else {
                            let _ = event_tx
                                .send(RealtimeEvent::Closed("stream ended".into()))
                                .await;
                            break;
                        };
                        let mapped = match event {
                            ServerEvent::ModelAudio(b) => RealtimeEvent::Audio(b.to_vec()),
                            ServerEvent::InputTranscription(t) => RealtimeEvent::UserText(t),
                            // Live Transcribe models lead with these. Dropping
                            // them made a transcribe session look like a dead
                            // one: frames arriving, nothing coming out.
                            ServerEvent::InterimInputTranscription(t) => {
                                RealtimeEvent::UserTextInterim(t)
                            }
                            ServerEvent::InputTranscriptionFinished => RealtimeEvent::UserTurnEnd,
                            ServerEvent::OutputTranscription(t) => RealtimeEvent::AgentText(t),
                            ServerEvent::Interrupted => RealtimeEvent::Interrupted,
                            ServerEvent::TurnComplete => RealtimeEvent::TurnComplete,
                            ServerEvent::ToolCall(calls) => {
                                // One event per call. The model may batch, and
                                // a flow reacts to the first that names an
                                // outcome it understands.
                                for c in calls {
                                    let _ = event_tx
                                        .send(RealtimeEvent::ToolCall {
                                            id: c.id,
                                            name: c.name,
                                            args: c.args,
                                        })
                                        .await;
                                }
                                continue;
                            }
                            ServerEvent::Error(e) => RealtimeEvent::Error(format!("{e:?}")),
                            ServerEvent::Closed { reason } => RealtimeEvent::Closed(reason),
                            // Say what is being ignored. A silent catch-all is
                            // how an unmapped transcript variant cost an
                            // afternoon: the socket looked healthy and the
                            // session looked mute.
                            other => {
                                log::debug!("[gemini] unmapped server event: {other:?}");
                                continue;
                            }
                        };
                        if event_tx.send(mapped).await.is_err() {
                            break;
                        }
                    }
                }
            }
            let _ = session.close().await;
            log::debug!("gemini live session task exited");
        });

        Ok(Self { audio_tx, text_tx, tool_tx, events: Some(events) })
    }
}

#[async_trait]
impl RealtimeSession for GeminiLiveSession {
    fn input_rate(&self) -> u32 {
        GEMINI_INPUT_RATE
    }

    fn output_rate(&self) -> u32 {
        GEMINI_OUTPUT_RATE
    }

    async fn send_audio(&mut self, pcm: &[u8]) -> Result<(), String> {
        self.audio_tx
            .send(pcm.to_vec())
            .await
            .map_err(|_| "gemini live session closed".to_string())
    }

    async fn send_text(&mut self, text: &str) -> Result<(), String> {
        self.text_tx
            .send(text.to_string())
            .await
            .map_err(|_| "gemini live session closed".to_string())
    }

    async fn send_tool_response(
        &mut self,
        id: &str,
        name: &str,
        result: serde_json::Value,
    ) -> Result<(), String> {
        self.tool_tx
            .send(FunctionResponse {
                // The id is the model's own correlation key. Answering with a
                // different one attaches the result to a different question.
                id: id.to_string(),
                name: name.to_string(),
                response: result,
            })
            .await
            .map_err(|_| "gemini live session closed".to_string())
    }

    fn take_events(&mut self) -> Option<tokio::sync::mpsc::Receiver<RealtimeEvent>> {
        self.events.take()
    }

    async fn close(&mut self) {
        // Dropping the receiver and the audio sender ends the owning task,
        // which closes the socket. Setup acks, interim transcripts, usage,
        // resumption handles and GoAway are filtered there — the audio path
        // never sees them.
        self.events.take();
    }
}
