//! VoKoo bridge — KooKoo/Ozonetel `<stream>` WebSocket ↔ rustvani pipeline.
//!
//! Two modes, selected by `PIPELINE_MODE`:
//!
//! * `echo`  — plays the caller back to themselves. No AI. This is the control:
//!             if the agent misbehaves, switching back proves in one call
//!             whether the transport still works.
//! * `agent` — Deepgram STT → LLM (OpenAI-compatible, so Gemini works) →
//!             Deepgram TTS, with Silero VAD for turn-taking.
//!
//! ## The speak-first rule
//!
//! KooKoo does not stream the caller's audio until our end produces some. An
//! echo bridge never speaks first, so both ends wait and the call is silent —
//! socket open, `start` and `stop` delivered, not one media frame between them.
//! This is not in Ozonetel's documentation; it was found by packet capture. The
//! SDK never trips over it because it connects to an AI that greets the caller.
//!
//! Both modes therefore emit a priming burst the moment the pipeline starts,
//! before anything has been received.
//!
//! Routes: GET /health · ANY /kookoo · GET /ws

use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use async_trait::async_trait;
use axum::{
    Json, Router,
    extract::{
        Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{StatusCode, header},
    response::IntoResponse,
    routing::{any, get, post},
};

use serde_json::json;
use rustvani::error::Result;
use rustvani::observer::{BaseObserver, FramePushed, FrameProcessed};
use rustvani::billing::BillingCollector as _;
use rustvani::frames::{
    ControlFrame, Frame, FrameDirection, FrameHandler, FrameInner, FrameProcessor, SystemFrame,
};
use rustvani::processors::{
    llm_assistant_aggregator::LLMAssistantAggregator, llm_user_aggregator::LLMUserAggregator,
};
use rustvani::serializers::{
    AudioSocketFrameSerializer, CallCapture, KooKooFrameSerializer, KooKooInputParams, KooKooStart,
};
use rustvani::services::{
    GeminiLiveConfig, GeminiLiveSession,
    RealtimeControls, RealtimeEvent, RealtimeProcessor, RealtimeSession,
    DeepgramSttConfig, DeepgramSttHandler, DeepgramTtsConfig, DeepgramTtsHandler, OpenAILLMConfig,
    OpenAILLMHandler,
};
use rustvani::transport::TransportParams;
use rustvani::transport::audiosocket::{
    AudioSocketHandshake, AudioSocketParams, AudioSocketTransport, UUID_WAIT, await_uuid,
};
use rustvani::transport::websocket::{WebSocketParams, WebSocketTransport};
use rustvani::{
    FrameKind, PipelineParams, PipelineTask, SileroVadNative, VadParams, shared_context,
    system_clock,
};

/// VAD and STT both want 16 kHz; the serializer resamples to KooKoo's 8 kHz.
const PIPELINE_SAMPLE_RATE: u32 = 16_000;

/// Must pair with `KOOKOO_FRAME_SAMPLES` in the serializer: 1 chunk = 10 ms =
/// 80 samples at 8 kHz = exactly one media packet.
///
/// KooKoo's `start` event declares `numberOfFrames: 160` for the INBOUND
/// direction, and setting this to 2 to match cost half the outbound audio —
/// the serializer emits one packet per call, so the extra 80 samples queued up
/// and never caught up. Inbound framing and outbound framing are independent;
/// don't copy one to the other.
const AUDIO_OUT_10MS_CHUNKS: u32 = 1;

/// The two constants above are one decision. Getting them out of step costs
/// half the outbound audio and produces no error — so make it a build failure.
const _: () = assert!(
    rustvani::serializers::KOOKOO_FRAME_SAMPLES == 80 * AUDIO_OUT_10MS_CHUNKS as usize,
    "KOOKOO_FRAME_SAMPLES must equal 80 * AUDIO_OUT_10MS_CHUNKS, or the \
     serializer buffers half of every chunk and outbound audio falls behind"
);

/// AudioSocket's pairing of the same two constants: 2 chunks = 20 ms, and the
/// serializer's frame is 20 ms at whatever rate the wire runs at, so one
/// pipeline chunk is exactly one frame however wide the channel is.
const AUDIOSOCKET_OUT_10MS_CHUNKS: u32 = 2;

const _: () = assert!(
    AUDIOSOCKET_OUT_10MS_CHUNKS as usize * 10
        == 1000 / rustvani::serializers::audiosocket::FRAMES_PER_SECOND as usize,
    "a pipeline chunk and an AudioSocket frame must cover the same span, or the \
     serializer buffers part of every chunk and outbound audio falls behind"
);

const HANDSHAKE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

static CALL_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct AppState {
    ws_url: String,
    sip_number: String,
    is_sip: String,
    ivr_mode: String,
    cfg: Arc<AgentConfig>,
    /// Set by a call's flow, read by the IVR webhook after that call's socket
    /// has closed. The two never share anything else.
    handovers: rustvani::vokoo::Handovers,
    /// What each call has pressed, written by the IVR webhook and read by both
    /// it and the socket handler. A menu is asked on one HTTP request and
    /// answered on another, so the answer cannot live in either.
    keypresses: rustvani::vokoo::Keypresses,
    /// Calls Asterisk has announced and is about to stream. Written by
    /// `/asterisk/incoming`, read by the AudioSocket listener — the same
    /// two-requests-one-fact shape as `keypresses`, because AudioSocket carries
    /// a uuid and no call metadata at all.
    pending: rustvani::vokoo::PendingCalls,
}

struct AgentConfig {
    internal_token: String,
    pipeline_mode: String,
    supabase_url: String,
    service_key: String,
    deepgram_key: String,
    llm_key: String,
    llm_base_url: String,
    llm_model: String,
    reasoning_effort: String,
    max_reply_tokens: u32,
    realtime_provider: String,
    realtime_base_url: String,
    realtime_key: String,
    live_model: String,
    transcript_languages: Vec<String>,
    live_voice: String,
    stt_language: String,
    tts_voice: String,
    system_prompt: String,
}

/// Write the steps the runner has taken since this was last called.
///
/// Called wherever the flow pauses — before the conversation, and after it —
/// rather than only at the end, because the end is exactly when a call is most
/// likely to be cut short.
/// Which model listens once the agent stops talking.
///
/// A dedicated transcription model rather than the conversational one: asking a
/// model built to reply to please not reply is a policy, and a policy can be
/// talked out of. This one has no speech to give.
const LISTEN_MODEL: &str = "models/gemini-3.5-transcribe-live";

/// Hand the rest of the call to a listener.
///
/// Returns false if the listener could not be opened, which the flow routes on:
/// failing to record a transferred call is worth knowing about, and it is not a
/// reason to drop a caller who is now talking to a person.
async fn start_listening(
    call: u64,
    controls: &RealtimeControls,
    api_key: String,
    record: Arc<rustvani::vokoo::CallRecord>,
    limit_seconds: u64,
) -> bool {
    let mut session = match GeminiLiveSession::connect(GeminiLiveConfig {
        api_key,
        model: LISTEN_MODEL.to_string(),
        voice: None,
        instructions: String::new(),
        functions: Vec::new(),
        // The transcribe model is the one that honours these, so the part of
        // the call handled by a person is the part most likely to be written
        // down in the right language.
        language_codes: vec!["en-IN".into(), "en-US".into()],
        // The listener writes down what two people say; it does not answer, so
        // the engine's reply parameters do not apply to it.
        temperature: None,
        max_output_tokens: None,
        transcribe_only: true,
    })
    .await
    {
        Ok(s) => s,
        Err(e) => {
            log::warn!("[call={call}] could not open the listener: {e}");
            return false;
        }
    };

    let Some(mut events) = session.take_events() else { return false };

    // The tap carries audio already resampled to the conversational session's
    // input rate. Both Gemini models take 16 kHz, so it passes through — if that
    // ever stops being true this is where it breaks.
    let (tap_tx, mut tap_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);

    tokio::spawn(async move {
        let pump = async {
            while let Some(pcm) = tap_rx.recv().await {
                if session.send_audio(&pcm).await.is_err() {
                    break;
                }
            }
        };
        tokio::select! {
            _ = pump => {}
            _ = tokio::time::sleep(std::time::Duration::from_secs(limit_seconds)) => {
                log::warn!("[call={call}] stopped listening after {limit_seconds}s");
            }
        }
        session.close().await;
    });

    tokio::spawn(async move {
        // Live Transcribe models only ever send interim text, each one
        // replacing the last. A line is finished when the next interim is not
        // an extension of it — that is the only boundary on offer, so it is the
        // one used.
        let mut line = String::new();
        while let Some(event) = events.recv().await {
            match event {
                RealtimeEvent::UserTextInterim(text) => {
                    if !line.is_empty() && !text.starts_with(&line) {
                        log::info!("[call={call}] [heard] {line}");
                        record.transcript_line("call", &line);
                    }
                    line = text;
                }
                RealtimeEvent::UserText(text) => {
                    log::info!("[call={call}] [heard] {text}");
                    record.transcript_line("call", &text);
                    line.clear();
                }
                RealtimeEvent::Closed(reason) => {
                    log::info!("[call={call}] listener closed: {reason}");
                    break;
                }
                _ => continue,
            }
        }
        // Whatever was still being said when the call ended.
        if !line.is_empty() {
            log::info!("[call={call}] [heard] {line}");
            record.transcript_line("call", &line);
        }
    });

    controls.listen_only(tap_tx).await;
    true
}

fn write_trail(
    record: &rustvani::vokoo::CallRecord,
    runner: &rustvani::vokoo::FlowRunner<'_>,
    written: &mut usize,
    trigger: &str,
) {
    for (offset, step) in runner.trail.iter().skip(*written).enumerate() {
        // The runner's own position in the walk is the sequence. Letting the
        // database derive one raced, because these writes are spawned.
        record.step(
            *written + offset + 1,
            &step.node_id,
            &step.name,
            &step.implementation,
            &step.outcome,
            0,
            // Which handler this step belonged to. It was written as
            // "call.answered" whatever ran, which made the conversation and any
            // post-call work indistinguishable in one call's timeline — the
            // thing call_events.trigger_event exists to separate.
            trigger,
            serde_json::json!({}),
        );
    }
    *written = runner.trail.len();
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

impl AgentConfig {
    fn from_env() -> Self {
        Self {
            // Shared with the control plane, which is the only caller. Empty
            // refuses every request rather than allowing them: an unset secret
            // must not mean an open endpoint.
            internal_token: env_or("BRIDGE_INTERNAL_TOKEN", ""),
            pipeline_mode: env_or("PIPELINE_MODE", "echo"),
            supabase_url: env_or("SUPABASE_URL", ""),
            service_key: env_or("SUPABASE_SERVICE_ROLE_KEY", ""),
            deepgram_key: env_or("DEEPGRAM_API_KEY", ""),
            llm_key: env_or("LLM_API_KEY", ""),
            // Gemini speaks OpenAI's protocol at this base, so no new code is
            // needed for it; swap the URL for OpenAI or anything compatible.
            llm_base_url: env_or(
                "LLM_BASE_URL",
                "https://generativelanguage.googleapis.com/v1beta/openai",
            ),
            llm_model: env_or("LLM_MODEL", "gemini-2.5-flash"),
            // Thinking models spend completion budget reasoning before they
            // emit anything. Measured on gemini-2.5-flash: 27 tokens of
            // thinking for a 2-token reply, and an EMPTY reply if the budget
            // runs out first. On a phone turn that is latency for nothing.
            // gemini | openai. "openai" also drives a self-hosted HuggingFace
            // speech-to-speech deployment — same protocol, different URL.
            realtime_provider: env_or("REALTIME_PROVIDER", "gemini"),
            realtime_base_url: env_or("REALTIME_BASE_URL", "wss://api.openai.com/v1/realtime"),
            realtime_key: env_or("REALTIME_API_KEY", ""),
            live_model: env_or("LIVE_MODEL", "models/gemini-3.1-flash-live-preview"),
            // Who is expected to be on the line. Automatic detection put German
            // in the record of an English call.
            transcript_languages: env_or("TRANSCRIPT_LANGUAGES", "en-IN,en-US")
                .split(',')
                .map(|code| code.trim().to_string())
                .filter(|code| !code.is_empty())
                .collect(),
            live_voice: env_or("LIVE_VOICE", "Kore"),
            reasoning_effort: env_or("REASONING_EFFORT", "none"),
            // ~120 tokens is roughly 8 seconds of speech; a phone turn should
            // be far shorter than that, and this is the backstop.
            max_reply_tokens: env_or("MAX_REPLY_TOKENS", "120").parse().unwrap_or(120),
            stt_language: env_or("STT_LANGUAGE", "multi"),
            tts_voice: env_or("TTS_VOICE", "aura-2-helena-en"),
            system_prompt: env_or(
                "SYSTEM_PROMPT",
                "You are a phone receptionist on an Indian telephone line. Keep replies to \
                 one or two short sentences - this is speech, not text, so no markdown, no \
                 lists, no emoji. Speak naturally. If you do not know something, say so \
                 plainly rather than guessing.",
            ),
        }
    }

    fn agent_ready(&self) -> bool {
        !self.deepgram_key.is_empty() && !self.llm_key.is_empty()
    }
}

/// 300 ms of digital silence at the pipeline rate.
///
/// Inaudible, but it is real audio data, and sending it is what makes KooKoo
/// begin streaming the caller. In agent mode the greeting would eventually do
/// the same job, but not until the LLM and TTS have both round-tripped — this
/// opens the inbound direction immediately so no caller speech is lost while
/// the first reply is still being generated.
fn priming_silence(rate: u32) -> Vec<u8> {
    vec![0u8; (rate as usize / 1000) * 300 * 2]
}

// ---------------------------------------------------------------------------
// Latency instrumentation
// ---------------------------------------------------------------------------
//
// Ported from rustvani's websocket_server example. The point is to never argue
// about which slot is slow: every turn prints t0..t4 and a total, so the
// expensive hop is named rather than guessed at. Half of today went to
// theorising in the absence of numbers.

struct TurnState {
    turn: u32,
    in_turn: bool,
    t_vad: f64,
    t_stt: Option<f64>,
    t_llm_start: Option<f64>,
    t_llm_end: Option<f64>,
    tts_first: bool,
}

struct LatencyObserver {
    call: u64,
    state: std::sync::Mutex<TurnState>,
}

impl LatencyObserver {
    fn new(call: u64) -> Self {
        Self {
            call,
            state: std::sync::Mutex::new(TurnState {
                turn: 0,
                in_turn: false,
                t_vad: 0.0,
                t_stt: None,
                t_llm_start: None,
                t_llm_end: None,
                tts_first: false,
            }),
        }
    }
}

#[async_trait]
impl BaseObserver for LatencyObserver {
    async fn on_push_frame(&self, _event: FramePushed) {}

    async fn on_process_frame(&self, event: FrameProcessed) {
        let ts = event.timestamp;
        let call = self.call;
        let mut s = self.state.lock().unwrap();

        match event.frame.kind() {
            FrameKind::VADUserStoppedSpeaking => {
                if !s.in_turn {
                    s.turn += 1;
                    s.in_turn = true;
                    s.t_vad = ts;
                    s.t_stt = None;
                    s.t_llm_start = None;
                    s.t_llm_end = None;
                    s.tts_first = false;
                    log::info!("[call={call}][turn={}] t0 VAD stop", s.turn);
                }
            }
            FrameKind::Transcription => {
                if s.in_turn && s.t_stt.is_none() {
                    s.t_stt = Some(ts);
                    log::info!(
                        "[call={call}][turn={}] t1 STT      +{:.3}s",
                        s.turn, ts - s.t_vad
                    );
                }
            }
            FrameKind::LLMFullResponseStart => {
                if s.in_turn && s.t_llm_start.is_none() {
                    s.t_llm_start = Some(ts);
                    let from = s.t_stt.unwrap_or(s.t_vad);
                    log::info!(
                        "[call={call}][turn={}] t2 LLM 1st  +{:.3}s",
                        s.turn, ts - from
                    );
                }
            }
            FrameKind::LLMFullResponseEnd => {
                if s.in_turn && s.t_llm_end.is_none() {
                    s.t_llm_end = Some(ts);
                    let from = s.t_llm_start.unwrap_or(s.t_vad);
                    log::info!(
                        "[call={call}][turn={}] t3 LLM end  +{:.3}s",
                        s.turn, ts - from
                    );
                }
            }
            FrameKind::OutputAudioRaw => {
                if s.in_turn && !s.tts_first {
                    s.tts_first = true;
                    let from = s.t_llm_end.unwrap_or(s.t_vad);
                    log::info!(
                        "[call={call}][turn={}] t4 TTS 1st  +{:.3}s   >>> TOTAL {:.3}s <<<",
                        s.turn, ts - from, ts - s.t_vad
                    );
                    s.in_turn = false;
                }
            }
            _ => {}
        }
    }
}

struct EchoHandler;

#[async_trait]
impl FrameHandler for EchoHandler {
    async fn on_process_frame(
        &self,
        processor: &FrameProcessor,
        frame: Frame,
        direction: FrameDirection,
    ) -> Result<()> {
        if let FrameInner::System(SystemFrame::InputAudioRaw(a)) = &frame.inner {
            let echoed = Frame::output_audio(a.audio.clone(), a.sample_rate, a.num_channels);
            processor.push_frame(echoed, direction).await?;
        }
        processor.push_frame(frame, direction).await
    }
}

/// Emits the priming burst on pipeline start, then gets out of the way.
/// Milliseconds since the epoch. A clock that only has to measure a gap.
fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Opens the inbound direction, and watches that it stays open.
///
/// The watchdog exists because of a call on 1 September that stopped and said
/// nothing: the agent asked a question, the caller answered, and for
/// forty-two seconds there was no VAD transition, no audio frame and no error —
/// until the caller gave up. Every other turn logs `VAD server: → Speaking`
/// within milliseconds, so caller audio had stopped reaching the pipeline
/// rather than being misheard. Nothing recorded that, so there was nothing to
/// diagnose from.
///
/// This sits immediately after `transport.input()`, which makes it the first
/// place a frame from the carrier is seen. The count it reports is the number of
/// audio frames that reached *here*; `CALL_SUMMARY` reports what the socket
/// received. When the two disagree the gap is inside the bridge, and when they
/// agree the carrier stopped sending — which are different problems and, until
/// now, indistinguishable.
struct Primer {
    call: u64,
    /// Milliseconds since the epoch, as of the last audio frame.
    last_audio: Arc<std::sync::atomic::AtomicU64>,
    /// Audio frames seen since the call began.
    seen: Arc<std::sync::atomic::AtomicU64>,
    /// Cleared when the call ends, so the watchdog stops with it.
    live: Arc<std::sync::atomic::AtomicBool>,
    /// Where a stall is reported. The Primer does not decide what to do about
    /// one — the call loop owns that, and owns the socket that has to close
    /// for the carrier to ask us where the call goes next.
    fault: Option<tokio::sync::mpsc::Sender<rustvani::vokoo::Cause>>,
}

impl Primer {
    fn new(call: u64) -> Self {
        Self {
            call,
            last_audio: Arc::new(std::sync::atomic::AtomicU64::new(now_millis())),
            seen: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            live: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            fault: None,
        }
    }

    fn reporting_to(mut self, fault: tokio::sync::mpsc::Sender<rustvani::vokoo::Cause>) -> Self {
        self.fault = Some(fault);
        self
    }

    /// Complain when the caller's audio stops, and say so again when it returns.
    ///
    /// Two seconds of silence is a caller thinking. Ten is a fault — and the
    /// point is to record the moment it began, not to act on it: this only
    /// writes to the log, because a bridge that hangs up on a quiet line would
    /// be a worse failure than the one it is diagnosing.
    fn watch(&self) {
        use std::sync::atomic::Ordering;
        let (call, last, seen, live, fault) = (
            self.call,
            self.last_audio.clone(),
            self.seen.clone(),
            self.live.clone(),
            self.fault.clone(),
        );
        tokio::spawn(async move {
            const QUIET_MS: u64 = 10_000;
            // Escalate well after the warning. Input frames arrive at roughly
            // fifty a second whether or not anybody is talking — silence is
            // still frames — so twenty seconds of *none* is a broken audio
            // path, not a quiet caller. The distinction is what makes it safe
            // to act on: this cannot fire on someone who has stopped speaking.
            const BROKEN_MS: u64 = 20_000;
            let mut complained = false;
            let mut escalated = false;
            while live.load(Ordering::Relaxed) {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                let gap = now_millis().saturating_sub(last.load(Ordering::Relaxed));
                if gap >= QUIET_MS && !complained {
                    complained = true;
                    log::warn!(
                        "[call={call}] no caller audio for {:.1}s — {} audio frame(s) so far. \
                         Compare with media_packets_in in CALL_SUMMARY: if that kept rising, the \
                         audio stopped inside the bridge.",
                        gap as f64 / 1000.0,
                        seen.load(Ordering::Relaxed)
                    );
                } else if gap < QUIET_MS && complained {
                    complained = false;
                    log::warn!("[call={call}] caller audio resumed");
                }

                if gap >= BROKEN_MS && !escalated {
                    escalated = true;
                    log::error!(
                        "[call={call}] no caller audio for {:.0}s — the line is broken, escalating",
                        gap as f64 / 1000.0
                    );
                    if let Some(fault) = fault.as_ref() {
                        let _ = fault.send(rustvani::vokoo::Cause::NoAudio).await;
                    }
                }
            }
        });
    }
}

#[async_trait]
impl FrameHandler for Primer {
    async fn on_process_frame(
        &self,
        processor: &FrameProcessor,
        frame: Frame,
        direction: FrameDirection,
    ) -> Result<()> {
        use std::sync::atomic::Ordering;

        match &frame.inner {
            FrameInner::System(SystemFrame::Start(_)) => {
                log::info!("[primer] opening the inbound direction");
                self.last_audio.store(now_millis(), Ordering::Relaxed);
                self.watch();
                let silence = Frame::output_audio(
                    priming_silence(PIPELINE_SAMPLE_RATE),
                    PIPELINE_SAMPLE_RATE,
                    1,
                );
                processor.push_frame(silence, direction).await?;
            }

            FrameInner::System(SystemFrame::InputAudioRaw(_)) => {
                self.last_audio.store(now_millis(), Ordering::Relaxed);
                self.seen.fetch_add(1, Ordering::Relaxed);
            }

            FrameInner::Control(ControlFrame::End { .. })
            | FrameInner::System(SystemFrame::Cancel { .. }) => {
                self.live.store(false, Ordering::Relaxed);
            }

            _ => {}
        }

        processor.push_frame(frame, direction).await
    }
}

fn xml(body: String) -> impl IntoResponse {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/xml; charset=utf-8")],
        format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<response>\n{body}\n</response>"),
    )
}

/// Ask the caller to press a key.
///
/// The prompt is spoken by the **carrier**, not by an engine — this is returned
/// before any stream exists, which is the whole reason a language menu can work
/// at all. It also means the menu is read by Google's voice rather than the
/// one the call will use, and that is the trade: the alternative is choosing a
/// language after the transcriber has already opened in one.
///
/// Three details of the verb, from KooKoo's own reference and each one a way
/// to get it wrong:
///
/// * **The prompt nests inside the tag.** Not before it — the tag's content is
///   what to play while waiting.
/// * **`o` is the timeout in milliseconds. `t` is the terminating character**,
///   `#` by default. A first version read `t` as the timeout and set the
///   terminator to the string "8000".
/// * **There is no URL.** The tag takes none; the carrier always calls back to
///   the application URL configured in the portal. Which is why the node that
///   asked cannot be carried in the callback and is remembered per call
///   instead — see `Keypresses::asking`.
///
/// `l="1"` returns on the first key, so a language menu needs no terminator.
fn collect_digits_xml(prompt: &str, language: &str, timeout_seconds: u64) -> String {
    format!(
        "    <collectdtmf l=\"1\" o=\"{ms}\">\n        \
         <playtext lang=\"{lang}\" speed=\"3\" quality=\"best\" type=\"ggl\">{prompt}</playtext>\n    \
         </collectdtmf>",
        ms = timeout_seconds.saturating_mul(1000),
        lang = rustvani::vokoo::escape(language),
        prompt = rustvani::vokoo::escape(prompt),
    )
}

pub fn new_call_xml(
    params: &BTreeMap<String, String>,
    ws_url: &str,
    sip_number: &str,
    is_sip: &str,
) -> String {
    let uui = serde_json::to_string(params)
        .unwrap_or_else(|_| "{}".to_string())
        .replace('\'', "&apos;");
    format!(
        "    <start-record/>\n    <stream is_sip=\"{is_sip}\" url=\"{ws_url}\" x-uui='{uui}'>{sip_number}</stream>"
    )
}

/// Would this engine work?
///
/// The bridge answers because it is the only process that may read a provider
/// key — `resolve_vendor_secret` is `service_role` only, and the control plane
/// deliberately holds no service key. So the control plane gates the request on
/// the caller's organisation and forwards it here with a shared secret.
/// Walk a flow against a finished call, changing nothing.
///
/// What the console's node view shows in its Input and Output panes. The same
/// walk a real hangup takes — the difference is one flag, which withholds the
/// write to the call and the request to the outside world.
///
/// Gated like pre-flight, and for the same reason: reading a transcript needs a
/// provider key, and the bridge is the only process allowed to hold one.
#[derive(serde::Deserialize)]
struct DryRunRequest {
    flow_id: String,
    /// The carrier's id for a finished call. Its transcript is what the flow
    /// is tested against — a made-up one would test the flow against nothing.
    ucid: String,
}

async fn flow_dry_run(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(request): Json<DryRunRequest>,
) -> impl IntoResponse {
    let presented = headers
        .get("x-vokoo-internal")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if state.cfg.internal_token.is_empty() || presented != state.cfg.internal_token {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "forbidden" })));
    }

    match rustvani::vokoo::postcall::dry_run(
        &state.cfg.supabase_url,
        &state.cfg.service_key,
        &request.flow_id,
        &request.ucid,
    )
    .await
    {
        Ok(steps) => (StatusCode::OK, Json(json!({ "ok": true, "steps": steps }))),
        Err(problem) => (StatusCode::OK, Json(json!({ "ok": false, "error": problem }))),
    }
}

