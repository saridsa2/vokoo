//! Turning an engine row into the processors a call runs through.
//!
//! An engine says *what* the chain is; this says how to build it. The split
//! matters: adding a provider rustvani already has is a row in
//! `catalogue_engine_stages` plus an arm in the match below, and never a change
//! to the call path itself.
//!
//! Every stage resolves its own key from the vault, per call, per organisation.
//! Nothing here reads the environment — an engine that names a provider whose
//! key is not connected returns an error saying which vendor to connect, rather
//! than falling back to somebody else's key or to a global default.

use std::sync::Arc;

use serde_json::Value;

use crate::frames::processor::FrameProcessor;
use crate::processors::{
    llm_assistant_aggregator::LLMAssistantAggregator, llm_user_aggregator::LLMUserAggregator,
};
use crate::adapters::schemas::FunctionSchema;
use crate::LLMContext;
use crate::services::{
    DeepgramSttConfig, DeepgramSttHandler, DeepgramTtsConfig, DeepgramTtsHandler, GnaniSttConfig,
    GnaniSttHandler, OpenAILLMConfig, OpenAILLMHandler, PiperTtsConfig, PiperTtsHandler,
    SarvamLLMConfig, SarvamLLMHandler, SarvamSttConfig, SarvamSttHandler, SarvamTtsConfig,
    ElevenLabsTtsConfig, ElevenLabsTtsHandler, SarvamTtsHandler, SixtyDbSttConfig,
    SixtyDbSttHandler,
};

use super::graph::{vendor_secret, Engine};

/// Everything a stage needs that does not come from the engine itself.
pub struct StageContext<'a> {
    pub supabase_url: &'a str,
    pub service_key: &'a str,
    pub org_id: &'a str,
    /// The rate the transport runs at. A handler configured for a different
    /// rate produces audio at the wrong speed rather than failing.
    pub sample_rate: u32,
    /// Where each step reports what it consumed.
    ///
    /// Not an `Option`. A stage that quietly received nothing would price at
    /// zero, and a cheap-looking engine is a worse answer than an obviously
    /// unmeasured one — so callers that are not billing pass
    /// `NoopBillingCollector` and say so once, here, instead of at nine call
    /// sites that each have to remember.
    pub billing: std::sync::Arc<dyn crate::billing::BillingCollector>,
}

impl StageContext<'_> {
    /// The vendor's key for this organisation.
    ///
    /// The error names the vendor rather than the provider, because connecting
    /// a key is done per vendor and that is the word the console uses.
    async fn key_for(&self, vendor: &str) -> Result<String, String> {
        vendor_secret(self.supabase_url, self.service_key, self.org_id, vendor)
            .await
            .ok_or_else(|| format!("no {vendor} key is connected for this organisation"))
    }
}

/// What one stage of an engine says.
fn stage<'a>(engine: &'a Engine, name: &str) -> Result<&'a Value, String> {
    engine
        .config
        .get(name)
        .filter(|value| !value.is_null())
        .ok_or_else(|| format!("the engine has no {name} step"))
}

fn field<'a>(stage: &'a Value, name: &str) -> Option<&'a str> {
    stage.get(name)?.as_str().map(str::trim).filter(|s| !s.is_empty())
}

fn number(stage: &Value, name: &str) -> Option<f64> {
    let value = stage.get(name)?;
    value.as_f64().or_else(|| value.as_str()?.trim().parse().ok())
}

/// The language a stage should work in.
///
/// One place, because a relay that transcribes Hindi and speaks English is a
/// bug that only shows up on a call. An engine may set it per stage; the top
/// level is the engine's own answer for all of them.
fn language(engine: &Engine, stage: &Value) -> String {
    field(stage, "language")
        .or_else(|| engine.config.get("language").and_then(Value::as_str))
        .unwrap_or("en-IN")
        .to_string()
}

/* ----------------------------------------------------------------- Listening */

