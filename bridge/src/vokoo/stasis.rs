//! The switch: a caller on one leg, whatever is answering them on another.
//!
//! Asterisk hands a call into this application and it builds the other side —
//! today an AudioSocket back to our own pipeline, tomorrow a human on a WebRTC
//! softphone. Both are channels in a mixing bridge, so the difference between
//! "the AI is talking to them" and "a person is talking to them" is which
//! channel is in the bridge, and nothing else.
//!
//! ```text
//!   caller (PJSIP from Meta)  ──┐
//!                               ├── mixing bridge
//!   agent  (AudioSocket → us) ──┘
//! ```
//!
//! ## Why route a working path through here at all
//!
//! A WhatsApp call reaches the pipeline today without any of this. What it
//! cannot do is hand the caller to a person: `kookoo.transfer` posts to a
//! carrier that has never heard of the call. Once both sides are Asterisk
//! channels, escalation is `removeChannel` then `addChannel`, the caller is
//! never re-dialled, and ChanSpy gives supervision for free.
//!
//! ## The uuid does double duty, on purpose
//!
//! The dialplan generates one uuid, announces the call under it, and passes it
//! into this application. The agent leg is then originated as
//! `AudioSocket/host:port/<that uuid>`, so when Asterisk connects back to our
//! AudioSocket server the first frame already identifies which call it belongs
//! to. `PendingCalls` matches it exactly as it does today — no second registry,
//! and no new correlation to get wrong.

use std::collections::HashMap;
use std::sync::Arc;

use futures::StreamExt;
use tokio::sync::Mutex;

use super::ari::{Ari, AriEvent, parse_event};

/// What the dialplan calls this application.
pub const APP: &str = "sarvathra";

/// One call being switched.
#[derive(Clone, Debug)]
struct Switched {
    bridge: String,
    caller: String,
    /// The AI's leg. It stays for the whole call, muted after a handover.
    agent: Option<String>,
    /// A person who has joined. `None` until an escalation.
    human: Option<String>,
    /// A handover has been decided but the person has not arrived yet.
    ///
    /// **This exists to close a race that ended every escalation.**
    /// `finish_call(wants_human)` makes the pipeline wind down, so the AI leg's
    /// `StasisEnd` arrives *before* the human has been originated — and
    /// `on_end` read that as the agent leaving and hung up the caller. The
    /// person's phone was ringing into a bridge already being destroyed.
    escalating: bool,
}

/// Calls this application is holding, keyed by the uuid the dialplan minted.
#[derive(Clone, Default)]
pub struct Switchboard {
    inner: Arc<Mutex<HashMap<String, Switched>>>,
    /// Channel id → uuid, so a hangup event can find its call.
    by_channel: Arc<Mutex<HashMap<String, String>>>,
}

impl Switchboard {
    pub fn new() -> Self {
        Self::default()
    }

    async fn insert(&self, uuid: &str, call: Switched) {
        self.by_channel.lock().await.insert(call.caller.clone(), uuid.to_string());
        self.inner.lock().await.insert(uuid.to_string(), call);
    }

    async fn uuid_for(&self, channel: &str) -> Option<String> {
        self.by_channel.lock().await.get(channel).cloned()
    }

    async fn get(&self, uuid: &str) -> Option<Switched> {
        self.inner.lock().await.get(uuid).cloned()
    }

    /// Say that a person is being fetched, before fetching them.
    ///
    /// Called the moment the outcome arrives rather than when the originate
    /// starts, because the AI leg can end in between.
    pub async fn mark_escalating(&self, uuid: &str) {
        if let Some(call) = self.inner.lock().await.get_mut(uuid) {
            call.escalating = true;
        }
    }

    /// Stop associating a channel with its call.
    ///
    /// For a leg whose ending is expected — the AI's recorder stopping while
    /// two people carry on talking. Without this its `StasisEnd` would be read
    /// as the conversation ending and hang up both of them.
    async fn forget_channel(&self, channel: &str) {
        self.by_channel.lock().await.remove(channel);
    }

    /// Record a person who has joined, without displacing the AI.
    async fn add_human(&self, uuid: &str, channel: &str) {
        if let Some(call) = self.inner.lock().await.get_mut(uuid) {
            call.human = Some(channel.to_string());
        }
        self.by_channel.lock().await.insert(channel.to_string(), uuid.to_string());
    }

