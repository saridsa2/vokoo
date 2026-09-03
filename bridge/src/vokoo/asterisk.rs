//! What Asterisk tells us about a call, before the audio for it arrives.
//!
//! AudioSocket carries a uuid and nothing else — no called number, no caller,
//! no channel. So the dialplan announces the call over HTTP first, and this
//! holds what it said until the socket for that uuid connects.
//!
//! The gap between the two is a `CURL()` and an `AudioSocket()` on consecutive
//! dialplan lines: milliseconds. Everything here is shaped by that. There is no
//! background sweeper and no database — an announcement is a note that lives
//! for a minute, and a process restart losing it costs one call rather than
//! needing recovery.
//!
//! Why announce at all, rather than putting the number in the uuid: the uuid is
//! 16 bytes and a call has a called number, a caller, a channel and a WhatsApp
//! conversation id. Encoding those into a uuid would be a private format that
//! Asterisk's own logs could not read.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How long an announcement is worth keeping.
///
/// Generous against a dialplan gap measured in milliseconds. Its job is not to
/// bound latency but to stop a call that announced and then failed to connect —
/// a hangup between the two lines — from sitting in the map forever.
const ANNOUNCEMENT_TTL: Duration = Duration::from_secs(60);

/// A call Asterisk has answered and is about to stream to us.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingCall {
    /// What the dialplan will dial the AudioSocket with.
    pub uuid: String,
    /// The number that was called. Resolves a flow exactly as a DID does.
    pub did: String,
    /// The caller. On WhatsApp this is a phone number, same as a PSTN call.
    pub caller: String,
    /// Which way the call arrived — `whatsapp`, or a test.
    pub channel: String,
    /// WhatsApp's own conversation id, from the `x-wa-meta-wacid` header. Kept
    /// because it is how a call is found in Meta's tooling, and there is no way
    /// to derive it later.
    pub wacid: Option<String>,
    /// The carrier's own id for the call, when this leg only *represents* one.
    ///
    /// On a KooKoo pivot the leg carries a uuid we minted — `chan_audiosocket`
    /// insists on a real UUID and a ucid is a decimal integer — but everything
    /// downstream must still use KooKoo's ucid: it is what `kookoo.hangup`
    /// sends KICK_CALL for, what the call record is filed under, and what a
    /// post-call flow resolves. Filing the call under the leg's uuid meant
    /// saying goodbye and leaving the caller connected.
    pub carrier_call_id: Option<String>,
}

#[derive(Clone)]
struct Announcement {
    call: PendingCall,
    at: Instant,
}

/// Announcements waiting for their socket.
///
/// Cloned into the HTTP handler and the AudioSocket listener; both share one
/// map. A `std::sync::Mutex` rather than tokio's because nothing is held across
/// an await — the critical section is a hash lookup.
#[derive(Clone, Default)]
pub struct PendingCalls {
    inner: Arc<Mutex<HashMap<String, Announcement>>>,
}

impl PendingCalls {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a call the dialplan is about to connect.
    ///
    /// Sweeps on the way in. A map that is only written when a call arrives
    /// needs no timer to stay small, and a timer would be a task to supervise.
    pub fn announce(&self, call: PendingCall) {
        let mut map = self.inner.lock().unwrap();
        let now = Instant::now();
        map.retain(|_, a| now.duration_since(a.at) < ANNOUNCEMENT_TTL);
        map.insert(call.uuid.clone(), Announcement { call, at: now });
    }

    /// Claim the announcement for a uuid.
    ///
    /// Taken, not read: one announcement belongs to one socket. A second
    /// connection presenting the same uuid gets nothing and is refused, which
    /// is what should happen — the uuid is the call's only credential.
    pub fn claim(&self, uuid: &str) -> Option<PendingCall> {
        let mut map = self.inner.lock().unwrap();
        let announcement = map.remove(uuid)?;
        if Instant::now().duration_since(announcement.at) >= ANNOUNCEMENT_TTL {
            return None;
        }
        Some(announcement.call)
    }

    /// How many announcements are waiting. For logging and tests.
    pub fn len(&self) -> usize {
        self.inner.lock().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(uuid: &str) -> PendingCall {
        PendingCall {
            uuid: uuid.into(),
            did: "916309248884".into(),
            caller: "919704665032".into(),
            channel: "whatsapp".into(),
            wacid: Some("wacid-1".into()),
            carrier_call_id: None,
        }
    }

    #[test]
    fn an_announced_call_is_found_by_its_uuid() {
        let calls = PendingCalls::new();
        calls.announce(call("abc"));
        assert_eq!(calls.claim("abc"), Some(call("abc")));
    }

    #[test]
    fn a_uuid_is_good_for_one_socket() {
        // The uuid is the call's only credential. Handing the same one to a
        // second connection would put two sockets on one call.
        let calls = PendingCalls::new();
        calls.announce(call("abc"));
        assert!(calls.claim("abc").is_some());
        assert!(calls.claim("abc").is_none());
    }

    #[test]
    fn a_uuid_nobody_announced_is_not_a_call() {
        let calls = PendingCalls::new();
        assert!(calls.claim("never-announced").is_none());
    }

    #[test]
    fn announcements_that_never_connected_do_not_accumulate() {
        // A hangup between the CURL and the AudioSocket leaves one behind. On a
        // busy line that is a leak measured in years of uptime, so the sweep is
        // on the write path rather than in a task somebody has to supervise.
        let calls = PendingCalls::new();
        {
            let mut map = calls.inner.lock().unwrap();
            map.insert(
                "stale".into(),
                Announcement { call: call("stale"), at: Instant::now() - ANNOUNCEMENT_TTL * 2 },
            );
        }
        assert_eq!(calls.len(), 1);

        calls.announce(call("fresh"));
        assert_eq!(calls.len(), 1, "the stale one went out with the sweep");
        assert!(calls.claim("fresh").is_some());
    }

    #[test]
    fn an_expired_announcement_is_not_claimable() {
        let calls = PendingCalls::new();
        {
            let mut map = calls.inner.lock().unwrap();
            map.insert(
                "old".into(),
                Announcement { call: call("old"), at: Instant::now() - ANNOUNCEMENT_TTL * 2 },
            );
        }
        assert!(calls.claim("old").is_none(), "too old to belong to this socket");
    }
}
