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
    Router,
    extract::{
        Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{StatusCode, header},
    response::IntoResponse,
    routing::{any, get},
};

use rustvani::error::Result;
use rustvani::observer::{BaseObserver, FramePushed, FrameProcessed};
use rustvani::frames::{
    Frame, FrameDirection, FrameHandler, FrameInner, FrameProcessor, SystemFrame,
};
use rustvani::processors::{
    llm_assistant_aggregator::LLMAssistantAggregator, llm_user_aggregator::LLMUserAggregator,
};
use rustvani::serializers::{CallCapture, KooKooFrameSerializer, KooKooInputParams, KooKooStart};
use rustvani::services::{
    GeminiLiveConfig, GeminiLiveSession, OpenAIRealtimeConfig, OpenAIRealtimeSession,
    RealtimeControls, RealtimeEvent, RealtimeProcessor, RealtimeSession,
    DeepgramSttConfig, DeepgramSttHandler, DeepgramTtsConfig, DeepgramTtsHandler, OpenAILLMConfig,
    OpenAILLMHandler,
};
use rustvani::transport::TransportParams;
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
}

struct AgentConfig {
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
    live_voice: String,
    stt_language: String,
    tts_voice: String,
    system_prompt: String,
}

/// How an agent node reports the way it finished.
///
/// Declared to the model as a function, so the outcome is the model's judgement
/// rather than a keyword match on a transcript. `gone_quiet` and `timeout` are
/// deliberately absent: those are observed by the bridge, and a model asked to
/// judge its own silence would be guessing.
fn outcome_function() -> gemini_live::FunctionDeclaration {
    gemini_live::FunctionDeclaration {
        name: "finish_call".into(),
        // What happens after an outcome is the flow's decision, not the
        // agent's, so the wording here stays neutral about it. Saying "goodbye"
        // on out_of_scope was the agent assuming the call was over while the
        // flow was about to put the caller through to a person.
        description: "Call this the moment the caller's need is settled, or the moment you cannot settle it. \
Do not announce that you are calling it, and do not say goodbye or imply the call is ending — \
what happens next is decided after you report, and it is often that somebody else takes over. \
Say only that you are sorting it out for them.".into(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "outcome": {
                    "type": "string",
                    "enum": ["done", "wants_human", "out_of_scope", "failed"],
                    "description": "done: the caller got what they rang for. wants_human: they asked for a person. out_of_scope: what they want is not something you do — say so plainly, but do not turn them away, because somebody else may still help them. failed: you tried and could not."
                },
                "note": {"type": "string", "description": "One short line for the call log."}
            },
            "required": ["outcome"]
        }),
        scheduling: None,
        behavior: None,
    }
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
struct Primer;

