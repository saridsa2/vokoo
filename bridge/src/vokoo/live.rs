//! The calls that are up right now.
//!
//! ## Why this is not a database query
//!
//! `calls` has `started_at` and `ended_at`, so "where `ended_at` is null" looks
//! like the answer and is not one. A call whose process died mid-flight never
//! gets its end written, so that query counts every crash this line has ever had
//! as a call still in progress — and the number only grows. A dashboard whose
//! "live now" figure can only go up is worse than no dashboard.
//!
//! ## Why it is not the Switchboard either
//!
//! `stasis::Switchboard` holds the calls **Asterisk** is bridging, which is the
//! WhatsApp path and the KooKoo pivot. A KooKoo call on the direct WebSocket
//! never becomes a Stasis channel, so it is invisible there. This registry sits
//! in `handle_call`, which every call passes through whatever wire it arrived
//! on, so it cannot miss one by construction.
//!
//! ## Why registration returns a guard
//!
//! Removing the entry on the way out of `handle_call` would leak on every path
//! that returns early, and this project has already had a TTS panic die inside a
//! spawned task. `Drop` runs on all of them, so a leaked entry would need the
//! whole process to leak.
//!
//! ## It announces changes rather than waiting to be asked
//!
//! Every mutation sends on a `broadcast` channel. A dashboard is a screen
//! somebody leaves open, and asking "what is live?" every few seconds spends a
//! request per viewer per tick to be told nothing changed — while still being
//! seconds late when something does. The registry knows the instant a call
//! starts, is attributed, gains a human, or ends, so that is when it says so.
//!
//! `broadcast` rather than `watch` because a subscriber that falls behind
//! should be told to re-read the whole snapshot, not handed a queue of stale
//! deltas: `RecvError::Lagged` is exactly that signal, and the snapshot is small
//! enough that sending all of it is cheaper than reconciling.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::{Value, json};
use tokio::sync::broadcast;

/// One call, as it looks while it is happening.
#[derive(Clone)]
pub struct LiveCall {
    /// Whose call this is. `None` when the number resolved no flow, which means
    /// nobody can be told about it — a call we cannot attribute is not shown to
    /// an organisation that might not own it.
    pub org_id: Option<String>,
    pub did: String,
    pub caller: String,
    /// `kookoo` or `whatsapp`. The wire, which is how a silent call is
    /// diagnosed, and worth seeing on a dashboard for the same reason.
    pub channel: &'static str,
    /// The agent answering, once the flow has reached an agent node. `None`
    /// while the flow is still walking — a call in its opening hours check has
    /// no agent yet, and naming one would be inventing it.
    pub agent: Option<String>,
    /// True once a person has been conferenced in. The AI stays on the line
    /// muted, so this is "a human is on this call", not "the AI has left".
    pub human: bool,
    /// A way into the live model session, for a supervisor's whisper.
    ///
    /// Whispering to a person is audio; whispering to a model is text, because
    /// audio pushed at it is transcribed as though the caller said it. So the
    /// AI half of "whisper" needs the *session*, not a channel — and the
    /// session lives inside a pipeline this registry is the only thing holding
    /// a handle to from outside.
    ///
    /// `None` on a relay: a cascading engine has no single session to steer,
    /// and the monitor route says so rather than silently doing nothing.
    pub steer: Option<Arc<crate::services::realtime::RealtimeControls>>,
    started: Instant,
}

impl LiveCall {
    pub fn seconds(&self) -> u64 {
        self.started.elapsed().as_secs()
    }
}

/// Every call in progress, keyed by the call's id.
#[derive(Clone)]
pub struct LiveCalls {
    inner: Arc<Mutex<HashMap<String, LiveCall>>>,
    /// Sent on after every change. Carries nothing: what changed is not the
    /// question a viewer is asking, and a snapshot cannot go stale the way a
    /// sequence of deltas can.
    changed: broadcast::Sender<()>,
}

