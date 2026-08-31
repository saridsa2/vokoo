//! Speech-to-speech (realtime) sessions.
//!
//! A cascade puts STT, an LLM and TTS in a row, each a separate network hop
//! with its own latency and its own turn-assembly logic in between. A realtime
//! session replaces all three with one bidirectional audio socket: PCM in,
//! PCM out, with turn detection and interruption handled by the provider.
//!
//! The pipeline shape collapses from
//!
//! ```text
//! transport.input() → STT → UserAgg → LLM → AssistantAgg → TTS → transport.output()
//! ```
//!
//! to
//!
//! ```text
//! transport.input() → RealtimeProcessor → transport.output()
//! ```
//!
//! Three providers fit behind [`RealtimeSession`]:
//!
//! * **Gemini Live** — its own bidirectional protocol ([`gemini`]).
//! * **OpenAI Realtime** — the `/v1/realtime` event set.
//! * **Self-hosted** — HuggingFace's `speech-to-speech` exposes the *same*
//!   OpenAI Realtime event set, so it is the OpenAI implementation pointed at
//!   a different URL rather than a third implementation.
//!
//! Sample rates differ per provider (Gemini takes 16 kHz and emits 24 kHz), so
//! each session declares its own and the processor resamples at the boundary.

pub mod gemini;
pub mod openai;

use async_trait::async_trait;

/// What a realtime provider tells us, normalised across protocols.
#[derive(Debug, Clone)]
pub enum RealtimeEvent {
    /// PCM16 LE at the session's [`output_rate`](RealtimeSession::output_rate).
    Audio(Vec<u8>),
    /// Something the caller said.
    UserText(String),
    /// What the caller is still in the middle of saying.
    ///
    /// Live Transcribe models lead with these and finalise later, so a monitor
    /// that only listens for the settled text hears nothing for seconds at a
    /// time. Kept separate from [`UserText`](Self::UserText) because an interim
    /// line is superseded, not appended: writing it to the record would put the
    /// same sentence in three times, half-finished twice.
    UserTextInterim(String),
    /// The caller finished their turn. The clock for "how long until the agent
    /// answers" starts here — without it there is no t0 in realtime mode,
    /// because there is no local VAD and no STT frame to key off.
    UserTurnEnd,
    /// Something the agent said.
    AgentText(String),
    /// The caller spoke over the agent. Becomes a `SystemFrame::Interruption`,
    /// which the KooKoo serializer already turns into `{"command":"clearBuffer"}`.
    Interrupted,
    /// The agent finished its turn.
    TurnComplete,
    /// The model called a function. A flow declares one so the agent can say
    /// how it finished — asked for a person, out of its depth, done — instead
    /// of the bridge guessing from keywords.
    ToolCall { id: String, name: String, args: serde_json::Value },
    Error(String),
    Closed(String),
}

/// Enough to call the tool dispatcher for this call.
#[derive(Clone)]
pub struct ToolDispatch {
    pub supabase_url: String,
    pub service_key: String,
    pub org_id: String,
    pub ucid: String,
    /// The function the flow declared for reporting an outcome. It is answered
    /// by the flow, not by a tool, so it must not be dispatched.
    pub outcome_function: String,
}

/// One bidirectional audio session with a speech-to-speech provider.
#[async_trait]
pub trait RealtimeSession: Send {
    /// Rate this provider expects to be fed, in Hz.
    fn input_rate(&self) -> u32;

    /// Rate this provider emits, in Hz.
    fn output_rate(&self) -> u32;

    /// Send caller audio. PCM16 LE at [`input_rate`](Self::input_rate).
    async fn send_audio(&mut self, pcm: &[u8]) -> Result<(), String>;

