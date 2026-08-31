//! Calling a tool from a flow.
//!
//! Everything goes through the dispatcher rather than the bridge calling a
//! tool's endpoint itself. The dispatcher owns argument validation against
//! `tools.schema`, the organisation check, the budget and the `call_events`
//! row; a second caller doing its own version of those would be a second set of
//! rules to keep in step.
//!
//! Contract: docs/specs/2026-08-31-tool-dispatcher.md

use serde_json::{json, Value};

/// How the dispatcher answered.
pub struct ToolReply {
    /// The outcome the flow should take: `ok`, `working`, or `failed`.
    pub outcome: String,
    /// What the tool returned, or the error, for the trace.
    pub detail: Value,
}

/// Run a tool for this call.
///
/// `flow` rather than `live`: a flow step has no caller mid-sentence, so the
/// dispatcher gives it the longer budget. A tool the agent calls during the
/// conversation is a different path and does not come through here.
///
/// Every failure returns `failed` rather than an error, and the flow branches
/// on it. A tool that cannot be reached is a fact about the call, not a reason
/// to abandon the walk — the same contract `resolve_for_did` follows.
pub async fn call(
    supabase_url: &str,
    service_key: &str,
    org_id: &str,
    ucid: &str,
    tool: &str,
    args: Value,
    sequence: usize,
) -> ToolReply {
    if supabase_url.is_empty() || service_key.is_empty() || tool.is_empty() {
        return ToolReply {
            outcome: "failed".into(),
            detail: json!({ "error": "not_configured" }),
        };
    }

    let client = match reqwest::Client::builder()
        // Above the dispatcher's own 30s flow budget, so a slow tool is
        // reported by the dispatcher rather than cut off by us. Two timeouts
        // racing would make which one fired a matter of milliseconds.
        .timeout(std::time::Duration::from_secs(35))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return ToolReply {
                outcome: "failed".into(),
                detail: json!({ "error": "client", "message": e.to_string() }),
            }
        }
    };

    let response = client
        .post(format!("{supabase_url}/functions/v1/tools"))
        .header("Authorization", format!("Bearer {service_key}"))
        .json(&json!({
            "tool": tool,
            "args": args,
            "org_id": org_id,
            "ucid": ucid,
            "invocation": "flow",
            "sequence": sequence,
        }))
        .send()
        .await;

    let body: Value = match response {
        Ok(r) => r.json().await.unwrap_or_else(|e| json!({ "message": e.to_string() })),
        Err(e) => {
            log::warn!("[tool] {tool} could not be reached: {e}");
            return ToolReply {
                outcome: "failed".into(),
                detail: json!({ "error": "unreachable", "message": e.to_string() }),
            };
        }
    };

    // "working" is a success the flow can route: the tool was accepted and is
    // still running, and the dispatcher will record what it did. A flow that
    // treated that as failure would undo work that is about to succeed.
    let outcome = if body.get("ok").and_then(Value::as_bool) == Some(true) {
        match body.get("result").and_then(|r| r.get("status")).and_then(Value::as_str) {
            Some("working") => "working",
            _ => "ok",
        }
    } else {
        "failed"
    };

    log::info!("[tool] {tool} -> {outcome}");
    ToolReply { outcome: outcome.into(), detail: body }
}

/// Run a tool the model asked for, mid-conversation.
///
/// Returns what goes back to the model, and only that: the caller is waiting on
/// a sentence, so a failure is phrased as a result the model can speak around
/// rather than an error it never sees. The dispatcher has already recorded what
/// happened, so nothing is lost by keeping this shape small.
pub async fn call_live(
    supabase_url: &str,
    service_key: &str,
    org_id: &str,
    ucid: &str,
    tool: &str,
    args: Value,
) -> Value {
    let client = match reqwest::Client::builder()
        // Above the dispatcher's 2s live budget, so the answer comes from the
        // dispatcher — which knows whether the work is still running — rather
        // than from us giving up first.
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => return json!({ "ok": false, "error": "client", "message": e.to_string() }),
    };

    let response = client
        .post(format!("{supabase_url}/functions/v1/tools"))
        .header("Authorization", format!("Bearer {service_key}"))
        .json(&json!({
            "tool": tool,
            "args": args,
            "org_id": org_id,
            "ucid": ucid,
            "invocation": "live",
        }))
        .send()
        .await;

    match response {
        Ok(r) => r.json().await.unwrap_or_else(|e| {
            json!({ "ok": false, "error": "unreadable", "message": e.to_string() })
        }),
        Err(e) => {
            log::warn!("[tool] {tool} could not be reached: {e}");
            json!({ "ok": false, "error": "unreachable", "message": e.to_string() })
        }
    }
}
