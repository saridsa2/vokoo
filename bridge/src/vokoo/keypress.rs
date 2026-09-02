//! What the caller pressed, remembered across the webhooks of one call.
//!
//! `<collectdtmf>` is answered *between* streams: the carrier takes our XML,
//! plays the prompt, collects a key, and comes back on a **new HTTP request**.
//! Nothing survives that on its own — not the runner, not its position in the
//! graph — so a menu's answer has to be written down somewhere keyed by the
//! call.
//!
//! Read rather than taken, which is the difference from [`Handovers`]. A
//! handover happens once and must not happen twice. A keypress is consulted
//! every time the flow is walked, and the flow is walked at least twice: once
//! on the webhook that decides what XML to return, and again in the WebSocket
//! handler that builds the pipeline. Removing it on the first read would send
//! the second walk back to the menu, and the caller would be asked to choose a
//! language by an agent that had already connected in one.
//!
//! Cleared when the call ends. A process that answers phones for weeks must not
//! accumulate one entry per call it has ever taken.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Long enough for a caller who wanders off mid-menu and comes back, short
/// enough that a forgotten call does not hold its answers for the life of the
/// process.
const TTL: Duration = Duration::from_secs(3600);

/// What one call has been asked and has answered.
#[derive(Clone, Default)]
struct CallKeys {
    /// Node id -> the key pressed there.
    answers: HashMap<String, String>,
    /// The menu currently waiting on an answer.
    ///
    /// Needed because **the carrier does not give the node back**. We point
    /// `<collectdtmf>` at a URL carrying our own marker; KooKoo posts to the
    /// bare URL and discards the query string, so the callback says only
    /// `event=GotDTMF`, `sid` and `data`. Measured on a real call on
    /// 1 September — the first version matched on the marker, never fired,
    /// fell through to the unknown-event arm, and answered with a bare 200.
    /// The carrier hung up on the caller ten seconds in.
    asked: Option<String>,
}

/// Keys pressed, per call, per node that asked.
#[derive(Clone, Default)]
pub struct Keypresses {
    pending: Arc<Mutex<HashMap<String, (CallKeys, Instant)>>>,
}

impl Keypresses {
    pub fn new() -> Self {
        Self::default()
    }

    /// Note that this node's question has been answered.
    pub fn record(&self, ucid: &str, node_id: &str, digit: &str) {
        let mut map = self.lock();
        map.retain(|_, (_, at)| at.elapsed() < TTL);
        let entry = map.entry(ucid.to_string()).or_insert_with(|| (CallKeys::default(), Instant::now()));
        entry.0.answers.insert(node_id.to_string(), digit.to_string());
        // Answered, so no longer outstanding. A second callback for the same
        // menu — the carrier repeating itself — must not be read as an answer
        // to whatever menu comes next.
        if entry.0.asked.as_deref() == Some(node_id) {
            entry.0.asked = None;
        }
        entry.1 = Instant::now();
    }

    /// Note which menu this call is waiting on.
    pub fn asking(&self, ucid: &str, node_id: &str) {
        let mut map = self.lock();
        map.retain(|_, (_, at)| at.elapsed() < TTL);
        let entry = map.entry(ucid.to_string()).or_insert_with(|| (CallKeys::default(), Instant::now()));
        entry.0.asked = Some(node_id.to_string());
        entry.1 = Instant::now();
    }

    /// The menu this call was last asked, if it has not answered yet.
    pub fn awaiting(&self, ucid: &str) -> Option<String> {
        self.lock().get(ucid).and_then(|(keys, _)| keys.asked.clone())
    }

    /// Every answer this call has given so far.
    ///
    /// The runner takes this whole map rather than asking node by node, because
    /// it walks from the top every time and must pass each menu it has already
    /// been through without stopping.
    pub fn all(&self, ucid: &str) -> HashMap<String, String> {
        let mut map = self.lock();
        map.retain(|_, (_, at)| at.elapsed() < TTL);
        map.get(ucid).map(|(keys, _)| keys.answers.clone()).unwrap_or_default()
    }

    /// The call is over.
    pub fn forget(&self, ucid: &str) {
        self.lock().remove(ucid);
    }

    /// A poisoned lock here would mean a panic while holding it. The map is a
    /// cache of what a caller pressed; carrying on with it is better than
    /// taking the process down and dropping every call in progress.
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, (CallKeys, Instant)>> {
        self.pending.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_survive_being_read() {
        let keys = Keypresses::new();
        keys.record("call-1", "menu", "2");
        assert_eq!(keys.all("call-1").get("menu").map(String::as_str), Some("2"));
        // The second walk must see it too, or the caller is asked twice.
        assert_eq!(keys.all("call-1").get("menu").map(String::as_str), Some("2"));
    }

    #[test]
    fn calls_do_not_see_each_other() {
        let keys = Keypresses::new();
        keys.record("call-1", "menu", "1");
        keys.record("call-2", "menu", "3");
        assert_eq!(keys.all("call-1").get("menu").map(String::as_str), Some("1"));
        assert_eq!(keys.all("call-2").get("menu").map(String::as_str), Some("3"));
    }

    #[test]
    fn two_menus_in_one_call_are_kept_apart() {
        let keys = Keypresses::new();
        keys.record("call-1", "language", "2");
        keys.record("call-1", "department", "4");
        let all = keys.all("call-1");
        assert_eq!(all.get("language").map(String::as_str), Some("2"));
        assert_eq!(all.get("department").map(String::as_str), Some("4"));
    }

    #[test]
    fn the_outstanding_menu_is_remembered_and_then_cleared() {
        // The carrier does not hand the node back, so this is the only way to
        // know which menu a bare `GotDTMF` is answering.
        let keys = Keypresses::new();
        assert_eq!(keys.awaiting("call-1"), None);
        keys.asking("call-1", "n_lang");
        assert_eq!(keys.awaiting("call-1").as_deref(), Some("n_lang"));
        keys.record("call-1", "n_lang", "2");
        assert_eq!(keys.awaiting("call-1"), None, "a repeat callback must not answer the next menu");
        assert_eq!(keys.all("call-1").get("n_lang").map(String::as_str), Some("2"));
    }

    #[test]
    fn forgetting_a_call_leaves_the_others() {
        let keys = Keypresses::new();
        keys.record("call-1", "menu", "1");
        keys.record("call-2", "menu", "2");
        keys.forget("call-1");
        assert!(keys.all("call-1").is_empty());
        assert_eq!(keys.all("call-2").get("menu").map(String::as_str), Some("2"));
    }
}