pub async fn listening(engine: &Engine, ctx: &StageContext<'_>) -> Result<FrameProcessor, String> {
    let stage = stage(engine, "stt")?;
    let provider = field(stage, "provider").ok_or("the listening step names no provider")?;
    let lang = language(engine, stage);

    Ok(match provider {
        "deepgram" => DeepgramSttHandler::new(DeepgramSttConfig {
            api_key: ctx.key_for("deepgram").await?,
            // Deepgram's language codes are not BCP-47 regions: "multi" is how
            // you ask it to stop guessing, which is what an Indian line wants.
            model: field(stage, "model").unwrap_or("nova-3").to_string(),
            language: field(stage, "language").unwrap_or("multi").to_string(),
            encoding: "linear16".to_string(),
            sample_rate: ctx.sample_rate,
            ..DeepgramSttConfig::default()
        })
        .with_billing(ctx.billing.clone())
        .into_processor(),

        "sarvam" => SarvamSttHandler::new(SarvamSttConfig {
            api_key: ctx.key_for("sarvam").await?,
            model: field(stage, "model").unwrap_or("saaras:v3").to_string(),
            language: Some(lang),
            // Code-mixed speech is the normal case on this line, and the
            // default mode flattens it into one language.
            mode: Some(field(stage, "mode").unwrap_or("codemix").to_string()),
            // Words the transcriber should expect. Proper nouns are what it
            // gets wrong — a caller saying "Satya" came back as हात्या — and a
            // clinic's doctors, treatments and its own name are known in
            // advance even though a caller's name is not.
            prompt: field(stage, "prompt").map(str::to_owned),
            ..SarvamSttConfig::default()
        })
        .with_billing(ctx.billing.clone())
        .into_processor(),

        "gnani" => GnaniSttHandler::new(GnaniSttConfig {
            api_key: ctx.key_for("gnani").await?,
            language_code: lang,
            sample_rate: ctx.sample_rate,
            format: field(stage, "mode").unwrap_or("verbatim").to_string(),
            ..GnaniSttConfig::default()
        })
        .with_billing(ctx.billing.clone())
        .into_processor(),

        "sixtydb" => SixtyDbSttHandler::new(SixtyDbSttConfig {
            api_key: ctx.key_for("sixtydb").await?,
            // It takes bare language codes, not regions.
            languages: vec![lang.split('-').next().unwrap_or("en").to_string()],
            sample_rate: ctx.sample_rate,
            ..SixtyDbSttConfig::default()
        })
        .with_billing(ctx.billing.clone())
        .into_processor(),

        other => return Err(format!("rustvani has no {other} transcriber")),
    })
}

/* ------------------------------------------------------------------ Thinking */

/// The model that decides what to say, and the registry its tools go into.
///
/// Returned before `into_processor` so the caller can register tools on it —
/// that is the whole reason this returns a handler rather than a processor.
pub async fn thinking(
    engine: &Engine,
    ctx: &StageContext<'_>,
    registry: crate::services::FunctionRegistry,
) -> Result<ThinkingStage, String> {
    let stage = stage(engine, "llm")?;
    let provider = field(stage, "provider").ok_or("the thinking step names no provider")?;
    let temperature = number(stage, "temperature").map(|v| v as f32);
    let max_tokens = number(stage, "max_tokens").map(|v| v as u32);

    Ok(match provider {
        // The registry goes in at construction: the handler exposes no way to
        // replace it afterwards, and a handler built without one is a model
        // that is told about tools it can never actually run.
        "openai" => ThinkingStage::OpenAI(Box::new(OpenAILLMHandler::with_registry(
            OpenAILLMConfig {
                api_key: ctx.key_for("openai").await?,
                model: field(stage, "model").unwrap_or("gpt-4.1-mini").to_string(),
                // An engine may point at any OpenAI-compatible endpoint, which
                // is how a model on your own hardware is reached.
                base_url: field(stage, "base_url")
                    .unwrap_or("https://api.openai.com/v1")
                    .to_string(),
                temperature,
                max_completion_tokens: max_tokens,
                ..OpenAILLMConfig::default()
            },
            registry,
        ))),

        // Withdrawn from the catalogue in migration 0045: `SarvamLLMHandler`
        // carries no `FunctionRegistry`, so every tool the agent's skills grant
        // would be inert and nothing would say so. Still constructed here, and
        // still refused by `build_relay`, so a row written before that migration
        // fails loudly rather than answering a call it cannot serve.
        "sarvam" => ThinkingStage::Sarvam(Box::new(SarvamLLMHandler::new(SarvamLLMConfig {
            api_key: ctx.key_for("sarvam").await?,
            model: field(stage, "model").unwrap_or("sarvam-30b").to_string(),
            temperature,
            // Chain-of-thought costs a turn's worth of latency on a phone call.
            reasoning_effort: field(stage, "reasoning_effort").map(str::to_owned),
            ..SarvamLLMConfig::default()
        }))),

        other => return Err(format!("rustvani has no {other} model handler")),
    })
}

/// Which model handler an engine chose.
///
/// Not a trait object: only `OpenAILLMHandler` carries a `FunctionRegistry`, so
/// the two are not interchangeable at the point where tools are registered, and
/// pretending otherwise would hide that a Sarvam relay cannot call tools.
pub enum ThinkingStage {
    OpenAI(Box<OpenAILLMHandler>),
    Sarvam(Box<SarvamLLMHandler>),
}

impl ThinkingStage {
    pub fn calls_tools(&self) -> bool {
        matches!(self, ThinkingStage::OpenAI(_))
    }

    pub fn into_processor(self) -> FrameProcessor {
        match self {
            ThinkingStage::OpenAI(handler) => handler.into_processor(),
            ThinkingStage::Sarvam(handler) => handler.into_processor(),
        }
    }
}

/* ------------------------------------------------------------------ Speaking */