    /// Answer a function the model called.
    ///
    /// `finish_call` needed nothing back: the agent reports how it finished and
    /// the flow decides what that means. A tool is the other case — the model
    /// asked a question and cannot continue the sentence until it hears the
    /// answer, so a session that can only receive a tool call leaves the caller
    /// in silence.
    ///
    /// `id` is the one from the [`RealtimeEvent::ToolCall`] being answered.
    /// Providers correlate on it, and a response carrying the wrong id is
    /// attached to the wrong question.
    ///
    /// Default: refuse. A provider that cannot answer should say so once here
    /// rather than have every caller test for it.
    async fn send_tool_response(
        &mut self,
        _id: &str,
        _name: &str,
        _result: serde_json::Value,
    ) -> Result<(), String> {
        Err("this provider cannot answer a tool call".into())
    }

    /// Send a text turn. Used to make the agent speak first — a realtime
    /// provider stays silent until something arrives, so without this the
    /// caller gets dead air until *they* talk.
    async fn send_text(&mut self, text: &str) -> Result<(), String>;

    /// Take the event stream. Returns `Some` exactly once.
    ///
    /// Deliberately not an `async fn next_event(&mut self)`: that forces the
    /// caller to hold the session across an await that idles for seconds
    /// between turns, which blocks [`send_audio`](Self::send_audio) and makes
    /// the call half-duplex. Handing the receiver out lets the two directions
    /// run in separate tasks with no shared lock.
    fn take_events(&mut self) -> Option<tokio::sync::mpsc::Receiver<RealtimeEvent>>;

    async fn close(&mut self);
}

// ---------------------------------------------------------------------------
// RealtimeProcessor
// ---------------------------------------------------------------------------

use crate::audio_process::resamplers::{ResamplerQuality, StreamResampler};
use crate::frames::{
    Frame, FrameDirection, FrameHandler, FrameInner, FrameProcessor, SystemFrame,
};
use std::sync::Arc;
use tokio::sync::Mutex;

const RESAMPLER_QUALITY: ResamplerQuality = ResamplerQuality::Medium;

fn pcm_to_f32(pcm: &[u8]) -> Vec<f32> {
    pcm.chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
        .collect()
}

fn f32_to_pcm(samples: &[f32]) -> Vec<u8> {
    samples
        .iter()
        .flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes())
        .collect()
}

/// Bridges a [`RealtimeSession`] into the frame pipeline.
///
/// Replaces the STT → aggregator → LLM → aggregator → TTS chain with a single
/// processor. Inbound caller audio goes straight to the provider; the
/// provider's audio, transcripts and interruptions come back as frames.
///
/// Providers rarely run at the pipeline's rate — Gemini takes 16 kHz and emits
/// 24 kHz — so both directions are resampled here rather than forcing one rate
/// on the whole pipeline.
pub struct RealtimeProcessor {
    session: Arc<Mutex<Box<dyn RealtimeSession>>>,
    pipeline_rate: u32,
    to_session: Arc<Mutex<Option<StreamResampler>>>,
    started: Arc<std::sync::atomic::AtomicBool>,
    greeting: Option<String>,
    /// Where a flow waits to hear how the agent node finished.
    outcomes: Option<tokio::sync::mpsc::Sender<(String, serde_json::Value)>>,
    tools: Option<ToolDispatch>,
    /// Listening rather than talking.
    ///
    /// Set after a transfer: the caller is speaking to a person now, and the
    /// agent stays on the line only to keep a record. While set, no audio the
    /// provider produces reaches the line and no caller audio reaches the
    /// conversational provider.
    listening: Arc<std::sync::atomic::AtomicBool>,
    /// Where caller audio goes once listening. A separate transcribe-only
    /// session drinks from here.
    tap: Arc<Mutex<Option<tokio::sync::mpsc::Sender<Vec<u8>>>>>,
    speaking: Arc<std::sync::atomic::AtomicBool>,
    spoken: Arc<tokio::sync::Notify>,
}