    async fn set_agent(&self, uuid: &str, channel: &str) {
        if let Some(call) = self.inner.lock().await.get_mut(uuid) {
            call.agent = Some(channel.to_string());
        }
        self.by_channel.lock().await.insert(channel.to_string(), uuid.to_string());
    }

    async fn remove(&self, uuid: &str) -> Option<Switched> {
        let call = self.inner.lock().await.remove(uuid);
        if let Some(c) = &call {
            let mut by = self.by_channel.lock().await;
            by.remove(&c.caller);
            if let Some(a) = &c.agent {
                by.remove(a);
            }
            if let Some(h) = &c.human {
                by.remove(h);
            }
        }
        call
    }

    /// How many calls are currently bridged. For logging and metrics.
    pub async fn len(&self) -> usize {
        self.inner.lock().await.len()
    }
}

impl Switchboard {
    /// Bring a person into the call.
    ///
    /// **A conference, not a transfer.** The caller stays in the bridge they
    /// have been in since the call began, the person joins it, and the AI stays
    /// too — muted, but still hearing both of them. That is what keeps the
    /// transcript, the tools and the post-call reading working across a
    /// handover: the part of a call a human takes is the part most worth
    /// writing down, and a leg that is removed takes the record with it.
    ///
    /// The AI is not hung up at all, which also means a person who never
    /// answers costs nothing — the caller still has somebody talking, and the
    /// flow carries on as though the escalation had not happened.
    pub async fn escalate(
        &self,
        ari: &Ari,
        uuid: &str,
        endpoint: &str,
        caller_id: Option<&str>,
    ) -> Result<String, String> {
        // Existence check only — the bridge is not touched here.
        self.get(uuid).await.ok_or("no such call")?;

        let args = format!("agent,{uuid}");
        let human = ari
            .originate_endpoint(endpoint, APP, &args, caller_id)
            .await
            .map_err(|e| format!("no human leg: {e}"))?;

        // The AI stays, and is muted by the bridge rather than removed here —
        // see `AudioSocketTransport::mute`. A leg that is removed takes the
        // record with it, and the part of a call a person handles is the part
        // most worth writing down.
        //
        // Recorded as the *human*, not by overwriting `agent`: when they hang
        // up, `on_end` has to be able to tell which of the three legs left.
        // Overwriting meant `call.human` stayed None, the hangup fell through
        // to the wrong branch, and the caller sat in silence until a timeout.
        self.add_human(uuid, &human).await;
        log::info!("[stasis] {uuid} — escalated to {endpoint} on {human}");
        Ok(human)
    }
}

/// Run the application until the event stream drops, then say so.
///
/// The caller is expected to keep calling this — Asterisk restarting, or the
/// WebSocket closing, must not leave the switch silently dead for the rest of
/// the process's life.
pub async fn run(
    ari: Ari,
    board: Switchboard,
    audiosocket: String,
    presence: crate::vokoo::live::Presence,
) -> Result<(), String> {
    let url = ari.events_url(APP);
    let (stream, _) = tokio_tungstenite::connect_async(&url)
        .await
        .map_err(|e| format!("ari events: {e}"))?;
    log::info!("[stasis] {APP} connected");

    // Read the roster once on connect, before waiting for anything to change.
    // Without it a bridge that started while everybody was already on duty
    // would show an empty roster until somebody happened to move — and this
    // runs again on every reconnect, which is exactly when what Asterisk
    // believes and what we remember are most likely to have diverged.
    refresh_presence(&ari, &presence).await;

    let (_write, mut read) = stream.split();
    while let Some(message) = read.next().await {
        let text = match message {
            Ok(tokio_tungstenite::tungstenite::Message::Text(t)) => t.to_string(),
            Ok(tokio_tungstenite::tungstenite::Message::Close(_)) | Err(_) => break,
            Ok(_) => continue,
        };

        match parse_event(&text) {
            AriEvent::StasisStart { channel_id, args } => {
                let ari = ari.clone();
                let board = board.clone();
                let audiosocket = audiosocket.clone();
                // Spawned: originating the agent leg is two round trips to
                // Asterisk, and blocking the event loop on it would delay
                // every other call's events behind this one.
                tokio::spawn(async move {
                    on_start(&ari, &board, &audiosocket, &channel_id, &args).await;
                });
            }
            AriEvent::StasisEnd { channel_id } => {
                let ari = ari.clone();
                let board = board.clone();
                tokio::spawn(async move {
                    on_end(&ari, &board, &channel_id).await;
                });
            }
            AriEvent::EndpointChanged => {
                let ari = ari.clone();
                let presence = presence.clone();
                // Spawned for the same reason a StasisStart is: a round trip to
                // Asterisk must not sit in front of another call's events.
                tokio::spawn(async move {
                    refresh_presence(&ari, &presence).await;
                });
            }
            AriEvent::Other(_) => {}
        }
    }

    Err("ari event stream closed".into())
}

