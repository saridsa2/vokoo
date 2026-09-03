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
    /// The channel currently answering — the AI now, a human after escalation.
    agent: Option<String>,
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
        }
        call
    }

    /// How many calls are currently bridged. For logging and metrics.
    pub async fn len(&self) -> usize {
        self.inner.lock().await.len()
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
) -> Result<(), String> {
    let url = ari.events_url(APP);
    let (stream, _) = tokio_tungstenite::connect_async(&url)
        .await
        .map_err(|e| format!("ari events: {e}"))?;
    log::info!("[stasis] {APP} connected");

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
            AriEvent::Other(_) => {}
        }
    }

    Err("ari event stream closed".into())
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
        "inbound" => {
            let Some(uuid) = args.get(1).filter(|u| !u.is_empty()) else {
                log::warn!("[stasis] inbound channel {channel} carries no uuid — hanging up");
                ari.hangup(channel).await;
                return;
            };

            let bridge = match ari.create_bridge().await {
                Ok(b) => b,
                Err(e) => {
                    log::error!("[stasis] no bridge for {uuid}: {e}");
                    ari.hangup(channel).await;
                    return;
                }
            };

            board
                .insert(uuid, Switched { bridge: bridge.clone(), caller: channel.to_string(), agent: None })
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
            match ari.originate_audiosocket(audiosocket, uuid, APP, &args, None).await {
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
    } else {
        // The agent leg ended. Today that means the pipeline finished, so the
        // call is over too. When escalation exists this is the moment a human
        // would be dialled instead.
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
            .insert("u1", Switched { bridge: "b1".into(), caller: "caller-1".into(), agent: None })
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
            .insert("u2", Switched { bridge: "b2".into(), caller: "c2".into(), agent: None })
            .await;
        board.set_agent("u2", "a2").await;

        assert_eq!(board.len().await, 1);
        board.remove("u2").await;
        assert_eq!(board.len().await, 0);
        assert!(board.uuid_for("c2").await.is_none());
        assert!(board.uuid_for("a2").await.is_none());
    }

    #[tokio::test]
    async fn an_unknown_channel_resolves_to_nothing() {
        let board = Switchboard::new();
        assert!(board.uuid_for("never-seen").await.is_none());
    }
}