impl RealtimeProcessor {
    pub fn new(session: Box<dyn RealtimeSession>, pipeline_rate: u32) -> Self {
        let in_rate = session.input_rate();
        let to_session = (in_rate != pipeline_rate)
            .then(|| StreamResampler::new(pipeline_rate, in_rate, RESAMPLER_QUALITY));
        Self {
            session: Arc::new(Mutex::new(session)),
            pipeline_rate,
            to_session: Arc::new(Mutex::new(to_session)),
            started: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            greeting: None,
            outcomes: None,
            tools: None,
            speaking: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            spoken: Arc::new(tokio::sync::Notify::new()),
            listening: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            tap: Arc::new(Mutex::new(None)),
        }
    }

    /// A handle for switching the call from talking to listening.
    ///
    /// The processor is consumed by the pipeline once built, so the switch has
    /// to be reachable from outside it — the flow decides when a transfer has
    /// happened, and the flow does not own the pipeline.
    pub fn controls(&self) -> RealtimeControls {
        RealtimeControls {
            session: self.session.clone(),
            listening: self.listening.clone(),
            tap: self.tap.clone(),
            speaking: self.speaking.clone(),
            spoken: self.spoken.clone(),
        }
    }

    /// Where a tool call goes, and who it belongs to.
    ///
    /// This module handles audio and knows nothing about VoKoo's tables, so the
    /// dispatcher is described to it rather than reached for. Absent, a tool
    /// call other than the flow's own function is refused to the model — which
    /// is the truth, and better than silence while a caller waits.
    pub fn with_tools(mut self, tools: ToolDispatch) -> Self {
        self.tools = Some(tools);
        self
    }

    /// Where to report a function call, when a flow is waiting on one.
    pub fn with_outcomes(
        mut self,
        tx: tokio::sync::mpsc::Sender<(String, serde_json::Value)>,
    ) -> Self {
        self.outcomes = Some(tx);
        self
    }

    /// Text sent on connect to make the agent open the conversation.
    pub fn with_greeting(mut self, prompt: impl Into<String>) -> Self {
        self.greeting = Some(prompt.into());
        self
    }

    pub fn into_processor(self) -> FrameProcessor {
        FrameProcessor::new("Realtime", Box::new(self), false)
    }