impl Default for LiveCalls {
    fn default() -> Self {
        // Depth 16: a subscriber only needs to know that *something* moved, so
        // sixteen missed ticks and one are the same instruction — re-read. The
        // buffer exists to avoid waking on every frame of a burst, not to
        // preserve history.
        let (changed, _) = broadcast::channel(16);
        Self { inner: Arc::new(Mutex::new(HashMap::new())), changed }
    }
}

/// Holds one call's entry for as long as the call lasts.
///
/// Dropping it removes the entry, which is what makes an early return, a `?`
/// and a panic all correct without any of them having to remember.
pub struct LiveGuard {
    id: String,
    calls: LiveCalls,
}

impl Drop for LiveGuard {
    fn drop(&mut self) {
        if let Ok(mut map) = self.calls.inner.lock() {
            map.remove(&self.id);
        }
        self.calls.announce();
    }
}

impl LiveCalls {
    pub fn new() -> Self {
        Self::default()
    }

    /// Subscribe to "something changed".
    pub fn watch(&self) -> broadcast::Receiver<()> {
        self.changed.subscribe()
    }

    /// An error means nobody is listening, which is the normal state of a
    /// bridge with no dashboard open. It is not a failure and is not logged.
    fn announce(&self) {
        let _ = self.changed.send(());
    }

    pub fn register(&self, id: &str, call: LiveCall) -> LiveGuard {
        if let Ok(mut map) = self.inner.lock() {
            map.insert(id.to_string(), call);
        }
        self.announce();
        LiveGuard { id: id.to_string(), calls: self.clone() }
    }

    /// Fill in what was not known when the call was registered.
    ///
    /// A call is registered the moment it arrives, before its flow has been
    /// walked, because a call that dies during the walk is still a call that
    /// happened. The agent and the organisation are known a few lines later.
    pub fn attribute(&self, id: &str, org_id: Option<String>, agent: Option<String>) {
        if let Ok(mut map) = self.inner.lock() {
            if let Some(call) = map.get_mut(id) {
                if org_id.is_some() {
                    call.org_id = org_id;
                }
                if agent.is_some() {
                    call.agent = agent;
                }
            }
        }
        self.announce();
    }

    /// Hand the registry a way into this call's model session.
    ///
    /// Set once the pipeline is built, which is after the call is registered —
    /// the call goes on the books before anything can go wrong with it, and by
    /// then there is no session yet.
    pub fn set_steering(
        &self,
        id: &str,
        controls: Arc<crate::services::realtime::RealtimeControls>,
    ) {
        if let Ok(mut map) = self.inner.lock() {
            if let Some(call) = map.get_mut(id) {
                call.steer = Some(controls);
            }
        }
        // Deliberately no announcement: nothing on a dashboard changes, and a
        // frame per call for an invisible field is a frame for nothing.
    }

    /// The way into one call's model session, if it has one.
    pub fn steering(
        &self,
        id: &str,
    ) -> Option<Arc<crate::services::realtime::RealtimeControls>> {
        self.inner.lock().ok()?.get(id)?.steer.clone()
    }

    /// Whether a person is on this call.
    ///
    /// What decides whether a whisper is audio or text: a supervisor coaching a
    /// colleague speaks to them, and a supervisor coaching a model writes to it.
    pub fn has_human(&self, id: &str) -> bool {
        self.inner.lock().ok().and_then(|m| m.get(id).map(|c| c.human)).unwrap_or(false)
    }

    /// A person has joined this call.
    pub fn mark_human(&self, id: &str) {
        if let Ok(mut map) = self.inner.lock() {
            if let Some(call) = map.get_mut(id) {
                call.human = true;
            }
        }
        self.announce();
    }

    /// What one organisation may see.
    ///
    /// Filtered here rather than by the caller, so there is one place that
    /// decides whose calls these are. A call with no organisation appears to
    /// nobody: we do not know who it belongs to, and guessing would show one
    /// tenant another's caller id.
    pub fn snapshot(&self, org_id: &str) -> Vec<Value> {
        let Ok(map) = self.inner.lock() else { return Vec::new() };
        map.iter()
            .filter(|(_, call)| call.org_id.as_deref() == Some(org_id))
            .map(|(id, call)| {
                json!({
                    "id":      id,
                    "did":     call.did,
                    "caller":  call.caller,
                    "channel": call.channel,
                    "agent":   call.agent,
                    "human":   call.human,
                    "seconds": call.seconds(),
                })
            })
            .collect()
    }