pub async fn speaking(engine: &Engine, ctx: &StageContext<'_>) -> Result<FrameProcessor, String> {
    let stage = stage(engine, "tts")?;
    let provider = field(stage, "provider").ok_or("the speaking step names no provider")?;
    let lang = language(engine, stage);

    Ok(match provider {
        "deepgram" => DeepgramTtsHandler::new(DeepgramTtsConfig {
            api_key: ctx.key_for("deepgram").await?,
            voice: field(stage, "voice").unwrap_or("aura-2-helena-en").to_string(),
            sample_rate: ctx.sample_rate,
            ..DeepgramTtsConfig::default()
        })
        .map_err(|e| format!("Deepgram speech failed to start: {e}"))?
        .with_billing(ctx.billing.clone())
        .into_processor(),

        "sarvam" => SarvamTtsHandler::new(SarvamTtsConfig {
            api_key: ctx.key_for("sarvam").await?,
            model: field(stage, "model").unwrap_or("bulbul:v2").to_string(),
            voice: field(stage, "voice").unwrap_or("anushka").to_string(),
            language: lang,
            sample_rate: Some(ctx.sample_rate),
            ..SarvamTtsConfig::default()
        })
        .map_err(|e| format!("Sarvam speech failed to start: {e}"))?
        .with_billing(ctx.billing.clone())
        .into_processor(),

        "elevenlabs" => ElevenLabsTtsHandler::new(ElevenLabsTtsConfig {
            api_key: ctx.key_for("elevenlabs").await?,
            // The voice id, not its name: the id is what the URL takes, and
            // ElevenLabs names are not unique.
            voice: field(stage, "voice").unwrap_or_default().to_string(),
            model: field(stage, "model").unwrap_or("eleven_turbo_v2_5").to_string(),
            sample_rate: ctx.sample_rate,
            stability: number(stage, "stability"),
            similarity_boost: number(stage, "similarity_boost"),
            style: number(stage, "style"),
            ..ElevenLabsTtsConfig::default()
        })
        .map_err(|e| format!("ElevenLabs speech failed to start: {e}"))?
        .with_billing(ctx.billing.clone())
        .into_processor(),

        // No key: the model files are on the server. A missing file is an
        // error here rather than a silent fallback to a paid voice.
        "piper" => PiperTtsHandler::new(PiperTtsConfig {
            model_dir: std::path::PathBuf::from(
                field(stage, "model_dir").unwrap_or("/opt/vokoo/piper-models"),
            ),
            ..PiperTtsConfig::default()
        })
        .map_err(|e| format!("Piper speech failed to start: {e}"))?
        // Piper synthesises on our own hardware. There is no vendor invoice
        // to attribute, so it reports nothing rather than reporting zero.
        .into_processor(),

        other => return Err(format!("rustvani has no {other} voice")),
    })
}

/* -------------------------------------------------------------- Transcript */

/// Which half of the conversation a tap is listening to.
#[derive(Clone, Copy, PartialEq)]
pub enum Side {
    /// Caller speech, as `Transcription` frames leaving the transcriber.
    Caller,
    /// What the agent says, accumulated from the `LLMText` chunks the model
    /// streams. There is no single frame carrying the whole reply.
    Agent,
}

/// Records one side of the conversation without changing it.
///
/// The realtime path gets its transcript from the provider, which sends both
/// halves down one channel. A relay has no such channel: the words exist only as
/// frames in flight, and both aggregators consume or transform them.
///
/// Two taps rather than one, because the two sides pass different points.
/// `Transcription` travels downstream out of the transcriber and is consumed by
/// the user aggregator, so a tap must sit between them; `LLMText` travels
/// downstream out of the model, so that tap sits after the assistant
/// aggregator. A single processor cannot be in both places.
///
/// Everything is forwarded untouched — this observes, it does not participate.
pub struct TranscriptTap {
    side: Side,
    to: tokio::sync::mpsc::Sender<(String, String)>,
    /// For the agent side, the reply being streamed until the model finishes
    /// it. For the caller side, the last turn recorded, so the same one is not
    /// written twice.
    partial: std::sync::Mutex<String>,
}

impl TranscriptTap {
    pub fn new(side: Side, to: tokio::sync::mpsc::Sender<(String, String)>) -> FrameProcessor {
        FrameProcessor::new(
            if side == Side::Caller { "TranscriptTapCaller" } else { "TranscriptTapAgent" },
            Box::new(Self { side, to, partial: std::sync::Mutex::new(String::new()) }),
            false,
        )
    }
}

