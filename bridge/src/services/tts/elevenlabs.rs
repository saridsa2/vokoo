//! ElevenLabs Text-to-Speech.
//!
//! Connects to the input-streaming WebSocket and pushes `OutputAudioRaw` frames
//! downstream as audio arrives, which is the same shape `sarvam.rs` and
//! `deepgram.rs` have: text in incrementally, audio out in chunks, a flush to
//! say a sentence is finished.
//!
//! The official `elevenlabs-sdk` crate was tried first and dropped: it depends
//! on `hpx`, which pulls BoringSSL, tonic and prost. `boring-sys` will not build
//! on this server without a C and Go toolchain, and that is a large tree and a
//! new system dependency to carry in a binary that answers phone calls, for one
//! voice. The protocol is a JSON handshake over a WebSocket, which is what the
//! neighbouring handlers already do with `tokio-tungstenite`.
//!
//! The voice is part of the URL — `/v1/text-to-speech/{voice_id}/stream-
//! input` — not a field in a config message. A voice change therefore needs a
//! new connection, which is why `voice` is read at connect and not per chunk.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use futures::{SinkExt, StreamExt};
use log;
use serde::Deserialize;
use serde_json::json;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;

use crate::error::Result;
use crate::frames::{
    AudioRawData, ControlFrame, DataFrame, Frame, FrameDirection, FrameHandler, FrameInner,
    FrameProcessor, SystemFrame,
};
use crate::utils::sentence_splitter::{extract_sentences, find_sentence_end};
use crate::utils::text_preprocessor::preprocess_for_tts;

fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

#[derive(Debug, Clone)]
pub struct ElevenLabsTtsConfig {
    pub api_key: String,
    /// The voice's id, not its name. ElevenLabs names are not unique and are not
    /// what the URL takes.
    pub voice: String,
    /// e.g. `eleven_turbo_v2_5`. Turbo is the one worth defaulting to on a phone
    /// call: the others are slower than a caller will sit through.
    pub model: String,
    /// The pipeline's rate. Anything else would need resampling in a hot path.
    pub sample_rate: u32,
    /// Below this, text is held back rather than synthesised a word at a time —
    /// short fragments produce audible seams.
    pub min_buffer_size: usize,
    pub max_chunk_length: usize,
    /// How steady the voice is. Low wanders and emotes; high flattens. The BOS
    /// carried none of these until now, so every call ran on whatever the
    /// voice's own defaults happen to be.
    pub stability: Option<f64>,
    /// How closely it holds to the original speaker.
    pub similarity_boost: Option<f64>,
    /// Amplifies the speaker's style. Anything above zero costs latency, which
    /// on a phone call is the thing least worth spending.
    pub style: Option<f64>,
}

impl Default for ElevenLabsTtsConfig {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            voice: String::new(),
            model: "eleven_turbo_v2_5".to_string(),
            sample_rate: 16_000,
            min_buffer_size: 24,
            max_chunk_length: 200,
            stability: None,
            similarity_boost: None,
            style: None,
        }
    }
}

/// The `output_format` value for a rate.
///
/// Only the rates ElevenLabs actually offers. One it does not have is an error
/// here rather than a silently wrong-speed voice, which is what picking the
/// nearest would produce.
fn output_format(sample_rate: u32) -> std::result::Result<String, String> {
    match sample_rate {
        8_000 | 16_000 | 22_050 | 24_000 | 44_100 | 48_000 => Ok(format!("pcm_{sample_rate}")),
        other => Err(format!("ElevenLabs has no PCM output at {other} Hz")),
    }
}

/// What the server sends back. Only the audio is acted on; `is_final` closes the
/// stream and everything else is alignment metadata a phone call does not use.
#[derive(Debug, Deserialize)]
struct ServerMessage {
    audio: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Default)]
struct TtsState {
    /// Text waiting to reach a sentence boundary.
    text_buffer: String,
    /// Chunks on their way to the socket. `None` until connected.
    text_tx: Option<mpsc::Sender<Outgoing>>,
    bot_speaking: bool,
    task: Option<JoinHandle<()>>,
    keepalive: Option<JoinHandle<()>>,
    flush_sent_at: Option<f64>,
    first_audio_logged: bool,
}

/// What the socket task is asked to do. Modelled rather than two channels so
/// that a flush can never overtake the text it was meant to finish.
enum Outgoing {
    Text(String),
    Flush,
    /// A space, sent to stop the server closing an idle stream.
    KeepAlive,
}

pub struct ElevenLabsTtsHandler {
    config: ElevenLabsTtsConfig,
    state: Arc<Mutex<TtsState>>,
    /// Characters synthesised, reported for billing.
    ///
    /// **VENDOR ADDITION.** Every other provider handler in this crate reports
    /// usage; this one did not, because it was written here and the omission
    /// was not noticed until the pricing views went in. An ElevenLabs engine
    /// would have read as costing nothing at all, which is the one wrong number
    /// worse than no number.
    billing: Option<Arc<dyn crate::billing::BillingCollector>>,
}