    /// Drains provider events into the pipeline for the life of the call.
    async fn spawn_event_pump(&self, processor: FrameProcessor) {
        let pipeline_rate = self.pipeline_rate;
        let outcomes = self.outcomes.clone();
        let tools = self.tools.clone();
        let speaking = self.speaking.clone();
        let spoken = self.spoken.clone();
        let session = self.session.clone();
        let listening = self.listening.clone();
        let (out_rate, events) = {
            let mut s = self.session.lock().await;
            (s.output_rate(), s.take_events())
        };
        let Some(mut events) = events else {
            log::error!("[realtime] event stream already taken");
            return;
        };

        tokio::spawn(async move {
            let mut from_session = (out_rate != pipeline_rate)
                .then(|| StreamResampler::new(out_rate, pipeline_rate, RESAMPLER_QUALITY));
            let mut turn: u32 = 0;
            let mut t_user_end: Option<std::time::Instant> = None;
            let mut replied = true;

            loop {
                let Some(event) = events.recv().await else { break };

                let frame = match event {
                    RealtimeEvent::Audio(pcm) => {
                        speaking.store(true, std::sync::atomic::Ordering::Relaxed);
                        // Belt and braces. The listen-only session cannot make
                        // audio at all, but the conversational one may still
                        // have a chunk in flight when the switch happens, and
                        // one stray chunk is a voice cutting across two people.
                        if listening.load(std::sync::atomic::Ordering::Relaxed) {
                            continue;
                        }
                        if !replied {
                            replied = true;
                            if let Some(t0) = t_user_end {
                                log::info!(
                                    "[realtime][turn={turn}] t1 first agent audio  >>> {:.3}s <<<",
                                    t0.elapsed().as_secs_f64()
                                );
                            }
                        }
                        let bytes = match from_session.as_mut() {
                            Some(r) => f32_to_pcm(&r.process(&pcm_to_f32(&pcm))),
                            None => pcm,
                        };
                        if bytes.is_empty() {
                            continue;
                        }
                        Frame::output_audio(bytes, pipeline_rate, 1)
                    }
                    // The KooKoo serializer already turns an Interruption into
                    // {"command":"clearBuffer"} — barge-in wires itself.
                    RealtimeEvent::Interrupted => {
                        log::info!("[realtime] caller interrupted");
                        Frame::interruption()
                    }
                    // Gemini does not emit InputTranscriptionFinished, so the
                    // caller's transcript is the only turn boundary available.
                    RealtimeEvent::UserText(text) => {
                        // Gemini streams the caller's transcript in fragments,
                        // so this fires several times per utterance. Counting
                        // each one as a turn produced sixteen turns for three
                        // things the caller said. A turn starts at the first
                        // fragment after the agent last replied; the later
                        // fragments only move t0, which is what we want —
                        // the last fragment is the closest thing available to
                        // the moment the caller stopped speaking.
                        if replied {
                            turn += 1;
                        }
                        t_user_end = Some(std::time::Instant::now());
                        replied = false;
                        log::info!("[realtime][turn={turn}] t0 caller: {text}");
                        continue;
                    }
                    RealtimeEvent::UserTurnEnd => {
                        continue;
                    }
                    // Superseded by the final transcript; useful live, not
                    // worth a line in the record.
                    RealtimeEvent::UserTextInterim(_) => continue,
                    RealtimeEvent::AgentText(t) => {
                        log::info!("[realtime] agent: {t}");
                        continue;
                    }
                    // The end of a turn was discarded, which left nothing able to
                    // answer "has the caller heard this yet?". A hand-over acting
                    // on an outcome needs that answer or it cuts the agent off.
                    RealtimeEvent::TurnComplete => {
                        speaking.store(false, std::sync::atomic::Ordering::Relaxed);
                        spoken.notify_waiters();
                        continue;
                    }
                    // Reported, not acted on here: the flow owns what an
                    // outcome means, and this processor owns only audio.
                    RealtimeEvent::ToolCall { id, name, args } => {
                        log::info!("[realtime] agent called {name}({args})");

                        // The flow's own function is a report, not a request:
                        // the agent says how it finished and the flow decides
                        // what that means. Nothing goes back to the model, and
                        // dispatching it would look for a tool by that name.
                        let is_outcome = tools
                            .as_ref()
                            .map(|t| t.outcome_function == name)
                            .unwrap_or(true);
                        if is_outcome {
                            if let Some(tx) = outcomes.as_ref() {
                                let _ = tx.send((name, args)).await;
                            }
                            continue;
                        }

                        // A tool the model is waiting on. Answered on the same
                        // task that reads events, because the caller is mid
                        // sentence and the dispatcher's own budget is what
                        // bounds the wait.
                        let dispatch = tools.clone().expect("checked above");
                        let reply = crate::vokoo::tools::call_live(
                            &dispatch.supabase_url,
                            &dispatch.service_key,
                            &dispatch.org_id,
                            &dispatch.ucid,
                            &name,
                            args,
                        )
                        .await;
                        let mut guard = session.lock().await;
                        if let Err(e) = guard.send_tool_response(&id, &name, reply).await {
                            log::warn!("[realtime] could not answer {name}: {e}");
                        }
                        drop(guard);
                        continue;
                    }
                    RealtimeEvent::Error(e) => {
                        log::error!("[realtime] provider error: {e}");
                        continue;
                    }
                    RealtimeEvent::Closed(reason) => {
                        log::info!("[realtime] session closed: {reason}");
                        break;
                    }
                };

                if processor.push_frame(frame, FrameDirection::Downstream).await.is_err() {
                    break;
                }
            }
            log::debug!("[realtime] event pump exited");
        });
    }
}

