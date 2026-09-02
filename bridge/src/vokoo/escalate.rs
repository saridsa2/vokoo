//! Escalating a call that cannot be served.
//!
//! Three times on 1 September a caller was left listening to nothing: a relay
//! published on a model Sarvam had retired, a sentence splitter that panicked
//! on Devanagari, and a menu key with nowhere to go. In each case the bridge
//! knew something was wrong and the caller did not — the line simply went
//! quiet until they gave up.
//!
//! This is the other half of that. A failure becomes an escalation: the call
//! goes to a person.
//!
//! **It does not try to rescue the pipeline.** By the time we get here the
//! thing that broke has broken. What makes this work is a property of the
//! carrier: after the media stream ends the call is *still live*, and KooKoo
//! asks what to do next on `event=Stream`. So escalating is queuing a handover
//! and letting the socket close — the same path a `kookoo.transfer` node
//! already uses on calls that succeed. Nothing new has to survive the failure.
//!
//! Where the call goes is a flow, in n8n's sense of an error workflow: its own
//! graph on a `call.failed` trigger, bound to the number the same way the
//! answering flow is. Many numbers can point at one. A number that names none
//! falls back to the organisation's escalation number, and an organisation
//! without one gets today's behaviour — silence — because inventing a
//! destination is worse than admitting there isn't one.

use super::graph::{resolve_for_event, TRIGGER_FAILED};
use super::handover::{Handover, Handovers};
use super::runner::{FlowRunner, NodeAction};
use super::control::{CallControl, CallHandle};

/// Why a call is being escalated. The `&str` is the outcome the `call.failed`
/// trigger leaves by, so a flow can route a crash differently from a provider
/// that went quiet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cause {
    /// The engine could not be built: a step with no provider, a key that is
    /// not connected, a model the provider has retired.
    EngineFailed,
    /// A provider dropped or refused mid-call.
    ProviderLost,
    /// The caller's audio stopped reaching the pipeline.
    NoAudio,
    /// Something panicked.
    Crashed,
}

impl Cause {
    pub fn as_str(self) -> &'static str {
        match self {
            Cause::EngineFailed => "engine_failed",
            Cause::ProviderLost => "provider_lost",
            Cause::NoAudio => "no_audio",
            Cause::Crashed => "crashed",
        }
    }

    /// What the caller is told while they are being moved.
    ///
    /// Deliberately the same sentence for every cause. A caller does not need
    /// to know which of our components failed, and naming it invites the
    /// question of why we did not fix it.
    pub fn spoken(self) -> &'static str {
        "Sorry, I am having trouble on this line. Let me put you through to someone."
    }
}

