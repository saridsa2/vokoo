//! Writing the call down.
//!
//! A call's state used to live in the WebSocket handler, so it died with the
//! socket that ended it. This is the same state on the other side of the
//! database, keyed by the carrier's `ucid` — the one identifier that appears on
//! every webhook, is taken by every call-control command, and outlives the
//! media session.
//!
//! Every write is fire-and-forget. A call must not fail because its own
//! bookkeeping failed: a caller who gets through and is not written down is a
//! reporting problem, while a caller dropped because a database was slow is a
//! product one.

use serde_json::{json, Value};

/// A call, as far as the database is concerned.
#[derive(Clone)]
pub struct CallRecord {
    supabase_url: String,
    service_key: String,
    /// `None` when the row could not be created. Every method then does
    /// nothing, so the call proceeds unrecorded rather than not at all.
    call_id: Option<String>,
    /// Kept because `call_ended` is keyed on the carrier's id, not ours: the
    /// Hangup webhook carries the ucid and nothing else we assigned.
    ucid: String,
    started: std::time::Instant,
}

async fn rpc(base: &str, key: &str, function: &str, body: Value) -> Option<Value> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .build()
        .ok()?;

    let response = client
        .post(format!("{base}/rest/v1/rpc/{function}"))
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| log::warn!("[call-record] {function}: {e}"))
        .ok()?;

    if !response.status().is_success() {
        log::warn!(
            "[call-record] {function}: {} {}",
            response.status(),
            response.text().await.unwrap_or_default().chars().take(160).collect::<String>()
        );
        return None;
    }
    response.json::<Value>().await.ok()
}

impl CallRecord {
    /// Open the record. Returns a handle even when the write failed, so callers
    /// never branch on whether bookkeeping is working.
    pub async fn open(
        supabase_url: &str,
        service_key: &str,
        ucid: &str,
        did: &str,
        from: &str,
        flow_id: Option<&str>,
    ) -> Self {
        let call_id = if supabase_url.is_empty() || service_key.is_empty() {
            None
        } else {
            rpc(
                supabase_url,
                service_key,
                "call_started",
                json!({
                    "p_carrier": "kookoo",
                    "p_ucid": ucid,
                    "p_did": did,
                    "p_from": from,
                    "p_flow_id": flow_id,
                }),
            )
            .await
            .and_then(|v| v.as_str().map(str::to_owned))
        };

        match &call_id {
            Some(id) => log::info!("[call-record] opened {id}"),
            None => log::warn!("[call-record] not recording this call"),
        }

        Self {
            supabase_url: supabase_url.to_string(),
            service_key: service_key.to_string(),
            call_id,
            ucid: ucid.to_string(),
            started: std::time::Instant::now(),
        }
    }

    pub fn id(&self) -> Option<&str> {
        self.call_id.as_deref()
    }

    /// One node, and how it finished.
    ///
    /// Spawned rather than awaited: a step of the flow should not wait on a
    /// round trip to the database while a caller is on the line.
    pub fn step(
        &self,
        sequence: usize,
        node_id: &str,
        node_name: &str,
        implementation: &str,
        outcome: &str,
        duration_ms: u128,
        trigger: &str,
        detail: Value,
    ) {
        let Some(call_id) = self.call_id.clone() else { return };
        let (base, key) = (self.supabase_url.clone(), self.service_key.clone());
        let body = json!({
            "p_call_id": call_id,
            "p_sequence": sequence,
            "p_node_id": node_id,
            "p_node_name": node_name,
            "p_implementation": implementation,
            "p_outcome": outcome,
            "p_duration_ms": duration_ms.min(i32::MAX as u128) as i32,
            "p_trigger": trigger,
            "p_detail": detail,
        });
        tokio::spawn(async move {
            rpc(&base, &key, "call_event", body).await;
        });
    }

    /// One line of what was said, appended as it is heard.
    ///
    /// Written per line rather than buffered to the end of the call: a
    /// transcript held in memory is a transcript lost when the caller hangs up
    /// unexpectedly, which is exactly the call worth reading afterwards.
    pub fn transcript_line(&self, speaker: &str, text: &str) {
        let Some(call_id) = self.call_id.clone() else { return };
        let (base, key) = (self.supabase_url.clone(), self.service_key.clone());
        let body = json!({
            "p_call_id": call_id,
            "p_speaker": speaker,
            "p_text": text,
        });
        tokio::spawn(async move {
            rpc(&base, &key, "call_transcript_line", body).await;
        });
    }

    /// Close the record.
    ///
    /// Awaited, unlike the steps: this is the last thing that happens and there
    /// is no caller left to keep waiting.
    pub async fn close(
        &self,
        ended_reason: Option<&str>,
        disconnect_reason: Option<&str>,
        recording_url: Option<&str>,
        variables: Value,
    ) {
        if self.call_id.is_none() {
            return;
        }
        rpc(
            &self.supabase_url,
            &self.service_key,
            "call_ended",
            json!({
                "p_ucid": self.ucid,
                "p_ended_reason": ended_reason,
                "p_disconnect_reason": disconnect_reason,
                // Our own clock. The carrier's duration is authoritative and
                // arrives on a webhook that may never come, so it overwrites
                // this later rather than being waited for.
                "p_duration_seconds": self.started.elapsed().as_secs() as i64,
                "p_recording_url": recording_url,
                "p_variables": variables,
            }),
        )
        .await;
    }
}