#[async_trait::async_trait]
impl crate::frames::FrameHandler for TranscriptTap {
    async fn on_process_frame(
        &self,
        processor: &FrameProcessor,
        frame: crate::frames::Frame,
        direction: crate::frames::FrameDirection,
    ) -> crate::error::Result<()> {
        use crate::frames::{ControlFrame, DataFrame, FrameInner};

        match (&frame.inner, self.side) {
            // Interim transcripts are the transcriber changing its mind mid-word.
            // Only what it settled on belongs in a record somebody reads back.
            // The caller's words are read from the shared context, not from a
            // `Transcription` frame.
            //
            // A tap sitting between the transcriber and the aggregator saw
            // every other frame of a turn — `VADUserStartedSpeaking`,
            // `Interruption`, `VADUserStoppedSpeaking` — and never a
            // `Transcription`, while the aggregator immediately after it
            // received one each time. Whatever route the transcript takes, it
            // does not pass that point, and three calls' worth of reading did
            // not explain it.
            //
            // So this observes the place every turn certainly reaches: the
            // aggregator appends the caller's turn to the shared `LLMContext`
            // and then pushes `LLMContextFrame` downstream to trigger
            // inference. Sitting after the aggregator, that frame is the exact
            // moment a user turn is complete and in the context.
            (FrameInner::Data(DataFrame::LLMContextFrame(context)), Side::Caller) => {
                let latest = context.lock().ok().and_then(|held| {
                    held.messages.iter().rev().find_map(|message| match message {
                        crate::context::Message::User { content } => Some(content.clone()),
                        _ => None,
                    })
                });

                if let Some(text) = latest {
                    // The greeting pushes a context frame too, and a turn the
                    // model retries would arrive twice. Only a turn that is new
                    // is a turn worth recording.
                    let mut last = self.partial.lock().unwrap_or_else(|e| e.into_inner());
                    if *last != text && !text.trim().is_empty() {
                        *last = text.clone();
                        let _ = self.to.try_send(("caller".into(), text));
                    }
                }
            }

            (FrameInner::Data(DataFrame::LLMText(chunk)), Side::Agent) => {
                if let Ok(mut held) = self.partial.lock() {
                    held.push_str(chunk);
                }
            }

            (FrameInner::Control(ControlFrame::LLMFullResponseEnd), Side::Agent) => {
                let reply = self
                    .partial
                    .lock()
                    .map(|mut held| std::mem::take(&mut *held))
                    .unwrap_or_default();
                let reply = reply.trim();
                if !reply.is_empty() {
                    let _ = self.to.try_send(("agent".into(), reply.to_string()));
                }
            }

            // An interruption means the agent never finished saying it, so it
            // was never heard and does not belong in the transcript.
            (FrameInner::System(crate::frames::SystemFrame::Interruption), Side::Agent) => {
                if let Ok(mut held) = self.partial.lock() {
                    held.clear();
                }
            }

            _ => {}
        }

        processor.push_frame(frame, direction).await
    }
}

/* --------------------------------------------------------------- The whole */

/// The relay, in the order a call passes through it.
///
/// The aggregators are what make it a conversation rather than three services:
/// the user aggregator holds transcription until the caller stops talking, and
/// the assistant aggregator records what was said so the next turn has it.
pub struct Relay {
    pub processors: Vec<FrameProcessor>,
    pub context: Arc<std::sync::Mutex<LLMContext>>,
    /// False when the chosen model cannot be given tools, so the caller can say
    /// so once rather than leaving every tool silently unreachable.
    pub calls_tools: bool,
}

pub async fn build_relay(
    engine: &Engine,
    ctx: &StageContext<'_>,
    context: Arc<std::sync::Mutex<LLMContext>>,
    registry: crate::services::FunctionRegistry,
    // Where the conversation is written down. `None` records nothing, which is
    // what pre-flight wants — it is not a call.
    transcript: Option<tokio::sync::mpsc::Sender<(String, String)>>,
) -> Result<Relay, String> {
    let stt = listening(engine, ctx).await?;
    let thinking = thinking(engine, ctx, registry).await?;
    let tts = speaking(engine, ctx).await?;

    // An engine that cannot call tools is not one we support. Refused here
    // rather than built and left to disappoint: an agent whose skills silently
    // do nothing is worse than a call that fails with a reason in the log.
    if !thinking.calls_tools() {
        return Err(format!(
            "the thinking step uses a model that cannot call tools, so the agent's skills \
             would be inert — choose a provider that declares functions"
        ));
    }
    let calls_tools = thinking.calls_tools();

    let mut processors = vec![stt];
    processors.push(LLMUserAggregator::new(context.clone()));
    // After the aggregator, where a completed caller turn is already in the
    // context and the frame announcing it is on its way to the model.
    if let Some(to) = transcript.clone() {
        processors.push(TranscriptTap::new(Side::Caller, to));
    }
    processors.push(thinking.into_processor());
    processors.push(LLMAssistantAggregator::new(context.clone()));
    // After the model, where the reply is still passing as text on its way to
    // be spoken.
    if let Some(to) = transcript {
        processors.push(TranscriptTap::new(Side::Agent, to));
    }
    processors.push(tts);

    Ok(Relay {
        processors,
        context,
        calls_tools,
    })
}

/* --------------------------------------------------------- The tool adapter */