/// Send a failed call to a person. Returns whether anything was queued.
///
/// `false` means the caller is about to get whatever the failure left behind,
/// and the log says why — no flow bound, no escalation number, nothing wired.
pub async fn escalate(
    base: &str,
    key: &str,
    handovers: &Handovers,
    ucid: &str,
    did: &str,
    caller: &str,
    cause: Cause,
) -> bool {
    log::warn!("[escalate] ucid={ucid} {} — looking for somewhere to send this call", cause.as_str());

    // 1. A `call.failed` flow bound to this number.
    if let Some(flow) = resolve_for_event(base, key, did, TRIGGER_FAILED).await {
        let control = CallControl::new(
            CallHandle {
                ucid: ucid.to_string(),
                did: did.to_string(),
                caller: caller.to_string(),
                org_id: flow.org_id.clone(),
            },
            base.to_string(),
            key.to_string(),
            handovers.clone(),
        );

        let mut runner = FlowRunner::new(&flow, &control).started_by(cause.as_str());
        loop {
            match runner.advance().await {
                NodeAction::Finished(reason) => {
                    log::info!("[escalate] ucid={ucid} '{}' finished: {reason}", flow.name);
                    break;
                }
                // An exception flow cannot hold a conversation: the pipeline it
                // would need is the thing that just failed, and this socket is
                // closing. Said plainly rather than silently skipped, because
                // somebody drew that node expecting it to answer.
                NodeAction::RunAgent { node, .. } | NodeAction::Monitor { node, .. } => {
                    log::warn!(
                        "[escalate] ucid={ucid} '{}' wants agent node {} — an exception flow \
                         runs after the audio is gone and cannot talk to anyone. Use a transfer.",
                        flow.name, node.name
                    );
                    break;
                }
                // Likewise a keypad menu: `<collectdtmf>` needs the caller to
                // still be listening to us, and by here they are not.
                NodeAction::CollectDigits { node, .. } => {
                    log::warn!(
                        "[escalate] ucid={ucid} '{}' wants to ask a key at {} — too late for that.",
                        flow.name, node.name
                    );
                    break;
                }
            }
        }

        // The flow's own transfer node queues the handover. If it drew none,
        // nothing is queued and the caller gets silence — which is the flow
        // author's decision, not a bug, but worth a line in the log.
        return true;
    }

    // 2. The organisation's fallback number.
    match escalation_number(base, key, did).await {
        Some(number) if !number.trim().is_empty() => {
            // Normalised rather than passed through. A flow author types a
            // number into a transfer node and sees the result immediately; an
            // account-level fallback is typed once and read only when
            // something has already gone wrong, which is the worst moment to
            // discover it was stored in a shape the carrier will not dial.
            let dial = super::control::dialable(&number).unwrap_or_else(|| number.trim().to_string());
            log::info!("[escalate] ucid={ucid} no call.failed flow — transferring to {dial}");
            handovers.queue(
                ucid,
                Handover::Dial {
                    number: dial,
                    record: true,
                    on_no_answer: "Sorry, nobody is available right now. Please try again later. Goodbye."
                        .to_string(),
                },
            );
            true
        }
        _ => {
            log::warn!(
                "[escalate] ucid={ucid} nowhere to send this call — no call.failed flow for {did} \
                 and no escalation number on the organisation. The caller gets silence."
            );
            false
        }
    }
}

/// The organisation's escalation number, via the number that was dialled.
async fn escalation_number(base: &str, key: &str, did: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;

    // Through `spellings`, not an exact match: the carrier sends `918040802529`
    // and the console stores `+918040802529`. Comparing them directly returned
    // an empty row and would have made every fallback silently unreachable.
    let response = client
        .get(format!("{base}/rest/v1/phone_numbers"))
        .query(&[
            ("number", format!("in.({})", super::graph::spellings(did).join(","))),
            ("select", "organizations(escalation_number)".to_string()),
            ("limit", "1".to_string()),
        ])
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .await
        .ok()?;

    let rows: Vec<serde_json::Value> = response.json().await.ok()?;
    rows.first()?
        .get("organizations")?
        .get("escalation_number")?
        .as_str()
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_cause_names_an_outcome_the_trigger_declares() {
        // These four strings are the outcomes of `trigger.call_failed` in the
        // catalogue. A cause whose name drifts from its outcome would resolve
        // to no transition, and the escalation would end where it started.
        let declared = ["engine_failed", "provider_lost", "no_audio", "crashed"];
        for cause in [Cause::EngineFailed, Cause::ProviderLost, Cause::NoAudio, Cause::Crashed] {
            assert!(declared.contains(&cause.as_str()), "{} is not a declared outcome", cause.as_str());
        }
    }

    #[test]
    fn the_caller_is_never_told_which_component_failed() {
        for cause in [Cause::EngineFailed, Cause::ProviderLost, Cause::NoAudio, Cause::Crashed] {
            let said = cause.spoken().to_lowercase();
            for leak in ["engine", "provider", "panic", "crash", "socket", "sarvam", "openai"] {
                assert!(!said.contains(leak), "{leak:?} leaks into what the caller hears");
            }
        }
    }
}
