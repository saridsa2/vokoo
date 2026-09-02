//! Walking a flow while someone is on the phone.
//!
//! Start at the node that answers, run it, take the transition matching its
//! outcome, repeat. Most nodes finish in microseconds. The agent does not — it
//! holds the caller for minutes — so the runner hands that one back to the
//! bridge, which owns the audio sockets, and resumes when it reports an
//! outcome.
//!
//! That split is why [`NodeAction`] exists. The runner decides *what* happens
//! next; the bridge knows *how* to talk to someone.

use super::control::CallControl;
use super::graph::{Flow, FlowNode};

/// How a node finished. The name matches an outcome declared by the node's type
/// in the registry, which is what a transition is keyed on.
pub type Outcome = String;

/// What the bridge should do next.
pub enum NodeAction<'a> {
    /// Hand the caller to this agent and report how it finished.
    RunAgent { node: &'a FlowNode, agent_id: String, timeout_seconds: u64 },
    /// Stop talking and stay on the line, transcribing, until the call ends.
    ///
    /// Like [`RunAgent`](Self::RunAgent) this suspends the walk — but unlike it
    /// there is no outcome to wait for. The agent has nothing left to decide;
    /// the carrier decides when the call is over.
    Monitor { node: &'a FlowNode, timeout_seconds: u64 },
    /// Ask the caller to press a key, and come back with which one.
    ///
    /// Unlike the two above, this suspends the walk *without* a pipeline: the
    /// carrier plays the prompt and collects the key itself, between streams,
    /// and answers on a new HTTP request. That is the whole reason a menu is a
    /// node and not a tool — the language a caller picks has to be known before
    /// an engine connects, because the transcriber and the voice take their
    /// language when their sockets open.
    CollectDigits {
        node: &'a FlowNode,
        prompt: String,
        /// What the carrier speaks the prompt in, which is not what the call
        /// will be conducted in — the menu has to be understood by someone who
        /// has not chosen yet.
        language: String,
        /// One per key offered, as `(key, what it means)`.
        keys: Vec<(String, String)>,
        /// How many times to repeat before giving up and taking `timeout`.
        attempts: u32,
        timeout_seconds: u64,
    },
    /// The call is over. The string is why, for the call log.
    Finished(String),
}

/// A graph with nothing wired to a loop is still a graph someone drew by hand.
/// This bounds a mis-wired one to something a caller might sit through rather
/// than an unbounded spin.
const MAX_STEPS: usize = 64;

/// Nodes the IVR webhook may evaluate before the call has a stream.
///
/// The webhook walks the flow for one reason: to find out whether the first
/// thing it wants is a menu, because `<collectdtmf>` can only be answered
/// before a stream opens. The WebSocket handler then walks the *same* flow for
/// real. So anything the webhook runs would run twice — and half these nodes
/// dial a number, transfer the call or hang it up.
///
/// A whitelist rather than a list of things to skip: a node type added later is
/// then refused by default, instead of being silently executed twice by a walk
/// nobody remembered to teach about it.
/// Triggers are matched by prefix here for the same reason `run_immediate`
/// matches them that way: a new trigger type should be a catalogue row, not a
/// code change. Every flow starts on one, so leaving them out stopped every
/// preview on the first node and no menu was ever reached.
const PREVIEWABLE: &[&str] = &["business_hours"];

fn previewable(implementation: &str) -> bool {
    implementation.starts_with("trigger.") || PREVIEWABLE.contains(&implementation)
}

/// One node the call passed through.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Step {
    pub node_id: String,
    pub name: String,
    pub implementation: String,
    pub outcome: Outcome,
}

pub struct FlowRunner<'a> {
    flow: &'a Flow,
    control: &'a CallControl,
    current: Option<String>,
    /// Every node entered and how it finished — what a call log should show
    /// instead of a transcript and a duration.
    /// Every node entered, in order, with what the trace needs to point back
    /// at the graph. A name alone cannot be resolved to a node — two nodes may
    /// share one, and renaming a node in the composer would orphan every past
    /// call that mentioned it.
    pub trail: Vec<Step>,
    steps: usize,
    /// Why the flow's trigger fired, when the event has more than one cause.
    ///
    /// `call.answered` has one way in and never sets this. `call.ended` has
    /// two — the caller hung up, or we did — and only the caller of the runner
    /// knows which, because by then the carrier has said so on a webhook the
    /// runner never sees.
    started_by: Option<Outcome>,
    /// Menus this call has already answered, as node id -> key pressed.
    ///
    /// The flow is walked more than once per call — once on the webhook that
    /// decides what XML to return, again when the stream opens — and a menu
    /// already answered must not stop the walk a second time. With this, the
    /// second pass records the same outcome and carries straight on.
    answered: std::collections::HashMap<String, String>,
    /// Walking to see what the flow wants, not to do it.
    preview: bool,
}