impl ElevenLabsTtsHandler {
    pub fn with_billing(mut self, billing: Arc<dyn crate::billing::BillingCollector>) -> Self {
        self.billing = Some(billing);
        self
    }

    pub fn new(config: ElevenLabsTtsConfig) -> std::result::Result<Self, String> {
        if config.api_key.trim().is_empty() {
            return Err("ElevenLabs needs an API key".into());
        }
        if config.voice.trim().is_empty() {
            return Err("ElevenLabs needs a voice id".into());
        }
        // Checked here rather than at connect: a rate it cannot produce is a
        // configuration error, and a call is the wrong place to learn that.
        output_format(config.sample_rate)?;
        Ok(Self { config, state: Arc::new(Mutex::new(TtsState::default())), billing: None })
    }

    pub fn into_processor(self) -> FrameProcessor {
        FrameProcessor::new("ElevenLabsTts", Box::new(self), false)
    }

    /// Open the socket and start pumping text in and audio out.
    ///
    /// One task owns the connection. The handler talks to it through a channel,
    /// so `on_process_frame` never awaits the network while holding the state
    /// lock — which is what would stall every other frame in the pipeline.
    async fn connect(&self, processor: FrameProcessor) {
        let config = self.config.clone();
        let state = self.state.clone();
        let billing = self.billing.clone();

        let format = match output_format(config.sample_rate) {
            Ok(format) => format,
            Err(problem) => {
                let _ = processor.push_error(format!("ElevenLabsTts: {problem}"), true).await;
                return;
            }
        };

        let (tx, mut rx) = mpsc::channel::<Outgoing>(64);

        // The voice is in the path, and the model and format are query
        // parameters — none of them can be changed once the socket is open,
        // which is why an interruption reconnects rather than reconfigures.
        let url = format!(
            "wss://api.elevenlabs.io/v1/text-to-speech/{}/stream-input?model_id={}&output_format={}",
            config.voice, config.model, format
        );
        log::info!(
            "ElevenLabsTts: connecting — model={} voice={} rate={}",
            config.model,
            config.voice,
            config.sample_rate
        );

        let (socket, _) = match tokio_tungstenite::connect_async(&url).await {
            Ok(connected) => connected,
            Err(error) => {
                // A wrong voice id and a rejected key both land here, and they
                // need different fixes, so the message is passed through whole.
                log::error!("ElevenLabsTts: connect failed: {error}");
                let _ = processor.push_error(format!("ElevenLabsTts: {error}"), false).await;
                return;
            }
        };
        let (mut sink, mut stream) = socket.split();

        // Beginning of stream. The key travels in this frame rather than in a
        // header: the endpoint accepts it either way and this keeps it out of
        // the connection URL, which is the thing that ends up in logs.
        let mut bos = json!({
            "text": " ",
            "xi_api_key": config.api_key,
            // Chunk boundaries the server may synthesise at. Left to its
            // default schedule; overriding it trades naturalness for latency
            // and neither is obviously right on a phone line.
            "generation_config": { "chunk_length_schedule": [120, 160, 250, 290] },
        });
        // Only the settings that were actually chosen. Sending nulls would
        // override the voice's own defaults with nothing.
        let mut settings = serde_json::Map::new();
        if let Some(v) = config.stability {
            settings.insert("stability".into(), json!(v));
        }
        if let Some(v) = config.similarity_boost {
            settings.insert("similarity_boost".into(), json!(v));
        }
        if let Some(v) = config.style {
            settings.insert("style".into(), json!(v));
        }
        if !settings.is_empty() {
            bos["voice_settings"] = serde_json::Value::Object(settings);
        }

        if let Err(error) = sink.send(Message::Text(bos.to_string().into())).await {
            log::error!("ElevenLabsTts: could not open the stream: {error}");
            let _ = processor.push_error(format!("ElevenLabsTts: {error}"), false).await;
            return;
        }

        let task_state = state.clone();
        let task_billing = billing.clone();
        let task_voice = config.voice.clone();
        let rate = config.sample_rate;
        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    outgoing = rx.recv() => match outgoing {
                        Some(Outgoing::Text(text)) => {
                            // Counted in characters, not bytes: ElevenLabs
                            // bills characters, and `len()` on a UTF-8 string
                            // would over-count every non-ASCII one threefold.
                            if let Some(bc) = task_billing.as_ref() {
                                let chars = text.chars().count();
                                if chars > 0 {
                                    bc.record(crate::billing::BillingEvent::TtsUsage {
                                        session_id:  bc.session_id(),
                                        provider:    "elevenlabs".to_string(),
                                        voice:       task_voice.clone(),
                                        char_count:  chars,
                                        occurred_at: chrono::Utc::now(),
                                    });
                                }
                            }
                            println!("[{:.3}] [tts] send_text_chunk  ({} chars): {:?}", now(), text.len(), text);
                            // `try_trigger_generation` is what the SDK sends and
                            // what this handler was missing: it asks the server
                            // to synthesise as soon as it can rather than
                            // buffering to `chunk_length_schedule`. Without it
                            // the audio is cut on the schedule's boundaries,
                            // which is audible.
                            //
                            // The text goes verbatim. An earlier version
                            // appended a space to every chunk, invented from a
                            // half-remembered note; the SDK does not, and a
                            // space mid-sentence is a pause the writer did not
                            // ask for.
                            let payload = json!({ "text": text, "try_trigger_generation": true });
                            if sink.send(Message::Text(payload.to_string().into())).await.is_err() {
                                log::warn!("ElevenLabsTts: send failed, closing");
                                break;
                            }
                        }
                        // The stream is closed by the server after about
                        // twenty seconds without input. A conversation has
                        // longer silences than that — the caller thinking, or
                        // the agent waiting — and the first call lost its
                        // socket to `input_timeout_exceeded` mid-conversation.
                        Some(Outgoing::KeepAlive) => {
                            let payload = json!({ "text": " " });
                            if sink.send(Message::Text(payload.to_string().into())).await.is_err() {
                                break;
                            }
                        }
                        Some(Outgoing::Flush) => {
                            {
                                let mut held = task_state.lock().await;
                                held.flush_sent_at = Some(now());
                                held.first_audio_logged = false;
                            }
                            println!("[{:.3}] [tts] send_flush  ← synthesis starts now", now());
                            let payload = json!({ "text": " ", "flush": true });
                            if sink.send(Message::Text(payload.to_string().into())).await.is_err() {
                                log::warn!("ElevenLabsTts: flush failed, closing");
                                break;
                            }
                        }
                        // The handler is gone. An empty text is this protocol's
                        // end of stream; closing without it leaves the server
                        // waiting.
                        None => {
                            let _ = sink.send(Message::Text(json!({ "text": "" }).to_string().into())).await;
                            break;
                        }
                    },

                    incoming = stream.next() => match incoming {
                        Some(Ok(Message::Text(raw))) => {
                            let Ok(message) = serde_json::from_str::<ServerMessage>(&raw) else { continue };

                            if let Some(problem) = message.error {
                                log::error!("ElevenLabsTts: server error: {problem}");
                                let _ = processor
                                    .push_error(format!("ElevenLabsTts: {problem}"), false)
                                    .await;
                                break;
                            }

                            let Some(audio) = message.audio.as_deref() else { continue };
                            let Ok(pcm) = BASE64.decode(audio) else {
                                log::warn!("ElevenLabsTts: audio chunk was not base64");
                                continue;
                            };
                            if pcm.is_empty() {
                                continue;
                            }

                            {
                                let mut held = task_state.lock().await;
                                if !held.first_audio_logged {
                                    held.first_audio_logged = true;
                                    let at = now();
                                    match held.flush_sent_at {
                                        Some(flushed) => println!(
                                            "[{at:.3}] [tts] first_audio  ← ElevenLabs synthesis latency: {:.3}s",
                                            at - flushed
                                        ),
                                        None => println!("[{at:.3}] [tts] first_audio"),
                                    }
                                }
                            }

                            // Fed at roughly the speed it will be played.
                            //
                            // Flash returns a whole utterance almost at once —
                            // five seconds of speech in one burst. The output
                            // transport queues 10ms pieces and drops what does
                            // not fit, so the first call on this handler logged
                            // fifty "output channel full" warnings and the
                            // caller heard the gaps. Sarvam never hit this
                            // because it synthesises progressively; the pacing
                            // was the provider's, not ours.
                            //
                            // 100ms at a time, sleeping for what was just sent.
                            // The queue drains while we wait, so nothing is
                            // dropped and the audio still arrives well ahead of
                            // where the caller is listening.
                            let bytes_per_100ms = (rate as usize / 10) * 2;
                            for piece in pcm.chunks(bytes_per_100ms.max(2)) {
                                let frame =
                                    Frame::output_audio_raw(AudioRawData::new(piece.to_vec(), rate, 1));
                                let _ = processor.push_frame(frame, FrameDirection::Downstream).await;
                                tokio::time::sleep(std::time::Duration::from_millis(
                                    (piece.len() as u64 * 1000) / (rate as u64 * 2),
                                ))
                                .await;
                            }
                        }
                        Some(Ok(Message::Close(_))) | None => {
                            log::info!("ElevenLabsTts: server closed the stream");
                            break;
                        }
                        Some(Err(error)) => {
                            log::error!("ElevenLabsTts: {error}");
                            let _ = processor.push_error(format!("ElevenLabsTts: {error}"), false).await;
                            break;
                        }
                        Some(Ok(_)) => {}
                    },
                }
            }
        });

        // A space every ten seconds. Cheap — the server treats it as input
        // without synthesising anything — and it keeps the connection warm,
        // which also spares the next turn the cold start that made the first
        // synthesis of the first call take 3.2 seconds against 0.17 for the
        // second.
        let keepalive_tx = tx.clone();
        let keepalive = tokio::spawn(async move {
            let mut tick = tokio::time::interval(std::time::Duration::from_secs(10));
            tick.tick().await;
            loop {
                tick.tick().await;
                if keepalive_tx.send(Outgoing::KeepAlive).await.is_err() {
                    break;
                }
            }
        });

        let mut held = state.lock().await;
        held.text_tx = Some(tx);
        held.task = Some(task);
        held.keepalive = Some(keepalive);
    }

    async fn disconnect(&self) {
        let mut held = self.state.lock().await;
        // Dropping the sender ends the task's loop, which closes the socket with
        // an end-of-stream. Aborting instead would leave the stream open.
        held.text_tx = None;
        if let Some(task) = held.task.take() {
            task.abort();
        }
        if let Some(task) = held.keepalive.take() {
            task.abort();
        }
        held.text_buffer.clear();
    }

    async fn send(&self, outgoing: Outgoing) {
        let sender = { self.state.lock().await.text_tx.clone() };
        if let Some(sender) = sender {
            let _ = sender.send(outgoing).await;
        }
    }
}