/// The agent's tools, in the shape a chat-completions model expects.
///
/// This is the adapter. A tool is one row and one piece of JavaScript; what
/// differs between providers is only how the tool is *declared* and how a call
/// comes back. Gemini Live takes `FunctionDeclaration` and returns a `ToolCall`
/// event; a chat model takes `FunctionSchema` and returns `tool_calls`. Both end
/// at the same dispatcher, so a tool written once works on either shape.
///
/// Without this a relay engine would be handed no tools at all — silently, since
/// nothing fails when a model is simply never told a function exists.
pub fn declare(agent_tools: &[Value]) -> Vec<FunctionSchema> {
    agent_tools
        .iter()
        .filter_map(|tool| {
            let name = tool.get("name")?.as_str()?.to_string();
            let schema = tool.get("schema")?.clone();
            if !schema.is_object() {
                log::warn!("[tools] {name} has no usable schema — not declaring it");
                return None;
            }
            Some(FunctionSchema {
                name,
                description: tool
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                parameters: Some(schema),
                // Left to the provider's default, as the Gemini path does.
                strict: None,
            })
        })
        .collect()
}

/// How the agent reports what happened, so the flow can move on.
///
/// The same contract the realtime path declares. A relay without it reaches the
/// agent node and parks there until the node's timeout, which on a call is the
/// caller listening to nothing.
pub fn outcome_schema(outcomes: &[String]) -> FunctionSchema {
    FunctionSchema {
        name: "finish_call".into(),
        description: Some(
            "Call this once the conversation is finished, or as soon as you know you cannot \
             finish it. Say your closing line first."
                .into(),
        ),
        parameters: Some(serde_json::json!({
            "type": "object",
            "properties": {
                "outcome": { "type": "string", "enum": outcomes },
                "note": {
                    "type": "string",
                    "description": "One sentence on what happened, for the call record.",
                },
            },
            "required": ["outcome"],
        })),
        strict: None,
    }
}

/// Everything the model may call, wired to what actually runs it.
///
/// `finish_call` is answered here rather than dispatched: it is the flow's
/// function, not a tool, and looking it up would find nothing.
pub fn registry(
    dispatch: ToolRoute,
    outcome_tx: tokio::sync::mpsc::Sender<(String, Value)>,
    tools: Vec<String>,
) -> crate::services::FunctionRegistry {
    let mut registry = crate::services::FunctionRegistry::new();

    registry.register("finish_call", move |args: String| {
        let tx = outcome_tx.clone();
        async move {
            let parsed: Value = serde_json::from_str(&args).unwrap_or_else(|_| serde_json::json!({}));
            let outcome = parsed
                .get("outcome")
                .and_then(Value::as_str)
                .unwrap_or("done")
                .to_string();
            // The *function name*, not the outcome. The consumer filters on
            // `finish_call` and parses the outcome out of the arguments itself,
            // so sending "done" here meant every relay outcome was dropped: the
            // agent said goodbye and the flow never learned the call was over,
            // leaving the caller to hang up.
            let _ = tx.try_send(("finish_call".to_string(), parsed));
            log::info!("[tools] finish_call — {outcome}");
            serde_json::json!({ "ok": true, "outcome": outcome }).to_string()
        }
    });

    for name in tools {
        let route = dispatch.clone();
        let tool = name.clone();
        registry.register(name, move |args: String| {
            let route = route.clone();
            let tool = tool.clone();
            async move {
                let parsed: Value =
                    serde_json::from_str(&args).unwrap_or_else(|_| serde_json::json!({}));
                super::tools::call_live(
                    &route.supabase_url,
                    &route.service_key,
                    &route.org_id,
                    &route.ucid,
                    &tool,
                    parsed,
                )
                .await
                .to_string()
            }
        });
    }

    registry
}

/// Where a tool call goes. The same four values the realtime dispatch carries.
#[derive(Clone)]
pub struct ToolRoute {
    pub supabase_url: String,
    pub service_key: String,
    pub org_id: String,
    pub ucid: String,
}

/* ------------------------------------------------------------------ Pre-flight */

/// What one step said when it was actually asked.
#[derive(Debug, serde::Serialize)]
pub struct StepReport {
    pub stage: String,
    pub provider: String,
    pub ok: bool,
    pub error: Option<String>,
}