async fn engine_preflight(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(request): Json<PreflightRequest>,
) -> impl IntoResponse {
    let presented = headers
        .get("x-vokoo-internal")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    // Constant-time is overkill for a shared secret behind a private network,
    // but an empty configured token matching an empty header is not.
    if state.cfg.internal_token.is_empty() || presented != state.cfg.internal_token {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "forbidden" })));
    }

    let Some((engine, org_id)) = rustvani::vokoo::graph::engine_by_id(
        &state.cfg.supabase_url,
        &state.cfg.service_key,
        &request.engine_id,
    )
    .await
    else {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "no such engine" })));
    };

    let ctx = rustvani::vokoo::StageContext {
        // Pre-flight opens the real connections but serves no caller, so there
        // is no session to attribute its usage to. It does cost the vendor
        // something; that cost is deliberately unattributed rather than
        // charged to whichever call happens to run next.
        billing: std::sync::Arc::new(rustvani::billing::NoopBillingCollector),
        supabase_url: &state.cfg.supabase_url,
        service_key: &state.cfg.service_key,
        org_id: &org_id,
        sample_rate: PIPELINE_SAMPLE_RATE,
    };

    let steps = rustvani::vokoo::engine::preflight(&engine, &ctx).await;
    let ok = steps.iter().all(|step| step.ok);
    log::info!(
        "[preflight] engine '{}' ({}) — {}",
        engine.name,
        engine.mode,
        if ok { "ready" } else { "not ready" }
    );

    (StatusCode::OK, Json(json!({ "engine": engine.name, "mode": engine.mode, "ok": ok, "steps": steps })))
}