impl<'a> FlowRunner<'a> {
    pub fn new(flow: &'a Flow, control: &'a CallControl) -> Self {
        Self {
            flow,
            control,
            current: Some(flow.start.clone()),
            trail: Vec::new(),
            steps: 0,
            started_by: None,
            answered: std::collections::HashMap::new(),
            preview: false,
        }
    }

    /// Walk without touching the carrier.
    ///
    /// Stops at the first node that would do something rather than running it,
    /// so the webhook can discover a menu without dialling anybody. The real
    /// walk happens later, when the stream is open.
    pub fn preview(mut self) -> Self {
        self.preview = true;
        self
    }

    /// Supply the keys this call has already pressed.
    pub fn already_answered(mut self, answered: std::collections::HashMap<String, String>) -> Self {
        self.answered = answered;
        self
    }

    /// Name the cause the trigger fired for, before walking.
    pub fn started_by(mut self, outcome: impl Into<Outcome>) -> Self {
        self.started_by = Some(outcome.into());
        self
    }

    /// Run until the flow needs the bridge, or the call is over.
    pub async fn advance(&mut self) -> NodeAction<'a> {
        loop {
            self.steps += 1;
            if self.steps > MAX_STEPS {
                log::warn!("[flow] gave up after {MAX_STEPS} nodes — the graph probably loops");
                return NodeAction::Finished("looped".into());
            }

            let Some(node_id) = self.current.clone() else {
                return NodeAction::Finished("no path".into());
            };
            let Some(node) = self.flow.node(&node_id) else {
                log::warn!("[flow] transition led to a node that is not here: {node_id}");
                return NodeAction::Finished("broken flow".into());
            };

            if node.implementation == "agent" {
                let agent_id = node.config_str("agent_id").unwrap_or_default().to_string();
                let timeout = node
                    .config_i64("timeout_seconds")
                    .or_else(|| self.flow.definition(node).and_then(|d| d.default_timeout_seconds))
                    .unwrap_or(600)
                    .max(1) as u64;
                return NodeAction::RunAgent { node, agent_id, timeout_seconds: timeout };
            }

            if node.implementation == "agent.monitor" {
                // Normally the carrier ends the call long before this. It is
                // here for the call that never ends: a leg the carrier has
                // forgotten would otherwise stream audio to a transcriber for
                // as long as the process lives.
                let timeout = node
                    .config_i64("timeout_seconds")
                    .or_else(|| self.flow.definition(node).and_then(|d| d.default_timeout_seconds))
                    .unwrap_or(7200)
                    .max(1) as u64;
                return NodeAction::Monitor { node, timeout_seconds: timeout };
            }

            if self.preview
                && node.implementation != "kookoo.collect_digits"
                && !previewable(&node.implementation)
            {
                // Not a menu and not safe to evaluate without a call in hand.
                // The caller of a preview reads this as "nothing to ask".
                return NodeAction::Finished(format!("preview stopped at {}", node.implementation));
            }

            if node.implementation == "kookoo.collect_digits" {
                // Answered on an earlier webhook: record the same outcome and
                // walk on, so the second pass reaches the agent rather than
                // asking the caller to choose a language twice.
                if let Some(key) = self.answered.get(&node_id).cloned() {
                    // A key the menu does not offer is not an answer. Ending
                    // the flow here is what a caller who pressed 5 on a
                    // two-option menu got: no agent, so no pipeline, so
                    // silence, and the carrier hung up on them. `timeout` is
                    // the branch this node already declares for "nobody chose
                    // anything", and it is wired, so it is where an unoffered
                    // key belongs.
                    //
                    // Re-asking would be kinder still and is what the unused
                    // `attempts` field is for. It needs a count that survives
                    // the round trip, which this map does not carry.
                    let outcome = if self.flow.next(&node_id, &key).is_some() {
                        key
                    } else {
                        log::warn!(
                            "[flow] {} was sent key {key}, which it does not offer — \
                             taking the no-keypress branch",
                            node.name
                        );
                        "timeout".to_string()
                    };

                    self.record(node, &outcome);
                    match self.follow(&node_id, &outcome) {
                        Some(next) => {
                            self.current = Some(next);
                            continue;
                        }
                        // Nothing wired to `timeout` either. The composer lets
                        // you draw this, so say which node stranded the call
                        // rather than reporting a bare dead end.
                        None => {
                            return NodeAction::Finished(format!(
                                "{} has no path for {outcome}",
                                node.name
                            ))
                        }
                    }
                }

                let keys = node.config_branches("digits");
                if keys.is_empty() {
                    // Nothing to press. Asking would strand the caller in a
                    // menu with no exits, so take the fallback the type
                    // declares and keep the call moving.
                    log::warn!("[flow] {} offers no keys — taking timeout", node.name);
                    self.record(node, "timeout");
                    match self.follow(&node_id, "timeout") {
                        Some(next) => {
                            self.current = Some(next);
                            continue;
                        }
                        None => return NodeAction::Finished("menu with no keys".into()),
                    }
                }

                let timeout = node
                    .config_i64("timeout_seconds")
                    .or_else(|| self.flow.definition(node).and_then(|d| d.default_timeout_seconds))
                    .unwrap_or(8)
                    .max(1) as u64;

                return NodeAction::CollectDigits {
                    node,
                    prompt: node.config_str("prompt").unwrap_or_default().to_string(),
                    language: node.config_str("language").unwrap_or("en-IN").to_string(),
                    keys,
                    attempts: node.config_i64("attempts").unwrap_or(1).clamp(1, 5) as u32,
                    timeout_seconds: timeout,
                };
            }

            let outcome = self.run_immediate(node).await;
            self.record(node, &outcome);

            if outcome == "__end__" {
                let reason = node.config_str("reason").unwrap_or("ended").to_string();
                return NodeAction::Finished(reason);
            }

            match self.follow(&node_id, &outcome) {
                Some(next) => self.current = Some(next),
                None => return NodeAction::Finished(format!("unhandled: {outcome}")),
            }
        }
    }

    /// Report how the agent node finished and continue from there.
    pub fn agent_finished(&mut self, node_id: &str, outcome: &str) {
        if let Some(node) = self.flow.node(node_id) {
            self.record(node, outcome);
        }
        self.current = self.follow(node_id, outcome);
    }

    /// Report which key the caller pressed and continue from there.
    ///
    /// The digit is the outcome, because the composer writes one branch per key
    /// and keys the transition on the key itself.
    pub fn digits_collected(&mut self, node_id: &str, key: &str) {
        if let Some(node) = self.flow.node(node_id) {
            self.record(node, key);
        }
        self.answered.insert(node_id.to_string(), key.to_string());
        self.current = self.follow(node_id, key);
    }

    /// Note that the call was handed to a listener, and stop walking.
    ///
    /// The outcome is written now rather than when the call ends, because the
    /// process holding the call may not outlive it in a way that gets another
    /// chance to write. `call_ended` is what this node always reaches when it
    /// works — nothing is wired after it, and the carrier ends the call.
    pub fn monitor_started(&mut self, node_id: &str, started: bool) {
        if let Some(node) = self.flow.node(node_id) {
            self.record(node, if started { "call_ended" } else { "failed" });
        }
        self.current = None;
    }

    fn record(&mut self, node: &FlowNode, outcome: &str) {
        let name = if node.name.is_empty() { node.id.clone() } else { node.name.clone() };
        log::info!("[flow] {name} -> {outcome}");
        self.trail.push(Step {
            node_id: node.id.clone(),
            name,
            implementation: node.implementation.clone(),
            outcome: outcome.to_string(),
        });
    }

    fn follow(&self, from: &str, outcome: &str) -> Option<String> {
        match self.flow.next(from, outcome) {
            Some(next) => Some(next.to_string()),
            None => {
                // An outcome with nothing wired to it. The call stops, and the
                // log names the outcome that had nowhere to go — the thing the
                // canvas draws hollow.
                log::info!("[flow] nothing wired to {from}/{outcome}");
                None
            }
        }
    }

    /// A node that finishes without leaving the process.
    async fn run_immediate(&self, node: &FlowNode) -> Outcome {
        match node.implementation.as_str() {
            "business_hours" => business_hours(node),

            "kookoo.conference" => {
                let Some(number) = node.config_str("phoneno").filter(|n| !n.is_empty()) else {
                    log::warn!("[flow] conference node has no number to dial");
                    return "failed".into();
                };
                let ok = self.control.conference(number, node.config_bool("play_ring", true)).await;
                if ok { "ok".into() } else { "failed".into() }
            }

            // A cold hand-over: the caller goes to a person and our stream
            // ends, so the agent cannot stay on the line. `kookoo.conference`
            // is the warm version that can. This one works today.
            "kookoo.transfer" => {
                let Some(number) = node.config_str("phoneno").filter(|n| !n.is_empty()) else {
                    log::warn!("[flow] transfer node has no number to dial");
                    return "failed".into();
                };
                let on_no_answer = node.config_str("no_answer_message").unwrap_or(
                    "Sorry, nobody is available to take your call right now. \
                     Please try again later. Goodbye.",
                );
                if self.control.queue_transfer(
                    number,
                    node.config_bool("record", true),
                    on_no_answer,
                ) {
                    "ok".into()
                } else {
                    "failed".into()
                }
            }

            "kookoo.hold" => if self.control.hold().await { "ok".into() } else { "failed".into() },

            "kookoo.pause_recording" => {
                log::warn!("[flow] kookoo.pause_recording has no verified carrier API yet");
                "failed".into()
            }

            "kookoo.hangup" => {
                self.control.disconnect().await;
                "__end__".into()
            }

            // Ending our part without ending the call. After a conference the
            // caller is talking to a person, and issuing Disconnect here would
            // drop them a moment after they were put through — the flow would
            // report a successful transfer while hanging up on the caller.
            "kookoo.release" => {
                let reason = node.config_str("reason").unwrap_or("released");
                log::info!("[flow] stepping back, call left up ({reason})");
                "__end__".into()
            }

            // The first node that can act on anything outside the call. It
            // names a tool rather than a URL: the dispatcher validates the
            // arguments against that tool's schema, and a node carrying its own
            // endpoint would be validated against nothing.
            "tool.call" => {
                let Some(tool) = node.config_str("tool").filter(|t| !t.is_empty()) else {
                    log::warn!("[flow] tool node names no tool");
                    return "failed".into();
                };
                let tool = tool.to_string();
                let ctx = self.control.service();
                let args = node
                    .config
                    .get("args")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}));
                super::tools::call(
                    ctx.supabase_url,
                    ctx.service_key,
                    ctx.org_id,
                    ctx.ucid,
                    &tool,
                    args,
                    self.steps,
                )
                .await
                .outcome
            }

            // The flow's entry point. There is nothing to run: the event
            // already happened, and the runner is only walking because it did.
            // The node exists so the canvas can name what started the flow and
            // so a flow can branch on which cause fired — which is why it is a
            // node with outcomes rather than a label drawn on the board.
            //
            // Matched by prefix so a new trigger type is a catalogue row and
            // nothing else. Without this arm a graph carrying one would reach
            // the catch-all below and fail the call on its first node.
            trigger if trigger.starts_with("trigger.") => self
                .started_by
                .clone()
                .unwrap_or_else(|| "started".into()),

            // `condition`, `loop` and `code` all need an expression language,
            // and what an expression *is* has not been decided. Rather than
            // invent one under a caller, the node fails and the flow routes on
            // it — which is at least a path someone drew.
            other => {
                log::warn!("[flow] {other} is not implemented yet");
                "failed".into()
            }
        }
    }
}