/// Try an engine without a caller on the line.
///
/// The reason this exists: on 1 September a relay was published with Sarvam's
/// `bulbul:v2`, which the catalogue offered because the crate's own default
/// still named it. Sarvam had retired it. Every other step of that call worked —
/// the transcript came back, the model answered in 0.139s — and the caller heard
/// silence, because the only thing that failed was the one thing nothing had
/// asked in advance.
///
/// Discovery would not have caught it: Sarvam publishes no model list. What
/// catches it is doing what a call does — opening the same connections, with
/// the same keys, against the same models — and reporting what came back.
///
/// So this builds the real processors and runs them briefly. It is deliberately
/// not a cheaper imitation: an imitation is a second implementation that can
/// disagree with the first, and the disagreement would be invisible until a
/// call proved it.
pub async fn preflight(engine: &Engine, ctx: &StageContext<'_>) -> Vec<StepReport> {
    let mut reports = Vec::new();

    if engine.mode == "realtime" {
        // One connection, and `connect` either returns a session or the
        // provider's own refusal.
        let provider = engine.get("realtime", "provider").unwrap_or("").to_string();
        reports.push(match realtime_probe(engine, ctx).await {
            Ok(()) => StepReport { stage: "realtime".into(), provider, ok: true, error: None },
            Err(problem) => StepReport {
                stage: "realtime".into(),
                provider,
                ok: false,
                error: Some(problem),
            },
        });
        return reports;
    }

    // Constructing the handlers is not the test. On 1 September every one of
    // them constructed and the call was still silent: Sarvam accepted the
    // connection and *then* answered `400: Model 'bulbul:v2' has been
    // deprecated`. Nothing that stops at construction can see that.
    //
    // So the real processors are run, briefly, with no caller. Errors surface
    // as `ErrorFrame`s carrying the processor that raised them, which is how a
    // failure is attributed to a step.
    let stages = [("stt", "Stt"), ("llm", "LLM"), ("tts", "Tts")];

    let context = crate::context::shared_context(Some("Say nothing.".into()));
    let relay = match build_relay(engine, ctx, context, crate::services::FunctionRegistry::new(), None).await
    {
        Ok(relay) => relay,
        Err(problem) => {
            // A step that cannot even be built — no provider, no key, a
            // provider rustvani does not have. The message already names which.
            return stages
                .iter()
                .map(|(stage, _)| StepReport {
                    stage: (*stage).into(),
                    provider: engine.get(stage, "provider").unwrap_or("").to_string(),
                    ok: false,
                    error: Some(problem.clone()),
                })
                .collect();
        }
    };

    let failures: Arc<std::sync::Mutex<Vec<(String, String)>>> = Arc::default();
    let task = crate::pipeline::PipelineTask::new(
        relay.processors,
        crate::pipeline::PipelineParams { allow_interruptions: true, ..Default::default() },
    );

    let collected = failures.clone();
    task.add_on_pipeline_error(move |error| {
        let collected = collected.clone();
        Box::pin(async move {
            if let Ok(mut held) = collected.lock() {
                held.push((error.processor_name.unwrap_or_default(), error.error));
            }
        })
    });

    // Long enough for each provider to accept or refuse the connection — the
    // Sarvam refusal arrived in well under a second — and short enough that
    // somebody waiting on the answer does not give up on it.
    let sender = task.push_sender();
    let running = tokio::spawn(async move { task.run(crate::clock::system_clock(), None).await });
    tokio::time::sleep(std::time::Duration::from_millis(2500)).await;
    let _ = sender.send((crate::frames::Frame::cancel(), crate::frames::FrameDirection::Downstream)).await;
    let _ = tokio::time::timeout(std::time::Duration::from_secs(3), running).await;

    let raised = failures.lock().map(|held| held.clone()).unwrap_or_default();
    for (stage, marker) in stages {
        let provider = engine.get(stage, "provider").unwrap_or("").to_string();
        // Attributed by the processor that raised it: "SarvamTts" carries
        // `Tts`, "SarvamStt" carries `Stt`, "OpenAILLM" carries `LLM`.
        let problem = raised
            .iter()
            .find(|(processor, _)| processor.contains(marker))
            .map(|(_, message)| message.clone());
        reports.push(StepReport {
            stage: stage.into(),
            provider,
            ok: problem.is_none(),
            error: problem,
        });
    }

    reports
}

enum StageKind {
    Listening,
    Thinking,
    Speaking,
}

// ---------------------------------------------------------------------------
// The realtime half of the tool adapter
// ---------------------------------------------------------------------------
//
// `declare` above turns a VoKoo tool row into the chat-model shape a relay
// needs. These turn the same row into Gemini's. They lived in the binary,
// which meant the two halves of one adapter sat in different files and only
// one of them was findable from the other.


/// How an agent node reports the way it finished.
///
/// Declared to the model as a function, so the outcome is the model's judgement
/// rather than a keyword match on a transcript. `gone_quiet` and `timeout` are
/// deliberately absent: those are observed by the bridge, and a model asked to
/// judge its own silence would be guessing.
/// One of the agent's tools, as the provider wants it.
///
/// `tools.schema` is stored as a plain JSON Schema, which is what `parameters`
/// takes, so it is passed through unchanged. A tool with no schema is skipped
/// rather than declared with empty parameters: the model would call it with
/// nothing and the dispatcher would reject it for missing arguments, which
/// spends a caller's patience to reach a failure we can predict here.
pub fn gemini_declaration(tool: &serde_json::Value) -> Option<gemini_live::FunctionDeclaration> {
    let name = tool.get("name")?.as_str()?.to_string();
    let schema = tool.get("schema")?.clone();
    if !schema.is_object() {
        log::warn!("[tools] {name} has no usable schema — not declaring it");
        return None;
    }
    Some(gemini_live::FunctionDeclaration {
        name,
        description: tool
            .get("description")
            .and_then(|d| d.as_str())
            .unwrap_or_default()
            .to_string(),
        parameters: schema,
        // Left to the provider's defaults, as the outcome function does. These
        // control response scheduling for Gemini 2.5-era tools; choosing values
        // here would be picking behaviour nobody has asked for.
        scheduling: None,
        behavior: None,
    })
}