/// Switches a live call from talking to listening.
pub struct RealtimeControls {
    session: Arc<Mutex<Box<dyn RealtimeSession>>>,
    listening: Arc<std::sync::atomic::AtomicBool>,
    tap: Arc<Mutex<Option<tokio::sync::mpsc::Sender<Vec<u8>>>>>,
    /// True between the first audio of a turn and the model finishing it.
    speaking: Arc<std::sync::atomic::AtomicBool>,
    /// Woken when a turn finishes, so a waiter does not have to poll.
    spoken: Arc<tokio::sync::Notify>,
}

impl RealtimeControls {
    /// Wait for the agent to finish the sentence it is in the middle of.
    ///
    /// The model reports an outcome the moment it has *decided*, not when the
    /// caller has *heard* it. Acting immediately cuts the agent off mid-word —
    /// on a hand-over the caller hears "I'm passing you to a—" and then ringing.
    ///
    /// Bounded, because a turn that never completes must not hold the call
    /// open: past the limit the flow proceeds and the tail is lost, which is
    /// the same outcome as today rather than a worse one.
    pub async fn wait_until_spoken(&self, limit: std::time::Duration) {
        if !self.speaking.load(std::sync::atomic::Ordering::Relaxed) {
            return;
        }
        let _ = tokio::time::timeout(limit, self.spoken.notified()).await;
        // The provider has stopped generating, but audio already handed to the
        // transport is still on its way to the caller. A short grace lets the
        // last chunks drain rather than being cut by the socket closing.
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    }
}

impl RealtimeControls {
    /// Stop talking; send caller audio to `tap` instead.
    ///
    /// The conversational session is closed rather than left idle: it is billed
    /// per minute of an open socket, it would otherwise keep listening for a
    /// turn that will never be addressed to it, and a session that is gone
    /// cannot be woken up by a stray frame.
    pub async fn listen_only(&self, tap: tokio::sync::mpsc::Sender<Vec<u8>>) {
        *self.tap.lock().await = Some(tap);
        // Order matters: the flag goes up before the session goes down, so
        // there is no window where audio is sent to a closing session.
        self.listening.store(true, std::sync::atomic::Ordering::SeqCst);
        self.session.lock().await.close().await;
        log::info!("[realtime] agent is listening only — outbound audio is off");
    }
}

#[async_trait]
impl FrameHandler for RealtimeProcessor {
    async fn on_process_frame(
        &self,
        processor: &FrameProcessor,
        frame: Frame,
        direction: FrameDirection,
    ) -> crate::error::Result<()> {
        use std::sync::atomic::Ordering;

        if matches!(&frame.inner, FrameInner::System(SystemFrame::Start(_)))
            && !self.started.swap(true, Ordering::SeqCst)
        {
            self.spawn_event_pump(processor.clone()).await;
            if let Some(prompt) = self.greeting.clone() {
                if let Err(e) = self.session.lock().await.send_text(&prompt).await {
                    log::warn!("[realtime] greeting failed: {e}");
                }
            }
        }

        if let FrameInner::System(SystemFrame::InputAudioRaw(a)) = &frame.inner {
            let pcm = match self.to_session.lock().await.as_mut() {
                Some(r) => f32_to_pcm(&r.process(&pcm_to_f32(&a.audio))),
                None => a.audio.to_vec(),
            };
            if !pcm.is_empty() {
                if self.listening.load(Ordering::Relaxed) {
                    // Straight past the agent to whoever is keeping the record.
                    // try_send rather than send: a slow transcriber must drop
                    // audio, never stall the call's inbound path.
                    if let Some(tap) = self.tap.lock().await.as_ref() {
                        let _ = tap.try_send(pcm);
                    }
                } else if let Err(e) = self.session.lock().await.send_audio(&pcm).await {
                    log::warn!("[realtime] send failed: {e}");
                }
            }
            // Caller audio is consumed here; it does not continue downstream.
            return Ok(());
        }

        processor.push_frame(frame, direction).await
    }
}