    /// Every call in progress, whoever owns it. For the log line only.
    pub fn total(&self) -> usize {
        self.inner.lock().map(|map| map.len()).unwrap_or(0)
    }
}

/// Who is registered with Asterisk right now.
///
/// Held here rather than read on demand for the same reason the calls are: the
/// dashboard is pushed, and a stream that had to call ARI before it could emit
/// a frame would turn every viewer into a source of load on the switch that is
/// carrying the calls.
///
/// Refreshed when Asterisk says an endpoint moved, not on a clock. The event
/// carries no state — see `AriEvent::EndpointChanged` — so the refresh is a
/// single `GET /ari/endpoints`, and that read is what is true.
#[derive(Clone)]
pub struct Presence {
    inner: Arc<Mutex<HashMap<String, (bool, usize)>>>,
    changed: broadcast::Sender<()>,
}

impl Default for Presence {
    fn default() -> Self {
        let (changed, _) = broadcast::channel(16);
        Self { inner: Arc::new(Mutex::new(HashMap::new())), changed }
    }
}

impl Presence {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn watch(&self) -> broadcast::Receiver<()> {
        self.changed.subscribe()
    }

    /// Replace what is known with what Asterisk just said.
    ///
    /// A whole-list replace rather than a per-endpoint update: an endpoint that
    /// has disappeared from ARI's answer is one that no longer exists, and
    /// merging would leave it on the roster for ever.
    ///
    /// **Announces only when something actually differs.** Asterisk emits
    /// several events for one registration — `PeerStatusChange` and
    /// `ContactStatusChange` both fire — so refreshing on each of them would
    /// push three identical frames to every open dashboard for one person
    /// going on duty.
    pub fn replace(&self, rows: &[crate::vokoo::ari::Presence]) {
        let next: HashMap<String, (bool, usize)> =
            rows.iter().map(|p| (p.endpoint.clone(), (p.online, p.calls))).collect();
        let differs = match self.inner.lock() {
            Ok(mut map) => {
                if *map == next {
                    false
                } else {
                    *map = next;
                    true
                }
            }
            Err(_) => false,
        };
        if differs {
            let _ = self.changed.send(());
        }
    }

    /// What one endpoint is doing, as a word a screen can print.
    ///
    /// `offline` covers "not registered" and "Asterisk has never heard of this
    /// endpoint" together, because they are the same fact to somebody deciding
    /// whether a call can be handed over.
    pub fn state_of(&self, endpoint: &str) -> &'static str {
        let Ok(map) = self.inner.lock() else { return "offline" };
        match map.get(endpoint) {
            Some((true, calls)) if *calls > 0 => "on_call",
            Some((true, _)) => "online",
            _ => "offline",
        }
    }

    /// How many of these endpoints are on a call.
    pub fn on_call(&self, endpoints: &[String]) -> usize {
        endpoints.iter().filter(|e| self.state_of(e) == "on_call").count()
    }
}