/// Open or closed, in the business's own timezone.
///
/// The timezone is the clinic's, not the server's. A VPS in one country
/// answering for a business in another would otherwise close the line at the
/// wrong hour, and nobody would see why from the logs.
fn business_hours(node: &FlowNode) -> Outcome {
    let tz_name = node.config_str("timezone").unwrap_or("UTC");
    let Ok(tz) = tz_name.parse::<chrono_tz::Tz>() else {
        log::warn!("[flow] unknown timezone {tz_name:?} — treating as open");
        return "open".into();
    };

    let now = chrono::Utc::now().with_timezone(&tz);

    if let Some(days) = node.config.get("days").and_then(|d| d.as_array()) {
        let today = chrono::Datelike::weekday(&now).number_from_monday() as i64;
        if !days.is_empty() && !days.iter().any(|d| d.as_i64() == Some(today)) {
            return "closed".into();
        }
    }

    let opens = node.config_str("opens").unwrap_or("00:00");
    let closes = node.config_str("closes").unwrap_or("23:59");
    let current = chrono::Timelike::hour(&now) * 60 + chrono::Timelike::minute(&now);

    let to_minutes = |s: &str| -> u32 {
        let mut parts = s.split(':');
        let h: u32 = parts.next().unwrap_or("0").parse().unwrap_or(0);
        let m: u32 = parts.next().unwrap_or("0").parse().unwrap_or(0);
        h * 60 + m
    };

    if current >= to_minutes(opens) && current <= to_minutes(closes) {
        "open".into()
    } else {
        "closed".into()
    }
}
