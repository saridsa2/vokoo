//! Acting on a call while it is up.
//!
//! Everything a flow does that is not talking: bringing a person in, holding,
//! muting, dropping someone. These are Ozonetel's CallControl_V4 endpoint,
//! which identifies the call by the `ucid` the bridge has held since it
//! answered.
//!
//! This was written twice. The first version guessed at
//! `GET /api/v1/CallControl/{Action}` with the parameters as a query string,
//! which is a different API on a different host: it answered every call with
//! HTTP 200 and an error in the body, so a failed transfer looked like a
//! successful one and the caller was hung up on instead of being put through.
//! The shape below is the documented one — one POST, JSON body, the action as a
//! field rather than a path segment.
//!
//! Two values come from the organisation's KooKoo connection rather than from
//! here: the CloudAgent `userName` and `agentPhoneName`. They are mandatory on
//! every command and there is no sensible default for either, so a connection
//! missing them fails loudly rather than sending a request that cannot work.

use std::sync::Arc;

use tokio::sync::Mutex;

use super::graph::{vendor_account, vendor_secret};
use super::handover::{Handover, Handovers};

/// Domestic CCaaS. International accounts use `api.ccaas.ozonetel.com`, which
/// also changes how `conferenceNumber` is formatted — see [`dialable`].
const BASE_URL: &str = "https://in1-ccaas-api.ozonetel.com/ca_apis/CallControl_V4";

/// The carrier is a third party over the public internet. Long enough for a
/// slow response, short enough that a caller is not left in silence waiting.
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

/// What every call-control endpoint needs to identify the call.
#[derive(Debug, Clone)]
pub struct CallHandle {
    pub ucid: String,
    pub did: String,
    pub caller: String,
    pub org_id: String,
}

/// Borrowed for one call into VoKoo's own services. Not stored anywhere: it is
/// a view onto the call control's own fields.
pub struct ServiceContext<'a> {
    pub supabase_url: &'a str,
    pub service_key: &'a str,
    pub org_id: &'a str,
    pub ucid: &'a str,
}

/// The account the commands are issued against.
#[derive(Debug, Clone)]
struct Account {
    api_key: String,
    user_name: String,
    agent_phone_name: String,
}

pub struct CallControl {
    handle: CallHandle,
    supabase_url: String,
    service_key: String,
    account: Arc<Mutex<Option<Account>>>,
    /// Where a deferred hand-over is left for the IVR webhook to collect.
    handovers: Handovers,
}

/// Ozonetel's domestic instance wants a conference number as a zero followed by
/// ten digits — not `+91…`, not `91…`. Passing the number the way it is stored
/// gets "Please pass valid Conference number", or worse, "call not found".
/// The one shape the carrier is shown, however the number was stored.
///
/// `0` plus the last ten digits, which is what KooKoo's own `<dial>` example
/// uses (`09912343234`) and what `CONFERENCE` needs. A number typed into the
/// composer as `+91…`, `91…` or with spaces all reduce to the same string here.
pub(crate) fn dialable(number: &str) -> Option<String> {
    let digits: String = number.chars().filter(char::is_ascii_digit).collect();
    let last_ten = digits.get(digits.len().checked_sub(10)?..)?;
    Some(format!("0{last_ten}"))
}

/// Did the carrier reject a command it answered with 200?
///
/// Ozonetel reports application errors in the body, not the status line, and
/// uses three different words for failure across its responses.
fn carrier_rejected(body: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("status").and_then(|s| s.as_str().map(str::to_ascii_lowercase)))
        .is_some_and(|s| s == "error" || s == "fail" || s == "false")
}

impl CallControl {
    pub fn new(
        handle: CallHandle,
        supabase_url: String,
        service_key: String,
        handovers: Handovers,
    ) -> Self {
        Self {
            handle,
            supabase_url,
            service_key,
            account: Arc::new(Mutex::new(None)),
            handovers,
        }
    }