/// A call at the moment it arrives, before anything has been resolved.
pub fn arriving(did: &str, caller: &str, channel: &'static str) -> LiveCall {
    LiveCall {
        org_id: None,
        did: did.to_string(),
        caller: caller.to_string(),
        channel,
        agent: None,
        human: false,
        steer: None,
        started: Instant::now(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dropped_guard_removes_the_call() {
        let calls = LiveCalls::new();
        {
            let _guard = calls.register("c1", arriving("918040802529", "+91999", "kookoo"));
            assert_eq!(calls.total(), 1);
        }
        // The whole point: no code path has to remember to do this.
        assert_eq!(calls.total(), 0);
    }

    #[test]
    fn a_call_with_no_organisation_is_shown_to_nobody() {
        let calls = LiveCalls::new();
        let _guard = calls.register("c2", arriving("918040802529", "+91999", "kookoo"));
        assert!(calls.snapshot("org-a").is_empty());
        assert_eq!(calls.total(), 1, "it is live, it is just not attributable");
    }

    #[test]
    fn one_organisation_cannot_see_anothers_calls() {
        let calls = LiveCalls::new();
        let _a = calls.register("c3", arriving("d1", "+91111", "kookoo"));
        let _b = calls.register("c4", arriving("d2", "+92222", "whatsapp"));
        calls.attribute("c3", Some("org-a".into()), Some("Reception".into()));
        calls.attribute("c4", Some("org-b".into()), None);

        let seen = calls.snapshot("org-a");
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0]["caller"], "+91111");
        assert_eq!(seen[0]["agent"], "Reception");
    }

    #[test]
    fn attributing_never_clears_what_is_already_known() {
        // Called more than once as a call progresses: the flow resolves the
        // organisation, the agent node arrives later. The second call must not
        // wipe the first.
        let calls = LiveCalls::new();
        let _guard = calls.register("c5", arriving("d", "+91", "kookoo"));
        calls.attribute("c5", Some("org-a".into()), None);
        calls.attribute("c5", None, Some("Reception".into()));

        let seen = calls.snapshot("org-a");
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0]["agent"], "Reception");
    }

    #[tokio::test]
    async fn every_change_wakes_a_watcher() {
        // The whole argument for SSE: a viewer is told, rather than asking.
        let calls = LiveCalls::new();
        let mut watch = calls.watch();
        let guard = calls.register("c7", arriving("d", "+91", "kookoo"));
        assert!(watch.try_recv().is_ok(), "a call starting");
        calls.attribute("c7", Some("org-a".into()), None);
        assert!(watch.try_recv().is_ok(), "a call being attributed");
        calls.mark_human("c7");
        assert!(watch.try_recv().is_ok(), "a human joining");
        drop(guard);
        assert!(watch.try_recv().is_ok(), "a call ending");
        assert!(watch.try_recv().is_err(), "and nothing else");
    }

    fn seen(endpoint: &str, online: bool, calls: usize) -> crate::vokoo::ari::Presence {
        crate::vokoo::ari::Presence { endpoint: endpoint.into(), online, calls }
    }

    #[test]
    fn presence_has_three_states() {
        let presence = Presence::new();
        presence.replace(&[seen("vayuveda-4001", true, 0), seen("vayuveda-4002", true, 1)]);
        assert_eq!(presence.state_of("vayuveda-4001"), "online");
        assert_eq!(presence.state_of("vayuveda-4002"), "on_call");
        // Never heard of and not registered are the same thing to somebody
        // deciding whether a call can be handed over.
        assert_eq!(presence.state_of("vayuveda-4003"), "offline");
    }

    #[tokio::test]
    async fn an_unchanged_refresh_says_nothing() {
        // Asterisk emits PeerStatusChange *and* ContactStatusChange for one
        // registration. Announcing on each would push identical frames to every
        // open dashboard for one person going on duty.
        let presence = Presence::new();
        let mut watch = presence.watch();
        presence.replace(&[seen("vayuveda-4001", true, 0)]);
        assert!(watch.try_recv().is_ok());
        presence.replace(&[seen("vayuveda-4001", true, 0)]);
        assert!(watch.try_recv().is_err(), "nothing moved");
        presence.replace(&[seen("vayuveda-4001", true, 1)]);
        assert!(watch.try_recv().is_ok(), "they answered a call");
    }

    #[test]
    fn an_endpoint_that_vanishes_leaves_the_roster() {
        let presence = Presence::new();
        presence.replace(&[seen("vayuveda-4001", true, 0)]);
        presence.replace(&[]);
        assert_eq!(presence.state_of("vayuveda-4001"), "offline");
    }

    #[test]
    fn a_human_joining_is_recorded() {
        let calls = LiveCalls::new();
        let _guard = calls.register("c6", arriving("d", "+91", "kookoo"));
        calls.attribute("c6", Some("org-a".into()), None);
        assert_eq!(calls.snapshot("org-a")[0]["human"], false);
        calls.mark_human("c6");
        assert_eq!(calls.snapshot("org-a")[0]["human"], true);
    }
}