#[derive(serde::Deserialize)]
struct PreflightRequest {
    engine_id: String,
}

/// Ask every connected provider what it currently offers.
///
/// Same gate and same reason as pre-flight: it needs provider keys, and the
/// bridge is the only process that may read one.
async fn catalogue_refresh(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(request): Json<RefreshRequest>,
) -> impl IntoResponse {
    let presented = headers
        .get("x-vokoo-internal")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if state.cfg.internal_token.is_empty() || presented != state.cfg.internal_token {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "forbidden" })));
    }

    let found = rustvani::vokoo::discovery::refresh(
        &state.cfg.supabase_url,
        &state.cfg.service_key,
        &request.org_id,
    )
    .await;
    log::info!("[discovery] refreshed {} stage(s)", found.len());
    (StatusCode::OK, Json(json!({ "refreshed": found })))
}

#[derive(serde::Deserialize)]
struct RefreshRequest {
    org_id: String,
}

/// What the IVR should return next, given what the caller has pressed so far.
///
/// Walks the flow in preview — evaluating opening hours and the like, but
/// touching nothing on the carrier, because the socket handler walks the same
/// flow for real a moment later and anything done here would be done twice.
///
/// `Some(xml)` is a menu to ask. `None` means the flow wants no more keys, and
/// the caller of this should hand back the stream.
async fn next_menu_xml(state: &AppState, params: &BTreeMap<String, String>) -> Option<String> {
    let ucid = params.get("sid").map(String::as_str).unwrap_or_default();
    let did = params.get("called_number").map(String::as_str).unwrap_or_default();
    if ucid.is_empty() || did.is_empty() {
        return None;
    }

    let cfg = &state.cfg;
    let flow = rustvani::vokoo::graph::resolve_for_did(&cfg.supabase_url, &cfg.service_key, did).await?;
    let control = rustvani::vokoo::CallControl::new(
        rustvani::vokoo::CallHandle {
            ucid: ucid.to_string(),
            did: did.to_string(),
            caller: params.get("cid").cloned().unwrap_or_default(),
            org_id: flow.org_id.clone(),
        },
        cfg.supabase_url.clone(),
        cfg.service_key.clone(),
        state.handovers.clone(),
    );

    let mut runner = rustvani::vokoo::FlowRunner::new(&flow, &control)
        .preview()
        .already_answered(state.keypresses.all(ucid));

    match runner.advance().await {
        rustvani::vokoo::NodeAction::CollectDigits {
            node, prompt, language, keys, timeout_seconds, ..
        } => {
            state.keypresses.asking(ucid, &node.id);
            log::info!(
                "[IVR] ucid={ucid} asking {} ({} key(s): {})",
                node.name,
                keys.len(),
                keys.iter().map(|(k, l)| format!("{k}={l}")).collect::<Vec<_>>().join(", ")
            );
            Some(collect_digits_xml(&prompt, &language, timeout_seconds))
        }
        other => {
            if let rustvani::vokoo::NodeAction::Finished(reason) = &other {
                log::info!("[IVR] ucid={ucid} no menu before the conversation: {reason}");
            }
            None
        }
    }
}

/// The key the carrier collected, whatever it decided to call the parameter.
///
/// The platform doc has the verb and not the callback, so rather than assert a
/// name this reads the first plausible one that holds a single keypad
/// character. Every parameter is logged either way, which is what will replace
/// this guess with a fact.
fn collected_key(params: &BTreeMap<String, String>) -> Option<String> {
    const LIKELY: &[&str] = &["data", "digits", "dtmf", "signal", "input", "collectdtmf"];
    LIKELY.iter().find_map(|name| {
        let value = params.get(*name)?.trim();
        let mut chars = value.chars();
        let first = chars.next()?;
        // One keypad character, and nothing after it.
        if chars.next().is_none() && (first.is_ascii_digit() || first == '*' || first == '#') {
            Some(first.to_string())
        } else {
            None
        }
    })
}