#[async_trait]
impl FrameHandler for ElevenLabsTtsHandler {
    async fn on_process_frame(
        &self,
        processor: &FrameProcessor,
        frame: Frame,
        direction: FrameDirection,
    ) -> Result<()> {
        match &frame.inner {
            FrameInner::System(SystemFrame::Start(_)) => {
                processor.push_frame(frame, direction).await?;
                self.connect(processor.clone()).await;
            }

            // Text arrives a token at a time. Synthesising each one produces
            // audible seams, so it is held until a sentence ends or the buffer
            // is long enough to be worth speaking.
            FrameInner::Data(DataFrame::LLMText(text)) => {
                let chunks = {
                    let mut held = self.state.lock().await;
                    held.text_buffer.push_str(text);
                    if held.text_buffer.len() < self.config.min_buffer_size
                        && find_sentence_end(&held.text_buffer).is_none()
                    {
                        Vec::new()
                    } else {
                        extract_sentences(&mut held.text_buffer, self.config.max_chunk_length)
                    }
                };

                for chunk in chunks {
                    self.send(Outgoing::Text(preprocess_for_tts(&chunk))).await;
                }
                processor.push_frame(frame, direction).await?;
            }

            FrameInner::Control(ControlFrame::LLMFullResponseEnd) => {
                let tail = {
                    let mut held = self.state.lock().await;
                    let tail = held.text_buffer.trim().to_string();
                    held.text_buffer.clear();
                    tail
                };
                if !tail.is_empty() {
                    self.send(Outgoing::Text(preprocess_for_tts(&tail))).await;
                }
                self.send(Outgoing::Flush).await;
                processor.push_frame(frame, direction).await?;
            }

            FrameInner::System(SystemFrame::BotStartedSpeaking) => {
                self.state.lock().await.bot_speaking = true;
                processor.push_frame(frame, direction).await?;
            }

            FrameInner::System(SystemFrame::BotStoppedSpeaking) => {
                self.state.lock().await.bot_speaking = false;
                processor.push_frame(frame, direction).await?;
            }

            // The caller talked over the agent. Audio already queued at the
            // server would still arrive, so the connection is replaced rather
            // than drained — the same thing the Sarvam handler does, for the
            // same reason.
            FrameInner::System(SystemFrame::Interruption) => {
                let was_speaking = {
                    let mut held = self.state.lock().await;
                    held.text_buffer.clear();
                    held.bot_speaking
                };
                if was_speaking {
                    log::info!("ElevenLabsTts: interruption while speaking — reconnecting");
                    self.disconnect().await;
                    self.connect(processor.clone()).await;
                }
                processor.push_frame(frame, direction).await?;
            }

            FrameInner::Control(ControlFrame::End { .. })
            | FrameInner::System(SystemFrame::Cancel { .. }) => {
                self.disconnect().await;
                processor.push_frame(frame, direction).await?;
            }

            _ => processor.push_frame(frame, direction).await?,
        }

        Ok(())
    }
}