pub fn gemini_outcome() -> gemini_live::FunctionDeclaration {
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

/// The outcomes an agent node may report. Named once, so the three
/// declarations of `finish_call` — chat, Gemini, realtime — cannot drift into
/// offering different providers different words.
pub const FLOW_OUTCOMES: [&str; 4] = ["done", "wants_human", "out_of_scope", "failed"];

/// A VoKoo tool row in OpenAI's **realtime** shape.
///
/// Flat: `{type, name, description, parameters}`. This is not the nested
/// `{type:"function", function:{..}}` that chat completions takes — same
/// vendor, two APIs, two shapes, and each rejects the other.
pub fn openai_realtime_declaration(tool: &Value) -> Option<Value> {
    let name = tool.get("name")?.as_str()?;
    let schema = tool.get("schema")?.clone();
    if !schema.is_object() {
        log::warn!("[tools] {name} has no usable schema — not declaring it");
        return None;
    }
    Some(serde_json::json!({
        "type": "function",
        "name": name,
        "description": tool.get("description").and_then(Value::as_str).unwrap_or_default(),
        "parameters": schema,
    }))
}

/// `finish_call`, in that shape, built from [`outcome_schema`] rather than
/// written out again.
pub fn openai_realtime_outcome(outcomes: &[String]) -> Value {
    let schema = outcome_schema(outcomes);
    serde_json::json!({
        "type": "function",
        "name": schema.name,
        "description": schema.description.unwrap_or_default(),
        "parameters": schema.parameters.unwrap_or(serde_json::json!({"type": "object"})),
    })
}

/// What a realtime session needs that the engine row does not carry.
///
/// The engine says which provider, model and voice. Everything here belongs to
/// the call: what the agent was told, which tools its skills grant, which
/// languages to transcribe.
pub struct RealtimeRequest<'a> {
    pub instructions: &'a str,
    /// VoKoo tool rows, in the shape the database stores them. The builder
    /// translates them for whichever provider the engine names, the same way
    /// `declare` does for a relay — so a caller never has to know which shape a
    /// provider wants.
    pub functions: Vec<serde_json::Value>,
    /// Whether to declare `finish_call`. True when a flow is waiting on an
    /// outcome; false for a call that never reached one and has nothing to
    /// report back to.
    pub declare_outcome: bool,
    pub language_codes: Vec<String>,
    /// Used when the organisation has not connected a key for this vendor.
    /// Kept because a call that never reached a flow has no organisation to
    /// resolve against, and losing that fallback would take a working line
    /// down to prove a point about configuration.
    pub fallback_key: Option<String>,
    /// Open the session, prove it answers, say nothing. Pre-flight passes true.
    pub probe: bool,
}

impl Default for RealtimeRequest<'_> {
    fn default() -> Self {
        Self {
            instructions: "",
            functions: Vec::new(),
            declare_outcome: false,
            language_codes: vec!["en-IN".to_string()],
            fallback_key: None,
            probe: false,
        }
    }
}

