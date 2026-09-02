//! What to do with a call once our stream ends.
//!
//! KooKoo sends `event=Stream` to the IVR webhook when the media socket closes,
//! and — this is the part that is easy to miss — *the call is still up*. The
//! XML returned there decides what happens to the caller next. Answering it with
//! a goodbye, which is what the reference SDK does by default and what this
//! bridge inherited, hangs up at the one moment a transfer is possible.
//!
//! So a flow that wants to hand the caller to a person records that intention
//! here, ends the conversation, and the webhook reads it back. The two halves
//! run in different tasks with no shared call state — the socket has closed by
//! then — so the `ucid` is the only thing joining them, which is exactly what it
//! is for.
//!
//! Not a REST call to the carrier: nothing is sent when a transfer is queued.
//! The carrier asks us, and we answer.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How long a queued handover stays valid.
///
/// The webhook normally arrives within a second of the socket closing. Anything
/// still sitting here much later belongs to a call that ended some other way,
/// and dialling a number for it would ring somebody about a conversation that
/// is long over.
const TTL: Duration = Duration::from_secs(60);

/// What the flow wants to happen after the stream.
#[derive(Debug, Clone)]
pub enum Handover {
    /// Dial this number and bridge the caller to it.
    ///
    /// `on_no_answer` is what the caller hears if nobody picks up. It is
    /// decided here, at the moment of transfer, because by the time we find out
    /// the call went unanswered the flow is over and the agent is gone — there
    /// is nothing left that could compose a sentence.
    Dial { number: String, record: bool, on_no_answer: String },
    /// Say this, then hang up.
    Speak { text: String },
}

#[derive(Clone, Default)]
pub struct Handovers {
    pending: Arc<Mutex<HashMap<String, (Handover, Instant)>>>,
}

impl Handovers {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn queue(&self, ucid: &str, handover: Handover) {
        let mut map = self.pending.lock().unwrap();
        map.retain(|_, (_, at)| at.elapsed() < TTL);
        map.insert(ucid.to_string(), (handover, Instant::now()));
    }

    /// Read and remove. A handover happens once; a repeated webhook for the same
    /// call must not dial the front desk twice.
    pub fn take(&self, ucid: &str) -> Option<Handover> {
        let mut map = self.pending.lock().unwrap();
        map.retain(|_, (_, at)| at.elapsed() < TTL);
        map.remove(ucid).map(|(h, _)| h)
    }
}

/// KooKoo parses the response as XML, so a stray `&` or `<` in a message
/// somebody typed into the composer would truncate it silently.
pub fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

impl Handover {
    /// The XML KooKoo expects on `event=Stream`.
    ///
    /// The number goes in exactly as configured. The reference SDK interpolates
    /// it raw too, and what this carrier accepts for an external mobile is not
    /// documented anywhere I can find — so normalising it here would be
    /// inventing a rule, and inventing one wrong is harder to spot than passing
    /// through what somebody typed.
    pub fn to_xml(&self) -> String {
        match self {
            Handover::Dial { number, record, .. } => {
                format!("    <dial record=\"{record}\">{number}</dial>")
            }
            Handover::Speak { text } => format!(
                "    <playtext lang=\"en-IN\" speed=\"3\" quality=\"best\" type=\"ggl\">{}</playtext>\n    <hangup/>",
                escape(text)
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Handover, Handovers};

    #[test]
    fn a_handover_is_delivered_once() {
        let h = Handovers::new();
        h.queue("u1", Handover::Speak { text: "bye".into() });
        assert!(h.take("u1").is_some());
        // A retried webhook must not dial or speak a second time.
        assert!(h.take("u1").is_none());
    }

    #[test]
    fn a_typed_message_cannot_break_the_xml() {
        let xml = Handover::Speak { text: "Reception & <desk> unavailable".into() }.to_xml();
        assert!(xml.contains("Reception &amp; &lt;desk&gt; unavailable"));
    }

    #[test]
    fn dial_carries_the_number_unchanged() {
        let xml = Handover::Dial {
            number: "+916309248884".into(),
            record: true,
            on_no_answer: String::new(),
        }
        .to_xml();
        assert_eq!(xml.trim(), "<dial record=\"true\">+916309248884</dial>");
    }
}
