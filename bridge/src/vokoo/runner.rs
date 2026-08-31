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
    /// The call is over. The string is why, for the call log.
    Finished(String),
}

/// A graph with nothing wired to a loop is still a graph someone drew by hand.
/// This bounds a mis-wired one to something a caller might sit through rather
/// than an unbounded spin.
const MAX_STEPS: usize = 64;

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
}

impl<'a> FlowRunner<'a> {
    pub fn new(flow: &'a Flow, control: &'a CallControl) -> Self {
        Self { flow, control, current: Some(flow.start.clone()), trail: Vec::new(), steps: 0 }
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