/// Build the one model that hears and speaks.
///
/// The counterpart of [`build_relay`], and the thing the realtime path never
/// had. Until this existed a realtime session was constructed inline in the
/// WebSocket handler — one `if provider == "openai" { .. } else { .. }` branch
/// per provider, each repeating its own vault lookup and its own environment
/// fallback — while pre-flight built a *different* session in
/// `realtime_probe`, which knew only Gemini. So an OpenAI engine could not be
/// pre-flighted at all, and the two builders could disagree about a working
/// engine in either direction.
///
/// That is the same fault CLAUDE.md records against the first pre-flight: a
/// cheaper imitation is a second implementation. It was fixed for relays and
/// left standing here. One builder, both callers.
pub async fn build_realtime(
    engine: &Engine,
    ctx: &StageContext<'_>,
    request: RealtimeRequest<'_>,
) -> Result<Box<dyn crate::services::RealtimeSession>, String> {
    let stage = stage(engine, "realtime")?;
    let provider = field(stage, "provider").ok_or("the model step names no provider")?;
    let model = field(stage, "model").ok_or("the model step names no model")?;

    // The catalogue turns a friendly id into the provider's own, so a vendor
    // renaming a model is one UPDATE rather than a deploy.
    let resolved = super::graph::model_id(ctx.supabase_url, ctx.service_key, model)
        .await
        .ok_or_else(|| format!("{model} is not in the model catalogue"))?;

    let key = match ctx.key_for(provider).await {
        Ok(key) => key,
        Err(why) => request
            .fallback_key
            .clone()
            .filter(|k| !k.trim().is_empty())
            .ok_or(why)?,
    };

    let voice = field(stage, "voice").map(str::to_owned);
    let temperature = engine.get_f64("realtime", "temperature").map(|v| v as f32);
    let max_output_tokens = engine.get_f64("realtime", "max_tokens").map(|v| v as u32);
    // A probe must not talk to anybody: it opens what a call opens and closes
    // it. Passing the real instructions would have it compose a greeting for a
    // caller who is not there.
    let instructions = if request.probe { "Say nothing." } else { request.instructions };

    match provider {
        "gemini" => Ok(Box::new(
            crate::services::GeminiLiveSession::connect(crate::services::GeminiLiveConfig {
                api_key: key,
                model: resolved,
                voice,
                instructions: instructions.to_string(),
                language_codes: request.language_codes,
                temperature,
                max_output_tokens,
                functions: if request.probe {
                    Vec::new()
                } else {
                    // The outcome function first: the flow waits on it, and it
                    // exists whether or not the agent has any tools of its own.
                    let mut declared =
                        if request.declare_outcome { vec![gemini_outcome()] } else { Vec::new() };
                    declared.extend(request.functions.iter().filter_map(gemini_declaration));
                    declared
                },
                // **Not** `request.probe`. Asking for a transcribe-only
                // session sets the response modality to TEXT, and
                // `gemini-3.1-flash-live-preview` refuses that combination —
                // so a probe failed an engine that had been carrying real
                // calls, and failed it for a reason no caller could ever hit.
                //
                // A probe opens what a call opens. It never sends audio and
                // closes at once, so there is nothing for the model to answer
                // and no need to ask it to stay quiet in a way a call does not.
                transcribe_only: false,
            })
            .await?,
        )),

        // Refused rather than connected, on the rule that an engine which
        // cannot call tools is not supported: `OpenAIRealtimeConfig` has no
        // functions field, so every skill the agent grants would be silently
        // unreachable. The refusal names the reason, because the fix is to
        // implement declaration rather than to change engines.
        // Also refused when a flow is waiting on an outcome: without
        // `finish_call` the agent can never report one, and the flow sits at
        // the agent node until its timeout rather than moving on.
        "openai" if !request.functions.is_empty() || request.declare_outcome => Err(
            "OpenAI Realtime cannot declare functions in this build, so the agent's tools \
             would be unreachable — see migration 0045"
                .to_string(),
        ),

        "openai" => Ok(Box::new(
            crate::services::OpenAIRealtimeSession::connect(
                crate::services::OpenAIRealtimeConfig {
                    api_key: key,
                    model: resolved,
                    voice: voice.unwrap_or_else(|| "alloy".to_string()),
                    instructions: instructions.to_string(),
                    sample_rate: ctx.sample_rate,
                    tools: if request.probe {
                        Vec::new()
                    } else {
                        // The outcome function first, as the Gemini path does:
                        // the flow waits on it whether or not the agent has
                        // tools of its own.
                        let mut declared = if request.declare_outcome {
                            let outcomes: Vec<String> =
                                FLOW_OUTCOMES.iter().map(|o| o.to_string()).collect();
                            vec![openai_realtime_outcome(&outcomes)]
                        } else {
                            Vec::new()
                        };
                        declared.extend(
                            request.functions.iter().filter_map(openai_realtime_declaration),
                        );
                        declared
                    },
                    tool_choice: None,
                    billing: Some(ctx.billing.clone()),
                    ..crate::services::OpenAIRealtimeConfig::default()
                },
            )
            .await?,
        )),

        other => Err(format!("rustvani has no {other} realtime provider")),
    }
}

/// Open the realtime session the call would open, then close it.
///
/// "The call would open" is now literally true: this builds through
/// [`build_realtime`], the same function the call path uses. The previous
/// version constructed its own Gemini session and knew no other provider —
/// so an OpenAI engine failed pre-flight whatever its state, and a Gemini one
/// was tested by code that could drift from the code serving callers.
///
/// The single difference is `probe`, which the builder handles: no tools, no
/// instructions, transcribe-only. Everything a caller would hit — the key, the
/// catalogue lookup, the model id, the voice, the connection — is the same.
async fn realtime_probe(engine: &Engine, ctx: &StageContext<'_>) -> Result<(), String> {
    let mut session =
        build_realtime(engine, ctx, RealtimeRequest { probe: true, ..Default::default() }).await?;
    // Through the box: `close` takes `&mut self` on the trait, and a
    // `Box<dyn Trait>` does not itself implement the trait.
    crate::services::RealtimeSession::close(session.as_mut()).await;
    Ok(())
}