/// Ask Asterisk who is registered, and tell anyone watching if it has changed.
///
/// A failure leaves the last known roster standing rather than emptying it.
/// Reporting everybody offline because one HTTP call failed would say the
/// switch has nobody on it, which is a worse answer than a few seconds stale.
async fn refresh_presence(ari: &Ari, presence: &crate::vokoo::live::Presence) {
    match ari.endpoints().await {
        Ok(rows) => presence.replace(&rows),
        Err(problem) => log::warn!("[stasis] could not read endpoints: {problem}"),
    }
}

async fn on_start(
    ari: &Ari,
    board: &Switchboard,
    audiosocket: &str,
    channel: &str,
    args: &[String],
) {
    let role = args.first().map(String::as_str).unwrap_or("");
    match role {
        // The caller. Build them a bridge and something to talk to.
        //
        // Two uuids, and they must differ. `uuid` names the call; `agent_uuid`
        // names the leg we are about to originate. On a KooKoo pivot BOTH legs
        // are AudioSocket connections, so one id for both means the caller's
        // relay claims it and the agent arrives to find nothing — which is
        // exactly what happened the first time this ran.
        "inbound" => {
            let Some(uuid) = args.get(1).filter(|u| !u.is_empty()) else {
                log::warn!("[stasis] inbound channel {channel} carries no uuid — hanging up");
                ari.hangup(channel).await;
                return;
            };
            let agent_uuid = args
                .get(2)
                .filter(|u| !u.is_empty())
                .cloned()
                .unwrap_or_else(|| uuid.clone());

            let bridge = match ari.create_bridge().await {
                Ok(b) => b,
                Err(e) => {
                    log::error!("[stasis] no bridge for {uuid}: {e}");
                    ari.hangup(channel).await;
                    return;
                }
            };

            board
                .insert(uuid, Switched {
                    bridge: bridge.clone(),
                    caller: channel.to_string(),
                    agent: None,
                    human: None,
                    escalating: false,
                })
                .await;

            if let Err(e) = ari.add_to_bridge(&bridge, &[channel]).await {
                log::error!("[stasis] caller {channel} did not enter the bridge: {e}");
                ari.hangup(channel).await;
                ari.destroy_bridge(&bridge).await;
                board.remove(uuid).await;
                return;
            }

            // The AI, as a channel. Originated with the same uuid the call was
            // announced under, so our AudioSocket server matches it to the
            // pending call without a second registry.
            let args = format!("agent,{uuid}");
            match ari.originate_audiosocket(audiosocket, &agent_uuid, APP, &args, None).await {
                Ok(agent) => {
                    log::info!("[stasis] {uuid} — caller {channel} bridged, agent {agent} dialing");
                    board.set_agent(uuid, &agent).await;
                }
                Err(e) => {
                    // Nothing is going to answer this caller. Ending the call
                    // is kinder than leaving them in a bridge with silence.
                    log::error!("[stasis] {uuid} — no agent leg: {e}");
                    ari.hangup(channel).await;
                    ari.destroy_bridge(&bridge).await;
                    board.remove(uuid).await;
                }
            }
        }

        // The thing answering. It was originated by us, so its bridge is known.
        "agent" => {
            let Some(uuid) = args.get(1) else {
                log::warn!("[stasis] agent channel {channel} carries no uuid");
                ari.hangup(channel).await;
                return;
            };
            let Some(call) = board.get(uuid).await else {
                // The caller hung up between originate and answer. Common, and
                // not worth a warning.
                log::debug!("[stasis] {uuid} — agent arrived after the call ended");
                ari.hangup(channel).await;
                return;
            };
            if let Err(e) = ari.add_to_bridge(&call.bridge, &[channel]).await {
                log::error!("[stasis] agent {channel} did not enter {}: {e}", call.bridge);
                ari.hangup(channel).await;
                return;
            }
            log::info!("[stasis] {uuid} — agent {channel} in the bridge, {} call(s) up", board.len().await);
        }

        other => {
            log::warn!("[stasis] channel {channel} entered with role '{other}' — hanging up");
            ari.hangup(channel).await;
        }
    }
}