    /// Where this call reaches VoKoo's own services, and who it belongs to.
    ///
    /// The tool dispatcher needs all four, and they already live here for the
    /// duration of a call. The alternative was threading the same values
    /// through `FlowRunner`, which would have given a second place for them to
    /// be wrong. `ucid` rather than the `calls` row id: the runner never sees
    /// that id, and the carrier's ucid is the identifier that outlives the
    /// socket.
    pub fn service(&self) -> ServiceContext<'_> {
        ServiceContext {
            supabase_url: &self.supabase_url,
            service_key: &self.service_key,
            org_id: &self.handle.org_id,
            ucid: &self.handle.ucid,
        }
    }

    /// Hand the caller to a number once the conversation ends.
    ///
    /// Nothing is sent to the carrier here. KooKoo asks us what to do when the
    /// media socket closes, and this is the answer being written down in
    /// advance — see [`super::handover`]. Returns false only if there is no
    /// number to dial, because there is nothing else that can fail yet; whether
    /// the carrier accepts the number is not known until it asks.
    pub fn queue_transfer(&self, number: &str, record: bool, on_no_answer: &str) -> bool {
        if number.trim().is_empty() {
            return false;
        }
        log::info!("[kookoo] queued hand-over to {number} when the stream ends");
        self.handovers.queue(
            &self.handle.ucid,
            Handover::Dial {
                number: number.trim().to_string(),
                record,
                on_no_answer: on_no_answer.to_string(),
            },
        );
        true
    }

    async fn account(&self) -> Option<Account> {
        let mut cached = self.account.lock().await;
        if cached.is_none() {
            let key =
                vendor_secret(&self.supabase_url, &self.service_key, &self.handle.org_id, "kookoo")
                    .await?;
            let meta = vendor_account(
                &self.supabase_url,
                &self.service_key,
                &self.handle.org_id,
                "kookoo",
            )
            .await
            .unwrap_or_default();

            let field = |name: &str| {
                meta.get(name).and_then(|v| v.as_str()).unwrap_or_default().to_string()
            };
            let (user_name, agent_phone_name) = (field("user_name"), field("agent_phone_name"));

            // Both are mandatory on every command. Saying which one is missing
            // is the difference between a five-minute fix in the console and an
            // afternoon reading carrier error messages.
            if user_name.is_empty() || agent_phone_name.is_empty() {
                log::warn!(
                    "[kookoo] connection is incomplete — user_name{} agent_phone_name{}. \
                     Set them on the KooKoo connection; call control cannot work without both.",
                    if user_name.is_empty() { " MISSING" } else { " ok" },
                    if agent_phone_name.is_empty() { " MISSING" } else { " ok" },
                );
                return None;
            }
            *cached = Some(Account { api_key: key, user_name, agent_phone_name });
        }
        cached.clone()
    }

    /// One carrier command.
    ///
    /// `extra` carries whatever the action needs beyond the four fields every
    /// action takes.
    async fn command(&self, action: &str, extra: serde_json::Value) -> bool {
        let Some(account) = self.account().await else {
            log::warn!("[kookoo] {action} skipped — no usable KooKoo connection");
            return false;
        };

        let client = match reqwest::Client::builder().timeout(TIMEOUT).build() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("[kookoo] client: {e}");
                return false;
            }
        };

        let mut body = serde_json::json!({
            "action": action,
            "ucid": self.handle.ucid,
            "did": self.handle.did,
            "agentPhoneName": account.agent_phone_name,
            "userName": account.user_name,
        });
        if let (Some(map), Some(extra)) = (body.as_object_mut(), extra.as_object()) {
            map.extend(extra.clone());
        }

        match client
            .post(BASE_URL)
            .header("Content-Type", "application/json")
            .header("apiKey", account.api_key)
            .json(&body)
            .send()
            .await
        {
            Ok(response) => {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                let excerpt = text.chars().take(160).collect::<String>();
                let ok = status.is_success() && !carrier_rejected(&text);
                if ok {
                    log::info!("[kookoo] {action} -> {excerpt}");
                } else {
                    log::warn!("[kookoo] {action} FAILED -> {status} {excerpt}");
                }
                ok
            }
            Err(e) => {
                log::warn!("[kookoo] {action} failed: {e}");
                false
            }
        }
    }

    /// Dial someone and put them into the call — a warm transfer.
    ///
    /// The agent stays on the line rather than handing the call away, which is
    /// what lets it keep listening once the two people are talking.
    pub async fn conference(&self, number: &str, _play_ring: bool) -> bool {
        let Some(dial) = dialable(number) else {
            log::warn!("[kookoo] {number} is not a number that can be conferenced");
            return false;
        };
        self.command("CONFERENCE", serde_json::json!({ "conferenceNumber": dial })).await
    }

    pub async fn hold(&self) -> bool {
        self.command("HOLD", serde_json::json!({})).await
    }

    pub async fn unhold(&self) -> bool {
        self.command("UNHOLD", serde_json::json!({})).await
    }

    /// Silence a party at the carrier.
    ///
    /// The bridge already refuses to send audio once a flow puts the agent into
    /// listening mode, so this is not what keeps the agent quiet — it is here
    /// for a flow that wants to mute somebody else.
    pub async fn mute(&self) -> bool {
        self.command("MUTE", serde_json::json!({})).await
    }

    pub async fn unmute(&self) -> bool {
        self.command("UNMUTE", serde_json::json!({})).await
    }

    /// Drop a party. `KICK_CALL` wants the number in `conferenceNumber`.
    pub async fn disconnect(&self) -> bool {
        let Some(dial) = dialable(&self.handle.caller) else {
            log::warn!("[kookoo] cannot drop {}: not a dialable number", self.handle.caller);
            return false;
        };
        self.command("KICK_CALL", serde_json::json!({ "conferenceNumber": dial })).await
    }
}

#[cfg(test)]
mod tests {
    use super::dialable;

    #[test]
    fn conference_numbers_are_zero_plus_ten_digits() {
        // However the console stored it, the carrier sees one shape.
        assert_eq!(dialable("+916309248884").as_deref(), Some("06309248884"));
        assert_eq!(dialable("916309248884").as_deref(), Some("06309248884"));
        assert_eq!(dialable("6309248884").as_deref(), Some("06309248884"));
        assert_eq!(dialable("+91 63092 48884").as_deref(), Some("06309248884"));
        assert_eq!(dialable("12345"), None);
    }
}