#[async_trait]
impl FrameHandler for Primer {
    async fn on_process_frame(
        &self,
        processor: &FrameProcessor,
        frame: Frame,
        direction: FrameDirection,
    ) -> Result<()> {
        if matches!(&frame.inner, FrameInner::System(SystemFrame::Start(_))) {
            log::info!("[primer] opening the inbound direction");
            let silence =
                Frame::output_audio(priming_silence(PIPELINE_SAMPLE_RATE), PIPELINE_SAMPLE_RATE, 1);
            processor.push_frame(silence, direction).await?;
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

    match event {
        "NewCall" if state.ivr_mode == "playtext" => xml(
            "    <playtext lang=\"en-IN\">Hello. This is VoKoo. The webhook is working. Goodbye.</playtext>\n    <hangup/>".to_string(),
        )
        .into_response(),
        "NewCall" => {
            xml(new_call_xml(&params, &state.ws_url, &state.sip_number, &state.is_sip))
                .into_response()
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
        _ => StatusCode::OK.into_response(),
    }
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_call(socket, state))
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

async fn handle_call(mut socket: WebSocket, state: AppState) {
    let call = CALL_SEQ.fetch_add(1, Ordering::Relaxed);
    let cfg = state.cfg.clone();

    let Some((start, start_raw)) = await_kookoo_start(&mut socket).await else {
        log::warn!("[call={call}] no start event — dropping connection");
        return;
    };

    log::info!(
        "[call={call}] start ucid={} did={} caller={} operator={} circle={}",
        start.ucid,
        start.did.as_deref().unwrap_or("-"),
        start.caller.as_deref().unwrap_or("-"),
        start.headers.get("operator").and_then(|v| v.as_str()).unwrap_or("-"),
        start.headers.get("circle").and_then(|v| v.as_str()).unwrap_or("-"),
    );

    let t0 = std::time::Instant::now();
    let mut serializer = KooKooFrameSerializer::from_start(&start, KooKooInputParams::default());

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

    // A number points at a flow. Resolved once, here, and not read again: a flow
    // republished mid-call must not change a call in progress, so the caller
    // finishes on the graph they started with.
    let did = start.did.clone().unwrap_or_default();
    let caller = start.caller.clone().unwrap_or_default();
    let flow =
        rustvani::vokoo::graph::resolve_for_did(&cfg.supabase_url, &cfg.service_key, &did).await;

    // The call goes on the books before anything can go wrong with it.
    // Shared: the listener writes transcript lines from its own task for as
    // long as the call lasts.
    let record = Arc::new(rustvani::vokoo::CallRecord::open(
        &cfg.supabase_url,
        &cfg.service_key,
        &start.ucid,
        &did,
        &caller,
        flow.as_ref().map(|f| f.id.as_str()),
    )
    .await);

    let control = flow.as_ref().map(|f| {
        rustvani::vokoo::CallControl::new(
            rustvani::vokoo::CallHandle {
                ucid: start.ucid.clone(),
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
            Some(rustvani::vokoo::FlowRunner::new(f, c))
        }
        _ => None,
    };

    let mut agent_node_id: Option<String> = None;
    let mut trail_written = 0usize;
    // Replaced by the flow's agent, when there is one.
    let mut instructions = cfg.system_prompt.clone();
    // Likewise the model: `LIVE_MODEL` is the fallback, not the source.
    let mut live_model = cfg.live_model.clone();
    if let Some(r) = runner.as_mut() {
        match r.advance().await {
            rustvani::vokoo::NodeAction::RunAgent { node, agent_id, timeout_seconds } => {
                log::info!(
                    "[call={call}] flow reached agent node {} (timeout {}s)",
                    node.name, timeout_seconds
                );
                agent_node_id = Some(node.id.clone());

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

                    // And its model. The catalogue decides which provider model
                    // this agent runs on, so a provider rename is an `UPDATE`
                    // rather than an edit to `bridge.env` on the server. A
                    // missing or inactive row leaves `LIVE_MODEL` standing:
                    // degraded, not silent.
                    match rustvani::vokoo::graph::model_for_agent(
                        &cfg.supabase_url,
                        &cfg.service_key,
                        &agent_id,
                    )
                    .await
                    {
                        Some(model) => {
                            if model != live_model {
                                log::info!(
                                    "[call={call}] agent {agent_id} — model {model} from the \
                                     catalogue (LIVE_MODEL says {})",
                                    cfg.live_model
                                );
                            }
                            live_model = model;
                        }
                        None => log::warn!(
                            "[call={call}] no catalogue model for agent {agent_id} — \
                             falling back to LIVE_MODEL {}",
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

    let realtime_mode = cfg.pipeline_mode == "realtime" && !cfg.llm_key.is_empty();
    let agent_mode = cfg.pipeline_mode == "agent" && cfg.agent_ready();
    if cfg.pipeline_mode == "agent" && !agent_mode {
        log::error!("[call={call}] PIPELINE_MODE=agent but keys are missing — using echo");
    }

    // No local VAD in realtime mode: Gemini does server-side turn detection
    // and sends Interrupted itself. Running Silero as well means two things
    // cancelling the same reply, which is one too many.
    let vad = if agent_mode {
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

    let transport = WebSocketTransport::new(
        &format!("KooKooTransport-{call}"),
        WebSocketParams {
            transport: TransportParams {
                audio_in_enabled: true,
                audio_in_sample_rate: Some(PIPELINE_SAMPLE_RATE),
                audio_in_channels: 1,
                audio_in_passthrough: true,
                audio_in_stream_on_start: true,
                audio_out_enabled: true,
                audio_out_sample_rate: Some(PIPELINE_SAMPLE_RATE),
                audio_out_10ms_chunks: AUDIO_OUT_10MS_CHUNKS,
                vad_analyzer: vad,
                vad_params: VadParams {
                    // 8 kHz telephony is narrowband and quiet; gate on VAD
                    // confidence rather than raw volume.
                    confidence: 0.45,
                    min_volume: 0.0,
                    ..VadParams::default()
                },
                ..TransportParams::default()
            },
        },
    );
    transport.set_serializer(Box::new(serializer));

    let primer = FrameProcessor::new("Primer", Box::new(Primer), false);

    // Where the agent node reports how it finished. Bounded at one: the first
    // outcome ends the node, and anything after it is about a call that is
    // already moving on.
    let (outcome_tx, mut outcome_rx) =
        tokio::sync::mpsc::channel::<(String, serde_json::Value)>(1);

    let mut realtime_controls: Option<RealtimeControls> = None;
    let (task, context) = if realtime_mode {
        log::info!("[call={call}] realtime mode — provider={} model={} voice={}", cfg.realtime_provider, live_model, cfg.live_voice);
        let session: Box<dyn RealtimeSession> = if cfg.realtime_provider == "openai" {
            match OpenAIRealtimeSession::connect(OpenAIRealtimeConfig {
                api_key: cfg.realtime_key.clone(),
                base_url: cfg.realtime_base_url.clone(),
                model: live_model.clone(),
                voice: cfg.live_voice.clone(),
                instructions: instructions.clone(),
                ..OpenAIRealtimeConfig::default()
            })
            .await
            {
                Ok(s) => Box::new(s),
                Err(e) => {
                    log::error!("[call={call}] realtime connect failed: {e}");
                    return;
                }
            }
        } else {
            match GeminiLiveSession::connect(GeminiLiveConfig {
                api_key: cfg.llm_key.clone(),
                model: live_model.clone(),
                voice: Some(cfg.live_voice.clone()),
                instructions: instructions.clone(),
                functions: if flow.is_some() { vec![outcome_function()] } else { Vec::new() },
                transcribe_only: false,
            })
            .await
            {
                Ok(s) => Box::new(s),
                Err(e) => {
                    log::error!("[call={call}] gemini live connect failed: {e}");
                    return;
                }
            }
        };
        let mut rt = RealtimeProcessor::new(session, PIPELINE_SAMPLE_RATE)
            .with_outcomes(outcome_tx.clone());

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
            });
        }

        let rt = rt
            .with_greeting(env_or(
                "GREETING_PROMPT",
                "The caller has just connected. Greet them in one short sentence                  and ask how you can help.",
            ));
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

    let socket_fut = transport.run_socket(socket, push_tx);
    let observer: Option<Arc<dyn BaseObserver>> = (agent_mode || realtime_mode)
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
    loop {
        tokio::select! {
            r = &mut socket_fut => { log::info!("[call={call}] socket closed: {r:?}"); break }
            r = &mut task_fut   => { log::info!("[call={call}] pipeline ended: {r:?}"); break }
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

                // Walk the rest of the graph here rather than after the call,
                // because a node may want the call kept open.
                let (Some(r), Some(node_id)) = (runner.as_mut(), agent_node_id.as_ref()) else {
                    break;
                };
                r.agent_finished(node_id, outcome);
                let keep_open = loop {
                    match r.advance().await {
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

    let (media_in, other_in) = capture.as_ref().map(|c| c.counts()).unwrap_or((0, 0));
    log::info!(
        "[call={call}] CALL_SUMMARY {}",
        serde_json::json!({
            "ucid": start.ucid,
            "did": start.did,
            "caller": start.caller,
            "operator": start.headers.get("operator"),
            "circle": start.headers.get("circle"),
            "mode": if realtime_mode { "realtime" } else if agent_mode { "agent" } else { "echo" },
            "duration_ms": t0.elapsed().as_millis() as u64,
            "media_packets_in": media_in,
            "control_messages_in": other_in,
        })
    );
}

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let cfg = Arc::new(AgentConfig::from_env());
    let state = AppState {
        ws_url: std::env::var("WS_URL")
            .unwrap_or_else(|_| format!("wss://{}/ws", env_or("PUBLIC_HOST", "vokoo.vayuveda.ai"))),
        sip_number: env_or("SIP_NUMBER", "524431"),
        is_sip: env_or("STREAM_IS_SIP", "true"),
        ivr_mode: env_or("IVR_MODE", "stream"),
        cfg: cfg.clone(),
        handovers: rustvani::vokoo::Handovers::new(),
    };
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080);

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/kookoo", any(kookoo_webhook))
        .route("/ws", get(ws_handler))
        .with_state(state.clone());

    log::info!(
        "vokoo-bridge on 0.0.0.0:{port} — ws_url={} sip={} is_sip={} ivr={} pipeline={} keys_ok={}",
        state.ws_url, state.sip_number, state.is_sip, state.ivr_mode,
        cfg.pipeline_mode, cfg.agent_ready()
    );

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