/// A leg left. If it was the caller the call is over; if it was the agent, the
/// caller is left in a bridge on their own, which is where an escalation would
/// put a human instead.
async fn on_end(ari: &Ari, board: &Switchboard, channel: &str) {
    let Some(uuid) = board.uuid_for(channel).await else { return };
    let Some(call) = board.get(&uuid).await else { return };

    if call.caller == channel {
        log::info!("[stasis] {uuid} — caller gone, tearing down");
        if let Some(agent) = &call.agent {
            ari.hangup(agent).await;
        }
        ari.destroy_bridge(&call.bridge).await;
        board.remove(&uuid).await;
    } else if call.human.as_deref() == Some(channel) {
        // The person hung up. The caller is still there with the AI, which is
        // muted — so the call would go silent. Ending it is the honest
        // outcome; leaving somebody listening to nothing is not.
        log::info!("[stasis] {uuid} — the person left, ending the call");
        ari.hangup(&call.caller).await;
        if let Some(ai) = &call.agent {
            ari.hangup(ai).await;
        }
        ari.destroy_bridge(&call.bridge).await;
        board.remove(&uuid).await;
    } else if call.human.is_some() || call.escalating {
        // The AI's leg ended while a person is on the call, or on their way.
        // That is the recorder stopping, not the conversation — and during an
        // escalation it is expected, because `finish_call` winds the pipeline
        // down before the person has answered.
        log::info!("[stasis] {uuid} — the AI leg ended; a person is on the call or joining");
        board.forget_channel(channel).await;
    } else {
        log::info!("[stasis] {uuid} — agent gone, ending the call");
        ari.hangup(&call.caller).await;
        ari.destroy_bridge(&call.bridge).await;
        board.remove(&uuid).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_call_is_found_by_either_of_its_legs() {
        // A hangup event names a channel, not a call. Both legs have to resolve
        // back to the same uuid or a teardown finds nothing and leaks a bridge.
        let board = Switchboard::new();
        board
            .insert("u1", Switched { bridge: "b1".into(), caller: "caller-1".into(), agent: None, human: None, escalating: false })
            .await;
        board.set_agent("u1", "agent-1").await;

        assert_eq!(board.uuid_for("caller-1").await.as_deref(), Some("u1"));
        assert_eq!(board.uuid_for("agent-1").await.as_deref(), Some("u1"));
        assert_eq!(board.get("u1").await.unwrap().agent.as_deref(), Some("agent-1"));
    }

    #[tokio::test]
    async fn removing_a_call_forgets_both_channels() {
        // Otherwise the channel map grows for the life of the process, which is
        // the leak this project already fixed once in PendingCalls.
        let board = Switchboard::new();
        board
            .insert("u2", Switched { bridge: "b2".into(), caller: "c2".into(), agent: None, human: None, escalating: false })
            .await;
        board.set_agent("u2", "a2").await;

        assert_eq!(board.len().await, 1);
        board.remove("u2").await;
        assert_eq!(board.len().await, 0);
        assert!(board.uuid_for("c2").await.is_none());
        assert!(board.uuid_for("a2").await.is_none());
    }

    #[tokio::test]
    async fn a_conference_holds_three_legs() {
        // After a handover the call has a caller, a muted AI and a person, and
        // all three must resolve back to it — a leg the switchboard cannot name
        // is a leg whose hangup is either ignored or mistaken for the end.
        let board = Switchboard::new();
        board
            .insert("u3", Switched { bridge: "b3".into(), caller: "c3".into(), agent: None, human: None, escalating: false })
            .await;
        board.set_agent("u3", "ai-3").await;
        board.add_human("u3", "human-3").await;

        let call = board.get("u3").await.unwrap();
        assert_eq!(call.agent.as_deref(), Some("ai-3"), "the AI stays after a handover");
        assert_eq!(call.human.as_deref(), Some("human-3"));
        for channel in ["c3", "ai-3", "human-3"] {
            assert_eq!(board.uuid_for(channel).await.as_deref(), Some("u3"), "{channel}");
        }

        board.remove("u3").await;
        for channel in ["c3", "ai-3", "human-3"] {
            assert!(board.uuid_for(channel).await.is_none(), "{channel} forgotten");
        }
    }

    #[tokio::test]
    async fn an_unknown_channel_resolves_to_nothing() {
        let board = Switchboard::new();
        assert!(board.uuid_for("never-seen").await.is_none());
    }
}
