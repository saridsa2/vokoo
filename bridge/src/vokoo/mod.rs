//! VoKoo call flows.
//!
//! A phone number points at a flow: a graph of nodes joined by transitions that
//! leave a *named outcome*. An agent is one node inside it, not the whole call —
//! it reports how it finished and the flow decides what that means, which is
//! what lets one agent serve two businesses that escalate differently.
//!
//! Three parts:
//!
//! * [`graph`]   — the stored shape, loaded from Postgres at the start of a call
//! * [`control`] — acting on the live call through the carrier
//! * [`runner`]  — walking the graph while someone is on the line
//!
//! The flow is read once, when the call arrives, and not again. A flow
//! republished mid-call therefore does not change a call in progress: the
//! caller finishes on the graph they started with.

pub mod billing;
pub mod compare;
pub mod control;
pub mod discovery;
pub mod engine;
pub mod escalate;
pub mod expression;
pub mod graph;
pub mod intelligence;
pub mod handover;
pub mod keypress;
pub mod postcall;
pub mod record;
pub mod runner;
pub mod setvalues;
pub mod webhook;
pub mod tools;

pub use billing::PostgrestBillingStorage;
pub use control::{CallControl, CallHandle};
pub use engine::{build_realtime, build_relay, Relay, RealtimeRequest, StageContext, ThinkingStage};
pub use escalate::{escalate, Cause};
pub use graph::{agent_greeting, agent_prompt, agent_tools, engine_for_agent, Engine, Flow, FlowNode, NodeType};
pub use handover::{escape, Handover, Handovers};
pub use keypress::Keypresses;
pub use record::CallRecord;
pub use runner::{FlowRunner, NodeAction, Outcome};