async fn kookoo_webhook(
    State(state): State<AppState>,
    Query(params): Query<BTreeMap<String, String>>,
) -> impl IntoResponse {
    let event = params.get("event").map(String::as_str).unwrap_or("");
    let is_test_ping = !params.contains_key("sid") && !params.contains_key("cid");

    // Log every parameter. telco_code, message, status and the recording URL
    // all arrive this way and are the only explanation of why a leg failed.
    log::info!(
        "[IVR] event={event} test_ping={is_test_ping} params={}",
        serde_json::to_string(&params).unwrap_or_default()
    );

    // How the carrier actually answers a `<collectdtmf>`, measured on a real
    // call on 1 September:
    //
    //     event=GotDTMF  sid=82664099658379233  data=2
    //
    // Note what is *not* there: which menu asked. A first version put a
    // `vokoo_menu` marker in a URL on the `<collectdtmf>` tag and matched on
    // it. It never arrived — **the tag takes no URL at all**; the carrier
    // always calls back to the application URL from the portal. Custom query
    // params on *that* URL are echoed back, but it is one URL for every call
    // and every menu, so it cannot say which node is waiting.
    //
    // So the node is remembered per call. The cost of getting this wrong was
    // measured: the marker never matched, the request fell through to the
    // unknown-event arm, and a bare 200 to a live call is a hang-up ten
    // seconds in.
    //
    // The marker is still read first, in case a future firmware carries one.
    let awaiting = params.get("sid").and_then(|ucid| state.keypresses.awaiting(ucid));
    let menu_node = params.get("vokoo_menu").cloned().or_else(|| {
        (event == "GotDTMF").then_some(awaiting).flatten()
    });
    if let Some(node_id) = menu_node.as_deref() {
        let ucid = params.get("sid").map(String::as_str).unwrap_or_default();
        match collected_key(&params) {
            Some(key) => {
                log::info!("[IVR] ucid={ucid} pressed {key} at {node_id}");
                state.keypresses.record(ucid, node_id, &key);
            }
            None => {
                // Nothing pressed, or pressed something we could not find in
                // the parameters. `timeout` is the outcome the node declares
                // for exactly this, and it is wired to a branch.
                log::warn!(
                    "[IVR] ucid={ucid} no key found in the callback for {node_id} — taking timeout. params={}",
                    serde_json::to_string(&params).unwrap_or_default()
                );
                state.keypresses.record(ucid, node_id, "timeout");
            }
        }

        // Another menu, or on with the call.
        return match next_menu_xml(&state, &params).await {
            Some(menu) => xml(menu).into_response(),
            None => xml(new_call_xml(&params, &state.ws_url, &state.sip_number, &state.is_sip))
                .into_response(),
        };
    }

    match event {
        "NewCall" if state.ivr_mode == "playtext" => xml(
            "    <playtext lang=\"en-IN\">Hello. This is VoKoo. The webhook is working. Goodbye.</playtext>\n    <hangup/>".to_string(),
        )
        .into_response(),
        // A test ping never opens a socket, so previewing its flow would ask a
        // question nobody is there to answer. It gets the stream XML it is
        // checking for and no side effects, which is what it is testing.
        "NewCall" if is_test_ping => {
            xml(new_call_xml(&params, &state.ws_url, &state.sip_number, &state.is_sip))
                .into_response()
        }
        "NewCall" => {
            // Does this flow want a key before it wants a conversation? Only a
            // menu reached before anything touches the carrier counts — see
            // `next_menu_xml`.
            match next_menu_xml(&state, &params).await {
                Some(menu) => xml(menu).into_response(),
                None => xml(new_call_xml(&params, &state.ws_url, &state.sip_number, &state.is_sip))
                    .into_response(),
            }
        }
        // The call is still up here. Whether it stays up is decided by what we
        // return: a flow that asked for a hand-over gets dialled out, and
        // everything else gets the goodbye this used to give everybody.
        "Stream" => {
            let ucid = params.get("sid").map(String::as_str).unwrap_or_default();
            match state.handovers.take(ucid) {
                Some(handover) => {
                    // Leave the fallback behind before dialling. The carrier
                    // tells us whether the number answered on a *later* webhook,
                    // by which point the flow has ended and the agent is gone —
                    // so what the caller hears if nobody picks up has to be
                    // written down now or it does not exist.
                    if let rustvani::vokoo::Handover::Dial { on_no_answer, .. } = &handover {
                        if !on_no_answer.is_empty() {
                            state.handovers.queue(
                                ucid,
                                rustvani::vokoo::Handover::Speak {
                                    text: on_no_answer.clone(),
                                },
                            );
                        }
                    }
                    log::info!("[IVR] ucid={ucid} handing over: {}", handover.to_xml().trim());
                    xml(handover.to_xml()).into_response()
                }
                None => xml(
                    "    <playtext lang=\"en-IN\">Thank you for calling. Goodbye.</playtext>\n    <hangup/>"
                        .to_string(),
                )
                .into_response(),
            }
        }

        // The dialled party is gone and the caller is still here.
        //
        // Answering with a bare 200 drops them in silence, which is the worst
        // outcome of the three: they were told they were being put through, and
        // then nothing. If the transfer was never answered they are told so;
        // if it was, the conversation is genuinely over and the call ends.
        "Dial" => {
            let ucid = params.get("sid").map(String::as_str).unwrap_or_default();
            let answered = params.get("status").map(String::as_str) == Some("answered");
            let fallback = state.handovers.take(ucid);

            match fallback {
                Some(handover) if !answered => {
                    log::info!(
                        "[IVR] ucid={ucid} transfer went unanswered ({}) — telling the caller",
                        params.get("status").map(String::as_str).unwrap_or("unknown")
                    );
                    xml(handover.to_xml()).into_response()
                }
                _ => {
                    log::info!("[IVR] ucid={ucid} transfer ended (answered={answered})");
                    xml("    <hangup/>".to_string()).into_response()
                }
            }
        }
        "Hangup" | "Disconnect" => {
            if let Some(ucid) = params.get("sid") {
                state.keypresses.forget(ucid);
            }

            // The call is over, and this is the only moment the carrier hands
            // over the recording — `call_recording_url` arrives here and
            // nowhere else, which is why `calls.recording_url` has been empty:
            // nothing was reading the event that carries it.
            //
            // `Hangup` only. `Disconnect` is us ending the call and is followed
            // by a `Hangup` of its own, so running on both would run the flow
            // twice — and "twice" in a post-call flow is two leads in a CRM.
            if event == "Hangup" {
                let did = params.get("called_number").cloned().unwrap_or_default();
                let ucid = params.get("sid").cloned().unwrap_or_default();
                if !did.is_empty() && !ucid.is_empty() {
                    // The two outcomes `trigger.call_ended` declares. The
                    // carrier says which, and it is the one thing a post-call
                    // flow cannot work out for itself afterwards.
                    let ended_by = match params.get("disconnect_reason").map(String::as_str) {
                        Some("user_disconnected") => "caller_hung_up",
                        _ => "we_ended",
                    };
                    let recording = params
                        .get("call_recording_url")
                        .filter(|url| url.starts_with("http"))
                        .cloned();

                    // Stored on the call whether or not a post-call flow exists.
                    // It expires at the carrier, so the moment it is offered is
                    // the only moment it can be kept.
                    if let Some(url) = recording.clone() {
                        let (base, key, ucid) =
                            (state.cfg.supabase_url.clone(), state.cfg.service_key.clone(), ucid.clone());
                        tokio::spawn(async move {
                            rustvani::vokoo::CallRecord::store_recording(&base, &key, &ucid, &url).await;
                        });
                    }

                    rustvani::vokoo::postcall::run_detached(
                        state.cfg.supabase_url.clone(),
                        state.cfg.service_key.clone(),
                        did,
                        ucid,
                        ended_by.to_string(),
                        recording,
                    );
                }
            }

            StatusCode::OK.into_response()
        }
        // A bare 200 is not neutral: the carrier ends a call it has no XML for,
        // which is how the first menu test lost its caller ten seconds in.
        // Hangup-shaped events are genuinely over and take the 200; anything
        // else is named in the log rather than silently dropped.
        other => {
            if !other.is_empty() && !matches!(other, "Hangup" | "Disconnect" | "NewCall") {
                log::warn!(
                    "[IVR] unhandled event {other} — answering 200. If the caller was still on \
                     the line, the carrier has just hung up on them. params={}",
                    serde_json::to_string(&params).unwrap_or_default()
                );
            }
            StatusCode::OK.into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// A call, whichever way it arrived
// ---------------------------------------------------------------------------

/// What is known about a call before a pipeline is built for it.
///
/// KooKoo says this in a `start` event on the WebSocket; Asterisk says it in an
/// HTTP announcement before the AudioSocket connects. Everything downstream —
/// flow resolution, the call record, billing, the summary — needs the same four
/// facts and does not care which carrier supplied them.
struct Arrival {
    /// The call's identity: KooKoo's ucid, or the uuid the dialplan generated.
    /// Used as the primary key of the call everywhere.
    id: String,
    /// The number that was called, which is what resolves a flow.
    did: String,
    caller: String,
    /// How it arrived. Goes in the log line and the summary, because a silent
    /// call is diagnosed very differently on the two paths.
    channel: &'static str,
    /// Whatever else the carrier said. Free-form because the two carriers say
    /// entirely different things and neither set is worth a struct.
    headers: serde_json::Value,
}

/// A socket a call has arrived on, before its handshake has been read.
enum Incoming {
    Kookoo(WebSocket),
    Asterisk(tokio::net::TcpStream),
}

/// The transport and the socket it will run on, kept together.
///
/// The pipeline needs `input()` and `output()` while the call is being built
/// and `run` once at the end, and those three are the *only* things that differ
/// between a KooKoo call and a WhatsApp one. Making them an enum keeps the
/// KooKoo path exactly as it was — same type, same calls — rather than making
/// a thousand lines of working call handling generic over a wire.
enum CallWire {
    Kookoo { transport: WebSocketTransport, socket: WebSocket },
    Asterisk {
        transport: AudioSocketTransport,
        stream: tokio::net::TcpStream,
        handshake: AudioSocketHandshake,
    },
}

impl CallWire {
    /// A handle that ends the call, where the wire has one.
    ///
    /// Only AudioSocket does. A KooKoo call is hung up through the carrier by
    /// `kookoo.hangup`; closing its WebSocket early would cut across the
    /// handover mechanism, which relies on the carrier asking for the next
    /// instruction after the stream ends. On AudioSocket there is no carrier
    /// API, and closing the socket *is* the hangup.
    fn hangup(&self) -> Option<std::sync::Arc<tokio::sync::Notify>> {
        match self {
            Self::Kookoo { .. } => None,
            Self::Asterisk { transport, .. } => Some(transport.hangup()),
        }
    }

    fn input(&self) -> FrameProcessor {
        match self {
            Self::Kookoo { transport, .. } => transport.input(),
            Self::Asterisk { transport, .. } => transport.input(),
        }
    }

    fn output(&self) -> FrameProcessor {
        match self {
            Self::Kookoo { transport, .. } => transport.output(),
            Self::Asterisk { transport, .. } => transport.output(),
        }
    }

    async fn run(self, push_tx: tokio::sync::mpsc::Sender<(Frame, FrameDirection)>) {
        match self {
            Self::Kookoo { transport, socket } => transport.run_socket(socket, push_tx).await,
            Self::Asterisk { transport, stream, handshake } => {
                transport.run_socket(stream, handshake, push_tx).await
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Asterisk
// ---------------------------------------------------------------------------

/// The dialplan announcing a call it is about to stream.
///
/// Answers with the uuid on acceptance and an empty body on refusal, because
/// the dialplan's only test is whether the body is empty — `GotoIf($["${TOLD}"
/// = ""]?nobridge)`. A refused call is hung up with cause 38 rather than
/// connected to a socket that would never be claimed.
async fn asterisk_incoming(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Form(form): axum::extract::Form<AsteriskIncoming>,
) -> impl IntoResponse {
    let presented = headers
        .get("x-vokoo-internal")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    // Same gate as pre-flight, and for a stronger reason: this one decides
    // which flow a caller reaches. The bridge's HTTP port is public — /kookoo
    // has to be — so "it is on loopback" is not a check.
    if state.cfg.internal_token.is_empty() || presented != state.cfg.internal_token {
        log::warn!("[asterisk] refused an announcement with a bad token");
        return (StatusCode::FORBIDDEN, String::new());
    }

    if form.uuid.is_empty() {
        log::warn!("[asterisk] announcement with no uuid, refused");
        return (StatusCode::BAD_REQUEST, String::new());
    }

    let call = rustvani::vokoo::PendingCall {
        uuid: form.uuid.clone(),
        did: form.to.clone(),
        caller: form.from.clone(),
        channel: if form.channel.is_empty() { "asterisk".into() } else { form.channel.clone() },
        wacid: form.wacid.filter(|w| !w.is_empty()),
    };

    log::info!(
        "[asterisk] {} call to {} from {} — uuid {}",
        call.channel, call.did, call.caller, call.uuid,
    );
    state.pending.announce(call);

    (StatusCode::OK, form.uuid)
}

#[derive(serde::Deserialize)]
struct AsteriskIncoming {
    uuid: String,
    /// The number that was called. `to` rather than `did` because that is what
    /// the dialplan calls it, and a name that has to be translated on the way
    /// through is a name that will be translated wrongly one day.
    #[serde(default)]
    to: String,
    #[serde(default)]
    from: String,
    #[serde(default)]
    channel: String,
    #[serde(default)]
    wacid: Option<String>,
}

/// Accept AudioSocket connections for the life of the process.
///
/// Asterisk is the TCP client here, so this is a listener rather than a dialler,
/// and every connection is a call that has already been answered — the caller is
/// on the line while this runs.
async fn audiosocket_listener(bind: String, state: AppState) {
    let listener = match tokio::net::TcpListener::bind(&bind).await {
        Ok(l) => l,
        Err(e) => {
            // Not fatal: KooKoo calls keep working. Loud, because every
            // WhatsApp call will now reach a dialplan line that connects to
            // nothing.
            log::error!("[audiosocket] cannot bind {bind}: {e} — WhatsApp calls will not connect");
            return;
        }
    };
    log::info!("[audiosocket] listening on {bind}");

    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                // Nagle would hold a 20 ms frame waiting for company. On a call
                // that is added latency for no benefit.
                let _ = stream.set_nodelay(true);
                log::debug!("[audiosocket] connection from {peer}");
                let state = state.clone();
                tokio::spawn(async move {
                    handle_call(Incoming::Asterisk(stream), state).await;
                });
            }
            Err(e) => {
                log::warn!("[audiosocket] accept failed: {e}");
            }
        }
    }
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_call(Incoming::Kookoo(socket), state))
}

async fn await_kookoo_start(socket: &mut WebSocket) -> Option<(KooKooStart, String)> {
    let deadline = tokio::time::Instant::now() + HANDSHAKE_TIMEOUT;
    loop {
        let msg = tokio::time::timeout_at(deadline, socket.recv()).await.ok()??;
        match msg {
            Ok(Message::Text(text)) => {
                if let Some(start) = KooKooStart::parse(&text) {
                    return Some((start, text.to_string()));
                }
                log::debug!("pre-start message ignored: {text}");
            }
            Ok(Message::Close(_)) => return None,
            Ok(_) => {}
            Err(e) => {
                log::warn!("socket error during handshake: {e}");
                return None;
            }
        }
    }
}

/// The socket and its serializer, held from the handshake until the transport
/// is built — which is several hundred lines later, after the flow has decided
/// what kind of pipeline this call needs.
enum Wire {
    Kookoo { socket: WebSocket, serializer: KooKooFrameSerializer },
    Asterisk { stream: tokio::net::TcpStream, handshake: AudioSocketHandshake },
}

async fn handle_call(incoming: Incoming, state: AppState) {
    let call = CALL_SEQ.fetch_add(1, Ordering::Relaxed);
    let cfg = state.cfg.clone();

    // Each carrier's handshake, and nothing else that differs between them.
    // Everything below this block is one call path.
    let (arrival, mut wire, capture) = match incoming {
        Incoming::Kookoo(mut socket) => {
            let Some((start, start_raw)) = await_kookoo_start(&mut socket).await else {
                log::warn!("[call={call}] no start event — dropping connection");
                return;
            };

            let mut serializer =
                KooKooFrameSerializer::from_start(&start, KooKooInputParams::default());

            let capture_dir = env_or("CAPTURE_DIR", "/opt/vokoo/captures");
            let capture = match std::fs::create_dir_all(&capture_dir)
                .and_then(|_| CallCapture::create(format!("{capture_dir}/{}.jsonl", start.ucid)))
            {
                Ok(c) => {
                    let c = Arc::new(c);
                    c.note_raw(&start_raw);
                    serializer.set_capture(c.clone());
                    Some(c)
                }
                Err(e) => {
                    log::warn!("[call={call}] capture disabled: {e}");
                    None
                }
            };

            let arrival = Arrival {
                id: start.ucid.clone(),
                did: start.did.clone().unwrap_or_default(),
                caller: start.caller.clone().unwrap_or_default(),
                channel: "kookoo",
                headers: start.headers.clone(),
            };
            (arrival, Wire::Kookoo { socket, serializer }, capture)
        }

        Incoming::Asterisk(mut stream) => {
            let Some(handshake) = await_uuid(&mut stream, UUID_WAIT).await else {
                log::warn!("[call={call}] AudioSocket sent no uuid — dropping connection");
                return;
            };

            // The uuid is the call's only credential, and one announcement
            // serves one socket. An unannounced uuid is not a call this bridge
            // knows about, so it gets nothing — building a pipeline for it
            // would mean answering a call nobody told us about.
            let Some(pending) = state.pending.claim(&handshake.uuid) else {
                log::warn!(
                    "[call={call}] AudioSocket uuid {} was never announced — dropping",
                    handshake.uuid,
                );
                return;
            };

            let arrival = Arrival {
                id: pending.uuid.clone(),
                did: pending.did.clone(),
                caller: pending.caller.clone(),
                channel: "whatsapp",
                headers: json!({
                    "channel": pending.channel,
                    "wacid":   pending.wacid,
                }),
            };
            // No capture: `CallCapture` logs a JSON wire, and this one is PCM.
            // A recording of a WhatsApp call is Asterisk's `MixMonitor` to
            // start, not this.
            (arrival, Wire::Asterisk { stream, handshake }, None)
        }
    };

    log::info!(
        "[call={call}] {} id={} did={} caller={} {}",
        arrival.channel,
        arrival.id,
        if arrival.did.is_empty() { "-" } else { &arrival.did },
        if arrival.caller.is_empty() { "-" } else { &arrival.caller },
        arrival.headers,
    );

    let t0 = std::time::Instant::now();
    rustvani::vokoo::telemetry::count("sarvathra_calls_total", &[("channel", arrival.channel)]);
    rustvani::vokoo::telemetry::gauge_add(
        "sarvathra_calls_active",
        &[("channel", arrival.channel)],
        1,
    );

    // A number points at a flow. Resolved once, here, and not read again: a flow
    // republished mid-call must not change a call in progress, so the caller
    // finishes on the graph they started with.
    let did = arrival.did.clone();
    let caller = arrival.caller.clone();
    let flow =
        rustvani::vokoo::graph::resolve_for_did(&cfg.supabase_url, &cfg.service_key, &did).await;

    // The call goes on the books before anything can go wrong with it.
    // Shared: the listener writes transcript lines from its own task for as
    // long as the call lasts.
    let record = Arc::new(rustvani::vokoo::CallRecord::open(
        &cfg.supabase_url,
        &cfg.service_key,
        &arrival.id,
        &did,
        &caller,
        flow.as_ref().map(|f| f.id.as_str()),
    )
    .await);

    let control = flow.as_ref().map(|f| {
        rustvani::vokoo::CallControl::new(
            rustvani::vokoo::CallHandle {
                ucid: arrival.id.clone(),
                did: did.clone(),
                caller: caller.clone(),
                org_id: f.org_id.clone(),
            },
            cfg.supabase_url.clone(),
            cfg.service_key.clone(),
            state.handovers.clone(),
        )
    });

    // Everything before the conversation — opening hours, a recording pause —
    // runs now. If the flow ends without ever reaching an agent, the call is
    // over and no audio pipeline is ever built.
    let mut runner = match (flow.as_ref(), control.as_ref()) {
        (Some(f), Some(c)) => {
            log::info!("[call={call}] flow: {}", f.name);
            Some(
                rustvani::vokoo::FlowRunner::new(f, c)
                    .already_answered(state.keypresses.all(&arrival.id)),
            )
        }
        _ => None,
    };

    let mut agent_node_id: Option<String> = None;
    let mut billed_agent_id: Option<String> = None;
    let mut trail_written = 0usize;
    // Replaced by the flow's agent, when there is one.
    let mut instructions = cfg.system_prompt.clone();
    // Likewise the model: `LIVE_MODEL` is the fallback, not the source.
    let mut live_model = cfg.live_model.clone();
    let mut live_voice = cfg.live_voice.clone();
    // Model parameters. `None` leaves them out of the request entirely, so the
    // provider's own defaults apply rather than a number this file invented.
    // Kept past the block that resolves it: the engine decides which pipeline
    // gets built, and that happens after the flow has finished walking.
    let mut agent_engine: Option<rustvani::vokoo::Engine> = None;
    let mut live_temperature: Option<f32> = None;
    let mut live_max_tokens: Option<u32> = None;
    // The agent's own tools, declared to the provider beside the flow's
    // outcome function.
    let mut agent_functions: Vec<serde_json::Value> = Vec::new();
    // How the agent opens the call. `None` means it does not speak first.
    let mut greeting: Option<String> = Some(env_or(
        "GREETING_PROMPT",
        "The caller has just connected. Greet them in one short sentence \
         and ask how you can help.",
    ));
    if let Some(r) = runner.as_mut() {
        // A menu reached here has already been answered on the webhook that
        // returned this stream, so the walk normally passes straight through
        // it. Reaching one that has *not* been answered means it sits after an
        // agent node, where the carrier can no longer be asked — `<collectdtmf>`
        // is answered between streams and this stream is open. Rather than
        // stranding the caller in a question nothing can ask, take the branch
        // the node already declares for nobody pressing anything.
        //
        // Bounded: recording the outcome fills `answered`, so the same node
        // cannot suspend the walk twice.
        let action = loop {
            match r.advance().await {
                rustvani::vokoo::NodeAction::CollectDigits { node, .. } => {
                    log::warn!(
                        "[call={call}] flow reached menu {} with the stream already open — \
                         keys are collected between streams, so this cannot be asked. \
                         Taking the no-keypress branch.",
                        node.name
                    );
                    let node_id = node.id.clone();
                    r.digits_collected(&node_id, "timeout");
                }
                other => break other,
            }
        };
        match action {
            // The loop above turns every menu into its no-keypress branch, so
            // this cannot happen. Logged rather than `unreachable!` because a
            // panic on the call path is not a silent bot — the carrier ends the
            // call the moment this socket closes.
            rustvani::vokoo::NodeAction::CollectDigits { node, .. } => {
                log::error!("[call={call}] menu {} survived the loop above", node.name);
            }
            rustvani::vokoo::NodeAction::RunAgent { node, agent_id, timeout_seconds } => {
                log::info!(
                    "[call={call}] flow reached agent node {} (timeout {}s)",
                    node.name, timeout_seconds
                );
                agent_node_id = Some(node.id.clone());
                // Kept for billing: which agent ran is a dimension a cost
                // report needs, and by the time the pipeline is built the
                // flow walk has moved on.
                billed_agent_id = Some(agent_id.clone());

                // The flow names an agent; that agent's prompt and skills live
                // in the database. Falling back to the environment's prompt
                // keeps a call working when the lookup fails, but it is a
                // degraded call: without the skill list the model has no
                // boundary to refuse against and improvises one.
                if !agent_id.is_empty() {
                    match rustvani::vokoo::agent_prompt(
                        &cfg.supabase_url,
                        &cfg.service_key,
                        &agent_id,
                    )
                    .await
                    {
                        Some(prompt) => {
                            log::info!(
                                "[call={call}] agent {agent_id} — composed prompt, {} chars",
                                prompt.len()
                            );
                            instructions = prompt;
                        }
                        None => log::warn!(
                            "[call={call}] could not compose a prompt for agent {agent_id} — \
                             falling back to SYSTEM_PROMPT, which carries no skills"
                        ),
                    }

                    // And the functions those skills grant. The prompt names
                    // them; without a declaration the model can only talk about
                    // them, which is how a call came to report "Internal error
                    // checking slots" for a tool it had never been able to call.
                    agent_functions = rustvani::vokoo::agent_tools(
                        &cfg.supabase_url,
                        &cfg.service_key,
                        &agent_id,
                    )
                    .await;
                    log::info!(
                        "[call={call}] agent {agent_id} — {} tool(s) declared: {}",
                        agent_functions.len(),
                        agent_functions
                            .iter()
                            .filter_map(|t| t.get("name").and_then(|n| n.as_str()))
                            .collect::<Vec<_>>()
                            .join(", ")
                    );

                    // How it opens the call. The console has had a First
                    // Message field per agent since the beginning and nothing
                    // read it; every call opened with one line from bridge.env.
                    if let Some(chosen) = rustvani::vokoo::agent_greeting(
                        &cfg.supabase_url,
                        &cfg.service_key,
                        &agent_id,
                    )
                    .await
                    {
                        greeting = chosen;
                    }

                    // And the engine it runs on: how it hears and speaks.
                    //
                    // This replaces a lookup that read `agents.model` and
                    // resolved it through `catalogue_models`. The model id then
                    // lived in three places that could disagree — the agent row,
                    // `LIVE_MODEL`, and a fallback in this file — and on
                    // 31 August all three said one thing while the catalogue had
                    // no such row at all. An engine holds the model, the voice
                    // and the shape together, so there is one place to look.
                    match rustvani::vokoo::engine_for_agent(
                        &cfg.supabase_url,
                        &cfg.service_key,
                        &agent_id,
                    )
                    .await
                    {
                        Some(engine) => {
                            log::info!(
                                "[call={call}] agent {agent_id} — engine '{}' ({})",
                                engine.name,
                                engine.mode
                            );
                            if engine.mode != "realtime" {
                                // A relay is built further down, from the same
                                // row. Nothing to resolve here: its model and
                                // its voice belong to its own steps, not to a
                                // single realtime stage.
                            } else {
                                // The catalogue still turns a friendly id into
                                // the provider's, so a provider rename stays an
                                // UPDATE rather than an edit on the server.
                                if let Some(id) = engine.get("realtime", "model") {
                                    match rustvani::vokoo::graph::model_id(
                                        &cfg.supabase_url,
                                        &cfg.service_key,
                                        id,
                                    )
                                    .await
                                    {
                                        Some(resolved) => live_model = resolved,
                                        None => log::warn!(
                                            "[call={call}] engine names model {id}, which is not in                                              the catalogue — using LIVE_MODEL {}",
                                            cfg.live_model
                                        ),
                                    }
                                }
                                if let Some(voice) = engine.get("realtime", "voice") {
                                    live_voice = voice.to_string();
                                }
                                live_temperature =
                                    engine.get_f64("realtime", "temperature").map(|v| v as f32);
                                live_max_tokens =
                                    engine.get_f64("realtime", "max_tokens").map(|v| v as u32);
                            }
                            agent_engine = Some(engine);
                        }
                        None => log::warn!(
                            "[call={call}] agent {agent_id} has no published engine —                              using the environment ({})",
                            cfg.live_model
                        ),
                    }
                }
                write_trail(&record, r, &mut trail_written, rustvani::vokoo::graph::TRIGGER_ANSWERED);
            }
            // Listening before anyone has spoken. The tap the listener drinks
            // from belongs to the conversational pipeline, and there is no
            // pipeline yet — a flow that opens straight into a monitor would
            // need one built in listen-only mode, which is a feature, not a
            // fallback. Say so rather than answering with silence.
            rustvani::vokoo::NodeAction::Monitor { node, .. } => {
                log::warn!(
                    "[call={call}] flow starts at {} — listening before a conversation is not supported yet",
                    node.name
                );
                write_trail(&record, r, &mut trail_written, rustvani::vokoo::graph::TRIGGER_ANSWERED);
                record
                    .close(Some("monitor_first"), None, None, serde_json::json!({}))
                    .await;
                return;
            }
            rustvani::vokoo::NodeAction::Finished(reason) => {
                log::info!("[call={call}] flow ended before any conversation: {reason}");
                write_trail(&record, r, &mut trail_written, rustvani::vokoo::graph::TRIGGER_ANSWERED);
                record.close(Some(&reason), None, None, serde_json::json!({})).await;
                return;
            }
        }
    }

    // The engine decides the shape, per call. `PIPELINE_MODE` remains the
    // answer only for a call that never reached an agent node — one that fell
    // back to the number's agent, where there is no engine to ask.
    let realtime_mode = match agent_engine.as_ref() {
        Some(engine) => engine.mode == "realtime" && !cfg.llm_key.is_empty(),
        None => cfg.pipeline_mode == "realtime" && !cfg.llm_key.is_empty(),
    };
    // Which realtime provider, likewise.
    let realtime_provider = agent_engine
        .as_ref()
        .and_then(|engine| engine.get("realtime", "provider"))
        .unwrap_or(&cfg.realtime_provider)
        .to_string();
    let agent_mode = cfg.pipeline_mode == "agent" && cfg.agent_ready();
    if cfg.pipeline_mode == "agent" && !agent_mode {
        log::error!("[call={call}] PIPELINE_MODE=agent but keys are missing — using echo");
    }

    // No local VAD in realtime mode: Gemini does server-side turn detection
    // and sends Interrupted itself. Running Silero as well means two things
    // cancelling the same reply, which is one too many.
    let relay_engine = agent_engine
        .as_ref()
        .filter(|engine| engine.mode == "cascading")
        .cloned();

    // A relay does its own turn-taking, so it needs local VAD. A realtime model
    // does server-side turn detection and sends Interrupted itself; running
    // Silero as well means two things cancelling the same reply.
    let vad = if agent_mode || relay_engine.is_some() {
        match SileroVadNative::new(PIPELINE_SAMPLE_RATE) {
            Ok(v) => Some(Arc::new(v) as Arc<dyn rustvani::vad::VadAnalyzer>),
            Err(e) => {
                log::error!("[call={call}] VAD init failed: {e}");
                None
            }
        }
    } else {
        None
    };

    // One set of audio parameters for both wires. Both carriers deliver 8 kHz
    // narrowband and both serializers resample to the pipeline's rate, so the
    // VAD sees the same signal either way — the only field that differs is the
    // outbound chunk size, which is paired with each serializer's frame size by
    // a compile-time assertion above.
    let audio_params = |chunks: u32| TransportParams {
        audio_in_enabled: true,
        audio_in_sample_rate: Some(PIPELINE_SAMPLE_RATE),
        audio_in_channels: 1,
        audio_in_passthrough: true,
        audio_in_stream_on_start: true,
        audio_out_enabled: true,
        audio_out_sample_rate: Some(PIPELINE_SAMPLE_RATE),
        audio_out_10ms_chunks: chunks,
        vad_analyzer: vad.clone(),
        vad_params: VadParams {
            // 8 kHz telephony is narrowband and quiet; gate on VAD confidence
            // rather than raw volume.
            confidence: 0.45,
            min_volume: 0.0,
            ..VadParams::default()
        },
        ..TransportParams::default()
    };

    let transport = match wire {
        Wire::Kookoo { socket, serializer } => {
            let transport = WebSocketTransport::new(
                &format!("KooKooTransport-{call}"),
                WebSocketParams { transport: audio_params(AUDIO_OUT_10MS_CHUNKS) },
            );
            transport.set_serializer(Box::new(serializer));
            CallWire::Kookoo { transport, socket }
        }
        Wire::Asterisk { stream, handshake } => {
            // Opus makes the channel wideband, so the wire is 16 kHz — the
            // pipeline's own rate, which means a WhatsApp call resamples
            // nowhere. Overridable for a narrowband channel, which is the only
            // reason it is not simply a constant.
            let wire_rate: u32 = env_or(
                "AUDIOSOCKET_WIRE_RATE",
                &rustvani::serializers::AUDIOSOCKET_SAMPLE_RATE.to_string(),
            )
            .parse()
            .unwrap_or(rustvani::serializers::AUDIOSOCKET_SAMPLE_RATE);
            let transport = AudioSocketTransport::new(
                &format!("AudioSocketTransport-{call}"),
                AudioSocketParams {
                    transport: audio_params(AUDIOSOCKET_OUT_10MS_CHUNKS),
                    wire_rate,
                },
            );
            transport.set_serializer(Box::new(AudioSocketFrameSerializer::at(wire_rate)));
            CallWire::Asterisk { transport, stream, handshake }
        }
    };

    // Faults raised while the call is up. Small: a call has one fault worth
    // acting on, and the loop breaks on the first.
    let (fault_tx, mut fault_rx) = tokio::sync::mpsc::channel::<rustvani::vokoo::Cause>(4);
    let primer = FrameProcessor::new(
        "Primer",
        Box::new(Primer::new(call).reporting_to(fault_tx.clone())),
        false,
    );

    // Where the agent node reports how it finished. Bounded at one: the first
    // outcome ends the node, and anything after it is about a call that is
    // already moving on.
    let (outcome_tx, mut outcome_rx) =
        tokio::sync::mpsc::channel::<(String, serde_json::Value)>(1);

    // What this call consumes, and where it is written down.
    //
    // rustvani has counted all along — the collector, the drain task and the
    // per-provider instrumentation are upstream and compiled in. Nothing had
    // ever handed a collector to a handler, so every one of them received
    // `None` and the whole subsystem sat dark. This is the missing argument.
    //
    // Keyed on the call's own row id, so `billing_sessions.session_id` joins
    // straight to `calls.id` and a cost has a call to belong to. Without a call
    // record there is nothing to attribute usage to, and counting it would
    // produce a bill nobody could explain — so it counts nothing instead.
    let (billing, billing_drain): (
        std::sync::Arc<dyn rustvani::billing::BillingCollector>,
        Option<tokio::task::JoinHandle<()>>,
    ) = match record.id().and_then(|id| uuid::Uuid::parse_str(id).ok()) {
        Some(session_id) => {
            let mut metadata = std::collections::HashMap::new();
            metadata.insert("org_id".to_string(), flow.as_ref().map(|f| f.org_id.clone()).unwrap_or_default());
            metadata.insert("did".to_string(), did.clone());
            metadata.insert("ucid".to_string(), arrival.id.clone());
            if let Some(id) = billed_agent_id.as_ref() {
                metadata.insert("agent_id".to_string(), id.clone());
            }
            // The dimension the whole exercise is for: what an engine costs to
            // run. A call with no engine falls back to the environment and has
            // none to attribute, which the view reports as an unattributed row
            // rather than folding into somebody else's total.
            if let Some(engine) = agent_engine.as_ref() {
                metadata.insert("engine_id".to_string(), engine.id.clone());
                metadata.insert("engine_name".to_string(), engine.name.clone());
                metadata.insert("engine_mode".to_string(), engine.mode.clone());
            }

            let storage = std::sync::Arc::new(rustvani::vokoo::PostgrestBillingStorage::new(
                cfg.supabase_url.clone(),
                cfg.service_key.clone(),
                metadata.clone(),
            ));
            let (collector, drain) = rustvani::billing::SessionBilling::new(session_id, storage, 256);
            collector.record(rustvani::billing::BillingEvent::SessionStart {
                session_id,
                started_at: chrono::Utc::now(),
                metadata,
            });
            log::info!("[call={call}] billing session {session_id}");
            (collector, Some(drain))
        }
        None => {
            log::warn!("[call={call}] no call record — usage will not be attributed");
            (std::sync::Arc::new(rustvani::billing::NoopBillingCollector), None)
        }
    };

    let mut realtime_controls: Option<RealtimeControls> = None;
    let (task, context) = if let Some(engine) = relay_engine.as_ref() {
        // A relay, built from the engine row rather than from PIPELINE_MODE.
        // Every step resolves its own key from the vault for this organisation,
        // so two businesses on the same bridge can run on different accounts.
        log::info!(
            "[call={call}] relay — engine '{}' stt={} llm={} tts={}",
            engine.name,
            engine.get("stt", "provider").unwrap_or("—"),
            engine.get("llm", "provider").unwrap_or("—"),
            engine.get("tts", "provider").unwrap_or("—"),
        );

        // The org is the flow's. A call that fell back to the number's agent
        // never built one, and has no organisation to resolve keys against.
        let Some(control) = control.as_ref() else {
            log::error!("[call={call}] a relay needs a flow to know whose keys to use");
            return;
        };
        let service = control.service();

        let declared: Vec<_> = rustvani::vokoo::engine::declare(&agent_functions)
            .into_iter()
            .chain(std::iter::once(rustvani::vokoo::engine::outcome_schema(&[
                "done".to_string(),
                "wants_human".to_string(),
                "out_of_scope".to_string(),
                "failed".to_string(),
            ])))
            .collect();
        let tool_names: Vec<String> = agent_functions
            .iter()
            .filter_map(|t| t.get("name")?.as_str().map(str::to_owned))
            .collect();

        let context = rustvani::context::shared_context_with_tools(
            Some(instructions.clone()),
            rustvani::adapters::schemas::ToolsSchema::new(declared),
            None,
        );

        let route = rustvani::vokoo::engine::ToolRoute {
            supabase_url: service.supabase_url.to_string(),
            service_key: service.service_key.to_string(),
            org_id: service.org_id.to_string(),
            ucid: service.ucid.to_string(),
        };
        let registry = rustvani::vokoo::engine::registry(route, outcome_tx.clone(), tool_names);

        let stage_ctx = rustvani::vokoo::StageContext {
            supabase_url: &cfg.supabase_url,
            service_key: &cfg.service_key,
            org_id: service.org_id,
            sample_rate: PIPELINE_SAMPLE_RATE,
            billing: billing.clone(),
        };

        // The same channel and the same writer task the realtime path uses, so
        // a relay's transcript lands in `calls.transcript` like any other. It
        // did not before: a 127-second call recorded zero lines while every
        // turn of it sat in the log.
        let (transcript_tx, mut transcript_rx) =
            tokio::sync::mpsc::channel::<(String, String)>(64);
        {
            let record = record.clone();
            tokio::spawn(async move {
                while let Some((speaker, text)) = transcript_rx.recv().await {
                    record.transcript_line(&speaker, &text);
                }
            });
        }

        let relay = match rustvani::vokoo::build_relay(
            engine,
            &stage_ctx,
            context.clone(),
            registry,
            Some(transcript_tx),
        )
        .await
        {
            Ok(relay) => relay,
            Err(problem) => {
                // Named rather than swallowed: every one of these is something
                // somebody can fix — a step left empty, a key not connected.
                log::error!("[call={call}] engine '{}' cannot run: {problem}", engine.name);
                // And the caller is sent to a person rather than left on a line
                // that will never speak. Returning here is what a caller heard
                // as silence when a relay was published on a retired model.
                rustvani::vokoo::escalate(
                    &cfg.supabase_url,
                    &cfg.service_key,
                    &state.handovers,
                    &arrival.id,
                    &did,
                    &caller,
                    rustvani::vokoo::Cause::EngineFailed,
                )
                .await;
                return;
            }
        };

        if !relay.calls_tools && !agent_functions.is_empty() {
            log::warn!(
                "[call={call}] engine '{}' thinks with a model that cannot call tools — \
                 the agent's {} tool(s) stay unreachable",
                engine.name,
                agent_functions.len()
            );
        }

        let mut processors = vec![transport.input(), primer];
        processors.extend(relay.processors);
        processors.push(transport.output());

        let task = PipelineTask::new(
            processors,
            PipelineParams { allow_interruptions: true, ..PipelineParams::default() },
        );
        (task, Some(relay.context))
    } else if realtime_mode {
        log::info!("[call={call}] realtime mode — provider={realtime_provider} model={live_model} voice={live_voice}");
        // One builder, the same one pre-flight uses. What used to be here was
        // a branch per provider — each repeating the vault lookup, the
        // environment fallback and its own connect — beside a *different*
        // builder in `realtime_probe` that knew only Gemini. Two
        // implementations of one thing, which is how a pre-flight passes an
        // engine a call cannot run.
        let session: Box<dyn RealtimeSession> = match relay_engine
            .as_ref()
            .or(agent_engine.as_ref())
        {
            Some(engine) => {
                let stage_ctx = rustvani::vokoo::StageContext {
                    supabase_url: &cfg.supabase_url,
                    service_key: &cfg.service_key,
                    org_id: control.as_ref().map(|c| c.service().org_id).unwrap_or(""),
                    sample_rate: PIPELINE_SAMPLE_RATE,
                    billing: billing.clone(),
                };
                let fallback = if realtime_provider == "openai" {
                    cfg.realtime_key.clone()
                } else {
                    cfg.llm_key.clone()
                };
                match rustvani::vokoo::build_realtime(
                    engine,
                    &stage_ctx,
                    rustvani::vokoo::RealtimeRequest {
                        instructions: &instructions,
                        functions: agent_functions.clone(),
                        // Only a call that reached a flow has an outcome to
                        // report, and only then is `finish_call` declared.
                        declare_outcome: flow.is_some(),
                        // Let the caller choose. Safe here and nowhere else:
                        // one realtime session hears and speaks, so a language
                        // change is an instruction rather than a reconnect.
                        // A WhatsApp call has no other way to be asked — the
                        // media socket is open from the dialplan's first line,
                        // so `<collectdtmf>` never gets a chance.
                        offer_language: true,
                        language_codes: cfg.transcript_languages.clone(),
                        fallback_key: Some(fallback),
                        probe: false,
                    },
                )
                .await
                {
                    Ok(session) => session,
                    Err(problem) => {
                        log::error!("[call={call}] realtime engine cannot run: {problem}");
                        rustvani::vokoo::escalate(
                            &cfg.supabase_url,
                            &cfg.service_key,
                            &state.handovers,
                            &arrival.id,
                            &did,
                            &caller,
                            rustvani::vokoo::Cause::EngineFailed,
                        )
                        .await;
                        return;
                    }
                }
            }
            // No engine row at all: a call that never reached a flow, running
            // on the environment. Nothing to build from, so nothing is built.
            None => {
                log::error!("[call={call}] realtime mode with no engine to build from");
                return;
            }
        };
        // Every conversation until now went unrecorded: `transcript_line` was
        // only ever called on the listen-only path, so `calls.transcript` has
        // been empty on every call this system has taken. The realtime layer
        // sends lines here and this task writes them, which keeps a database
        // handle out of the audio loop.
        let (transcript_tx, mut transcript_rx) = tokio::sync::mpsc::channel::<(String, String)>(64);
        {
            let record = record.clone();
            tokio::spawn(async move {
                while let Some((speaker, text)) = transcript_rx.recv().await {
                    record.transcript_line(&speaker, &text);
                }
            });
        }

        let mut rt = RealtimeProcessor::new(session, PIPELINE_SAMPLE_RATE)
            .with_outcomes(outcome_tx.clone())
            .with_transcript(transcript_tx);

        // Tools are reachable only when a flow ran: the organisation and the
        // carrier's ucid come from the call control the flow built, and a call
        // that fell back to the number's agent has neither. Without this the
        // model is told a tool call cannot be answered, which is the truth for
        // that call rather than a failure.
        if let Some(c) = control.as_ref() {
            let ctx = c.service();
            rt = rt.with_tools(rustvani::services::realtime::ToolDispatch {
                supabase_url: ctx.supabase_url.to_string(),
                service_key: ctx.service_key.to_string(),
                org_id: ctx.org_id.to_string(),
                ucid: ctx.ucid.to_string(),
                // The flow's own reporting function, which is answered by the
                // flow and must not be looked up as a tool.
                outcome_function: "finish_call".into(),
                // The same set outcome_function declares. Kept beside it so a
                // narrated outcome is read against what the flow actually
                // accepts, rather than a guess.
                outcome_values: ["done", "wants_human", "out_of_scope", "failed"]
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
            });
        }

        let rt = match greeting.clone() {
            Some(prompt) => rt.with_greeting(prompt),
            // "User speaks first": connect and wait. The priming silence still
            // goes out, so KooKoo starts streaming caller audio either way.
            None => rt,
        };
        // Taken before the pipeline consumes the processor: the flow decides
        // when the agent stops talking, and the flow does not own the pipeline.
        realtime_controls = Some(rt.controls());
        let realtime = rt.into_processor();
        let task = PipelineTask::new(
            vec![transport.input(), primer, realtime, transport.output()],
            PipelineParams { allow_interruptions: true, ..PipelineParams::default() },
        );
        (task, None)
    } else if agent_mode {
        log::info!(
            "[call={call}] agent mode — stt=deepgram/{} llm={} tts={}",
            cfg.stt_language, cfg.llm_model, cfg.tts_voice
        );
        let context = shared_context(Some(cfg.system_prompt.clone()));

        let stt = DeepgramSttHandler::new(DeepgramSttConfig {
            api_key: cfg.deepgram_key.clone(),
            model: "nova-3".to_string(),
            language: cfg.stt_language.clone(),
            encoding: "linear16".to_string(),
            sample_rate: PIPELINE_SAMPLE_RATE,
            ..DeepgramSttConfig::default()
        })
        .into_processor();

        let llm = OpenAILLMHandler::new(OpenAILLMConfig {
            api_key: cfg.llm_key.clone(),
            model: cfg.llm_model.clone(),
            base_url: cfg.llm_base_url.clone(),
            reasoning_effort: (!cfg.reasoning_effort.is_empty())
                .then(|| cfg.reasoning_effort.clone()),
            max_completion_tokens: Some(cfg.max_reply_tokens),
            ..OpenAILLMConfig::default()
        })
        .into_processor();

        let tts = match DeepgramTtsHandler::new(DeepgramTtsConfig {
            api_key: cfg.deepgram_key.clone(),
            voice: cfg.tts_voice.clone(),
            sample_rate: PIPELINE_SAMPLE_RATE,
            ..DeepgramTtsConfig::default()
        }) {
            Ok(t) => t.into_processor(),
            Err(e) => {
                log::error!("[call={call}] TTS init failed: {e}");
                return;
            }
        };

        let task = PipelineTask::new(
            vec![
                transport.input(),
                primer,
                stt,
                LLMUserAggregator::new(context.clone()),
                llm,
                LLMAssistantAggregator::new(context.clone()),
                tts,
                transport.output(),
            ],
            PipelineParams { allow_interruptions: true, ..PipelineParams::default() },
        );
        (task, Some(context))
    } else {
        log::info!("[call={call}] echo mode");
        let echo = FrameProcessor::new("Echo", Box::new(EchoHandler), false);
        let task = PipelineTask::new(
            vec![transport.input(), primer, echo, transport.output()],
            PipelineParams { allow_interruptions: false, ..PipelineParams::default() },
        );
        (task, None)
    };

    let push_tx = task.push_sender();

    // Greet on connect. With no user turn in the context yet, the model
    // produces its opening line.
    //
    // The agent's First Message decides what that line is, on a relay as much as
    // on a realtime model. Seeded as a user turn because there is no other way
    // to instruct a chat model at the top of a conversation — the system prompt
    // is the agent's character, not one instruction about one turn.
    if let (Some(context), Some(prompt)) = (context.as_ref(), greeting.as_ref()) {
        if let Ok(mut held) = context.lock() {
            held.add_user_message(prompt);
        }
    }
    if let Some(context) = context {
        let push_tx = push_tx.clone();
        task.add_on_pipeline_started(move |_frame| {
            let push_tx = push_tx.clone();
            let context = context.clone();
            Box::pin(async move {
                let _ = push_tx
                    .send((Frame::llm_context(context), FrameDirection::Downstream))
                    .await;
            })
        });
    }

    // Taken before `run` consumes the wire: this is what ends a WhatsApp call
    // the moment the flow is done, rather than whenever this function happens
    // to return.
    let hangup = transport.hangup();
    // Whether the wire closed on its own — the caller hung up, or Asterisk
    // ended the channel. A completed future must never be polled again.
    let mut socket_done = false;
    let socket_fut = transport.run(push_tx);
    let observer: Option<Arc<dyn BaseObserver>> = (agent_mode || realtime_mode || relay_engine.is_some())
        .then(|| Arc::new(LatencyObserver::new(call)) as Arc<dyn BaseObserver>);
    let task_fut = task.run(system_clock(), observer);

    // The conversation ends when the caller hangs up, the pipeline stops, or
    // the agent says it is finished. Only the last of those leaves the flow
    // with somewhere to go.
    let mut agent_outcome: Option<String> = None;

    // The call outlives the agent's turn.
    //
    // This used to be a plain select, so the arm that received the agent's
    // outcome completed it — dropping the socket and pipeline futures and
    // ending the call. That was invisible while every flow ended in a hangup.
    // It stops being invisible the moment a flow wants the agent to hand over
    // and stay on the line: the transfer would connect, and then the carrier
    // would lose the leg holding the call up.
    //
    // Pinned and looped instead. The outcome arm advances the flow and goes
    // back to waiting; only the caller hanging up or the pipeline stopping
    // leaves the loop.
    tokio::pin!(socket_fut, task_fut);
    let mut listening = false;

    // How long the agent node may sit with nobody speaking before the flow
    // takes a default.
    //
    // The node's own timeout is ten minutes, which is the right bound for a
    // caller who is thinking or on hold. It is the wrong bound for a call the
    // agent has already abandoned: when the model announces a hand-over and
    // never reports one, nothing else will ever arrive, and the caller sits in
    // silence until they give up. Two of the last four calls ended that way.
    //
    // `gone_quiet` rather than `failed`, because that is what actually
    // happened from the flow's point of view, and a flow that routes it can
    // still hand the caller to a person.
    let idle_limit = std::time::Duration::from_secs(
        env_or("AGENT_IDLE_SECONDS", "20").parse().unwrap_or(20),
    );

    // Set by whichever arm below decided the call could not be served.
    let mut fault: Option<rustvani::vokoo::Cause> = None;

    loop {
        tokio::select! {
            r = &mut socket_fut => {
                log::info!("[call={call}] socket closed: {r:?}");
                socket_done = true;
                break;
            }
            r = &mut task_fut   => {
                // A pipeline that ends with an error before the agent has
                // reported anything is a caller listening to nothing, not a
                // call that finished. What kind of error is not knowable from
                // here — `PipecatError` covers a provider hanging up and a
                // processor giving way alike — so it is reported as the
                // provider being lost rather than guessing at a panic.
                let broke = r.is_err() && agent_outcome.is_none();
                log::info!("[call={call}] pipeline ended: {r:?}");
                if broke {
                    log::error!("[call={call}] the pipeline failed mid-call — escalating");
                    fault = Some(rustvani::vokoo::Cause::ProviderLost);
                }
                break
            }

            // Something on the call path has given up. Break so the socket
            // closes: the carrier then asks what to do next on `event=Stream`,
            // which is the only moment a failed call can still be redirected.
            Some(cause) = fault_rx.recv() => {
                fault = Some(cause);
                break
            }

            // Nothing has reached this loop for a while. The pipeline is still
            // carrying audio either way, so this measures the flow being stuck,
            // not the call being quiet.
            _ = tokio::time::sleep(idle_limit),
                if runner.is_some() && agent_outcome.is_none() && !listening => {
                let idle = realtime_controls
                    .as_ref()
                    .map(|c| !c.is_speaking() && c.idle_for() >= idle_limit)
                    .unwrap_or(false);
                if !idle {
                    // Either mid-sentence, or the caller is still talking. The
                    // timer measures this loop's silence; the conversation has
                    // its own.
                    continue;
                }
                log::warn!(
                    "[call={call}] no outcome after {}s and the agent is not speaking — \
                     taking gone_quiet",
                    idle_limit.as_secs()
                );
                if let Err(e) = outcome_tx
                    .send((
                        "finish_call".to_string(),
                        serde_json::json!({
                            "outcome": "gone_quiet",
                            "note": "no outcome reported; the flow was waiting",
                        }),
                    ))
                    .await
                {
                    log::warn!("[call={call}] could not report the idle outcome: {e}");
                    break;
                }
            }
            Some((name, args)) = outcome_rx.recv(), if runner.is_some() && agent_outcome.is_none() => {
                if name != "finish_call" {
                    continue;
                }
                let outcome = args.get("outcome").and_then(|v| v.as_str()).unwrap_or("done");
                log::info!(
                    "[call={call}] agent finished as {outcome}: {}",
                    args.get("note").and_then(|v| v.as_str()).unwrap_or("")
                );
                agent_outcome = Some(outcome.to_string());

                // Let the agent finish its sentence before the flow acts on the
                // outcome. The model reports the moment it has decided, which is
                // while it is still speaking — a hand-over that fires here cuts
                // the line mid-word and the caller hears "I'm passing you to a—"
                // followed by ringing.
                if let Some(c) = realtime_controls.as_ref() {
                    c.wait_until_spoken(std::time::Duration::from_secs(4)).await;
                }

                // Walk the rest of the graph here rather than after the call,
                // because a node may want the call kept open.
                let (Some(r), Some(node_id)) = (runner.as_mut(), agent_node_id.as_ref()) else {
                    break;
                };
                r.agent_finished(node_id, outcome);
                let keep_open = loop {
                    match r.advance().await {
                        // The agent has already spoken to this caller, so the
                        // stream is open and `<collectdtmf>` cannot reach them.
                        // A menu wired after an agent is a flow we cannot serve
                        // as written; say so and take the branch it declares
                        // for nobody pressing anything.
                        rustvani::vokoo::NodeAction::CollectDigits { node, .. } => {
                            log::warn!(
                                "[call={call}] {} asks for a key after the agent — keys are \
                                 collected between streams. Taking the no-keypress branch.",
                                node.name
                            );
                            let menu_id = node.id.clone();
                            r.digits_collected(&menu_id, "timeout");
                        }
                        rustvani::vokoo::NodeAction::Finished(reason) => {
                            log::info!("[call={call}] flow ended: {reason}");
                            break false;
                        }
                        rustvani::vokoo::NodeAction::Monitor { node, timeout_seconds } => {
                            log::info!("[call={call}] {} — agent stops talking", node.name);
                            let started = match realtime_controls.as_ref() {
                                Some(c) => {
                                    start_listening(
                                        call,
                                        c,
                                        cfg.llm_key.clone(),
                                        record.clone(),
                                        timeout_seconds,
                                    )
                                    .await
                                }
                                None => false,
                            };
                            // Either way the call stays up: a caller who has
                            // just been put through to a person must not be cut
                            // off because our recorder failed to start.
                            r.monitor_started(&node.id.clone(), started);
                            break true;
                        }
                        rustvani::vokoo::NodeAction::RunAgent { node, .. } => {
                            // A second agent in one flow needs a second
                            // pipeline, and this call's sockets are spent.
                            log::warn!(
                                "[call={call}] flow reaches a second agent ({}) — not supported yet",
                                node.name
                            );
                            break false;
                        }
                    }
                };
                log::info!("[call={call}] FLOW_TRAIL {}", serde_json::json!(r.trail));
                write_trail(&record, r, &mut trail_written, rustvani::vokoo::graph::TRIGGER_ANSWERED);
                if keep_open {
                    listening = true;
                    continue;
                }
                break;
            }
        }
    }
    if listening {
        log::info!("[call={call}] listening ended with the call");
    }

    // End the call now, not when this function returns.
    //
    // Everything below — escalation, billing settle, the call record — takes
    // time a caller spends listening to silence. On KooKoo that never showed,
    // because `kookoo.hangup` drops the caller through the carrier before any
    // of it runs. On AudioSocket there is no carrier to ask: closing the socket
    // is the hangup, and it used to happen only when this scope ended, ten
    // seconds or more after the agent had said goodbye.
    //
    // The future is then polled to completion so the transport can write its
    // terminate frame and close cleanly. Bounded, because a socket that will
    // not close must not hold this task open — the caller is gone either way.
    //
    // Only when the wire is still open. Awaiting a future that has already
    // completed panics with "`async fn` resumed after completion", reported
    // against the `async fn run` line rather than anywhere useful — which is
    // what happened to every caller-initiated hangup between adding this and
    // the metric that caught it.
    if let (Some(signal), false) = (hangup, socket_done) {
        signal.notify_one();
        match tokio::time::timeout(std::time::Duration::from_secs(2), socket_fut).await {
            Ok(_) => log::info!("[call={call}] call ended, socket closed"),
            Err(_) => log::warn!("[call={call}] socket did not close in 2s"),
        }
    }

    // The call could not be served. Queue where it goes before this function
    // returns and the socket closes — the carrier asks for the next
    // instruction on `event=Stream`, and by then this task is gone.
    //
    // Nothing is queued if the caller has already hung up; the handover simply
    // expires. Better a wasted lookup than a caller left in silence because we
    // waited to be sure they were still there.
    // Taken before `fault` is moved into the escalation. `Cause` is four
    // variants, so its Debug form is a bounded label.
    let fault_seen: Option<String> = fault.as_ref().map(|c| format!("{c:?}").to_lowercase());

    if let Some(cause) = fault {
        rustvani::vokoo::escalate(
            &cfg.supabase_url,
            &cfg.service_key,
            &state.handovers,
            &arrival.id,
            &did,
            &caller,
            cause,
        )
        .await;
    }

    // Close the billing session and let the drain finish.
    //
    // `SessionEnd` is what moves the session from `active` to a settled total,
    // and the drain task writes the final checkpoint after it. Returning
    // without waiting drops the tail of the call — which is the part with the
    // agent's longest replies in it.
    //
    // Bounded: a database that has stopped answering must not hold a worker
    // open after the caller has gone. The last checkpoint is already durable,
    // so the cost of giving up here is bounded by one checkpoint interval,
    // which is the guarantee the storage was designed around.
    if let Some(drain) = billing_drain {
        billing.record(rustvani::billing::BillingEvent::SessionEnd {
            session_id: billing.session_id(),
            ended_at: chrono::Utc::now(),
            finish_reason: if fault.is_some() { "cancel".to_string() } else { "end".to_string() },
        });
        drop(billing);
        match tokio::time::timeout(std::time::Duration::from_secs(10), drain).await {
            Ok(_) => log::info!("[call={call}] billing settled"),
            Err(_) => log::warn!(
                "[call={call}] billing did not settle in 10s — the last checkpoint stands"
            ),
        }
    }

    // The flow's own account of how the call ended, which may disagree with the
    // carrier's — and when it does, that disagreement is the interesting part.
    record
        .close(
            agent_outcome.as_deref(),
            Some("socket_closed"),
            None,
            serde_json::json!({}),
        )
        .await;

    // The call is over: close the gauge and record how it went. `outcome` is a
    // bounded set — the flow's four outcomes plus "none" for a call that never
    // reached an agent — so it is safe as a label.
    rustvani::vokoo::telemetry::gauge_add(
        "sarvathra_calls_active",
        &[("channel", arrival.channel)],
        -1,
    );
    rustvani::vokoo::telemetry::observe_call_duration(t0.elapsed().as_secs_f64());
    rustvani::vokoo::telemetry::count(
        "sarvathra_calls_ended_total",
        &[
            ("channel", arrival.channel),
            ("outcome", agent_outcome.as_deref().unwrap_or("none")),
            ("mode", if relay_engine.is_some() {
                "relay"
            } else if realtime_mode {
                "realtime"
            } else if agent_mode {
                "agent"
            } else {
                "echo"
            }),
        ],
    );
    if let Some(cause) = fault_seen.as_deref() {
        rustvani::vokoo::telemetry::count(
            "sarvathra_calls_failed_total",
            &[("channel", arrival.channel), ("cause", cause)],
        );
    }

    let (media_in, other_in) = capture.as_ref().map(|c| c.counts()).unwrap_or((0, 0));
    log::info!(
        "[call={call}] CALL_SUMMARY {}",
        serde_json::json!({
            "ucid": arrival.id,
            "did": arrival.did,
            "caller": arrival.caller,
            // Which wire this call came in on. First thing to read when a call
            // was silent, because the two paths fail in different places.
            "channel": arrival.channel,
            "headers": arrival.headers,
            "mode": if relay_engine.is_some() {
                "relay"
            } else if realtime_mode {
                "realtime"
            } else if agent_mode {
                "agent"
            } else {
                "echo"
            },
            "duration_ms": t0.elapsed().as_millis() as u64,
            "media_packets_in": media_in,
            "control_messages_in": other_in,
        })
    );
}

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    // Before anything can panic. A task panic kills one call and nothing else
    // — deliberately, since calls are independent — but that also makes it
    // nearly silent, so it is counted rather than left to be found by reading
    // the log for something else.
    rustvani::vokoo::telemetry::install_panic_hook();

    let cfg = Arc::new(AgentConfig::from_env());
    let state = AppState {
        ws_url: std::env::var("WS_URL")
            .unwrap_or_else(|_| format!("wss://{}/ws", env_or("PUBLIC_HOST", "vokoo.vayuveda.ai"))),
        sip_number: env_or("SIP_NUMBER", "524431"),
        is_sip: env_or("STREAM_IS_SIP", "true"),
        ivr_mode: env_or("IVR_MODE", "stream"),
        cfg: cfg.clone(),
        handovers: rustvani::vokoo::Handovers::new(),
        keypresses: rustvani::vokoo::Keypresses::new(),
        pending: rustvani::vokoo::PendingCalls::new(),
    };
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080);

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        // Prometheus. Unauthenticated on purpose: it carries counts and
        // latencies, never a number, a name or a transcript — the labels are
        // bounded sets like `channel` and `outcome`. Anything that would
        // identify a caller belongs in the call record, which is behind RLS.
        .route(
            "/metrics",
            get(|| async {
                (
                    [(axum::http::header::CONTENT_TYPE, "text/plain; version=0.0.4")],
                    rustvani::vokoo::telemetry::render(),
                )
            }),
        )
        .route("/engine/preflight", post(engine_preflight))
        .route("/flow/dryrun", post(flow_dry_run))
        .route("/catalogue/refresh", post(catalogue_refresh))
        .route("/kookoo", any(kookoo_webhook))
        .route("/asterisk/incoming", post(asterisk_incoming))
        .route("/ws", get(ws_handler))
        .with_state(state.clone());

    log::info!(
        "vokoo-bridge on 0.0.0.0:{port} — ws_url={} sip={} is_sip={} ivr={} pipeline={} keys_ok={}",
        state.ws_url, state.sip_number, state.is_sip, state.ivr_mode,
        cfg.pipeline_mode, cfg.agent_ready()
    );

    // Keep the engine catalogue honest without anybody pressing a button. The
    // hand-typed list is what put a retired Sarvam model in front of a caller.
    let refresh_hours: u64 = env_or("CATALOGUE_REFRESH_HOURS", "12").parse().unwrap_or(12);
    if refresh_hours > 0 {
        rustvani::vokoo::discovery::schedule(
            cfg.supabase_url.clone(),
            cfg.service_key.clone(),
            std::time::Duration::from_secs(refresh_hours * 3600),
        );
        log::info!("[discovery] refreshing the catalogue every {refresh_hours}h");
    }

    // WhatsApp calls arrive here, from Asterisk on the same box. Loopback by
    // default and deliberately: AudioSocket is unencrypted PCM, so this hop
    // must never cross a network — which is the reason Asterisk runs on this
    // machine rather than beside the rest of the telephony.
    let audiosocket_bind = env_or("AUDIOSOCKET_BIND", "127.0.0.1:9092");
    tokio::spawn(audiosocket_listener(audiosocket_bind, state.clone()));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn new_call_xml_carries_every_param_in_x_uui() {
        let p = params(&[
            ("event", "NewCall"), ("sid", "212758065"), ("cid", "919704665032"),
            ("operator", "Airtel"), ("circle", "ANDHRA PRADESH"),
        ]);
        let xml = new_call_xml(&p, "wss://vokoo.vayuveda.ai/ws", "524431", "true");
        assert!(xml.contains(r#"url="wss://vokoo.vayuveda.ai/ws""#));
        assert!(xml.contains(">524431</stream>"));

        let start = xml.find("x-uui='").unwrap() + 7;
        let end = xml[start..].find('\'').unwrap() + start;
        let parsed: serde_json::Value = serde_json::from_str(&xml[start..end]).unwrap();
        assert_eq!(parsed["operator"], "Airtel");
        assert_eq!(parsed["circle"], "ANDHRA PRADESH");
    }

    #[test]
    fn single_quotes_in_params_are_escaped() {
        let p = params(&[("event", "NewCall"), ("sid", "1"), ("cid", "2"), ("name", "O'Brien")]);
        let xml = new_call_xml(&p, "wss://h/ws", "5", "true");
        assert!(!xml.contains("O'Brien"));
        assert!(xml.contains("O&apos;Brien"));
    }

    #[test]
    fn priming_burst_is_300ms_of_silence() {
        let b = priming_silence(16_000);
        assert_eq!(b.len(), 16_000 / 1000 * 300 * 2);
        assert!(b.iter().all(|&x| x == 0));
    }
}
