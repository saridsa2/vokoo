//! Sending the reading somewhere.
//!
//! The last node of a post-call flow, and the only one that touches a system
//! outside this one. Two things it does deliberately:
//!
//! **It distinguishes 4xx from 5xx.** A 4xx means the payload is not what the
//! receiver expects — retrying that is a bug that looks like resilience. A 5xx
//! is theirs and worth trying again. They are separate outcomes so the flow's
//! author decides what each one means, rather than this file deciding for them.
//!
//! **It sends the call id as an idempotency key.** Delivery is at-least-once by
//! construction — a retry, a replayed webhook, a flow published twice — and
//! without a key on the wire that is a second lead in somebody's CRM.

use serde_json::{json, Value};

use super::expression::{self, Scope};
use super::graph::{vendor_secret, FlowNode};

pub async fn send(
    base: &str,
    key: &str,
    org_id: &str,
    node: &FlowNode,
    scope: &Scope,
    // Work out what would be sent, and do not send it.
    //
    // The whole reason a dry run is safe to offer in the console: testing a
    // flow must not POST a lead into somebody's CRM. Everything up to the
    // request happens — the URL resolves, the body fills in, the credential is
    // looked up — so what is reported is what would actually go.
    dry: bool,
) -> (String, Value) {
    // Resolved, not read: a URL is a field like any other, so
    // `=https://crm/leads/{{ $json.patient_id }}` is a path a flow can build.
    let raw_url = node.config_str("url").unwrap_or_default();
    let url = expression::resolve_text(raw_url, scope).await;
    if !url.starts_with("http") {
        log::warn!("[webhook] no url, or one that is not http: {url:?}");
        return ("failed".to_string(), json!({ "url": url, "problem": "not an http url" }));
    }
    let url = url.as_str();

    let method = node.config_str("method").unwrap_or("POST").to_uppercase();

    // The reading by default. A body may be written instead, with `{{ }}`
    // referring to anything the flow knows — but the common case is "send what
    // was read", and making that the default means the usual flow needs no
    // templating at all.
    let body = match node.config_str("body").filter(|b| !b.trim().is_empty()) {
        Some(template) => {
            let filled = expression::resolve_text(template, scope).await;
            match serde_json::from_str::<Value>(&filled) {
                Ok(value) => value,
                Err(problem) => {
                    log::warn!("[webhook] the body is not JSON once filled in: {problem}");
                    return ("failed".to_string(), json!({ "url": url, "problem": format!("the body is not JSON once filled in: {problem}"), "filled": filled }));
                }
            }
        }
        // The previous node's output. On the usual flow that is the reading the
        // intelligence node produced, so "send what was read" needs no
        // templating at all.
        None => scope.json.clone(),
    };

    let client = match reqwest::Client::builder()
        // Long, because nobody is waiting. A CRM taking twenty seconds is
        // slow, not broken, and giving up on it loses the lead.
        .timeout(std::time::Duration::from_secs(30))
        .build()
    {
        Ok(client) => client,
        Err(problem) => {
            log::warn!("[webhook] {problem}");
            return ("failed".to_string(), json!({ "url": url, "problem": problem.to_string() }));
        }
    };

    let mut request = match method.as_str() {
        "PUT" => client.put(url),
        "PATCH" => client.patch(url),
        _ => client.post(url),
    }
    .header("Content-Type", "application/json")
    // So a receiver can recognise a repeat. The call id is stable across every
    // retry of the same call and different for every other one, which is
    // exactly the property an idempotency key needs.
    .header(
        "Idempotency-Key",
        scope.call.get("call_id").and_then(Value::as_str).unwrap_or_default(),
    )
    .header("User-Agent", "vokoo-postcall/1");

    // A connected provider key, never a key typed into the flow. The composer
    // offers the vendors an organisation has connected, so a key is entered in
    // one place and referenced everywhere.
    if let Some(vendor) = node.config_str("secret_vendor").filter(|v| !v.is_empty()) {
        match vendor_secret(base, key, org_id, vendor).await {
            Some(secret) => request = request.header("Authorization", format!("Bearer {secret}")),
            None => {
                log::warn!("[webhook] no {vendor} key is connected — sending nothing rather than sending it unauthenticated");
                return ("failed".to_string(), json!({ "url": url, "problem": format!("no {vendor} key is connected") }));
            }
        }
    }

    // Everything above happened: the URL resolved, the body filled in, the
    // credential was found. Only the request itself is withheld.
    if dry {
        log::info!("[webhook] dry run — would {method} {url}");
        return (
            "ok".to_string(),
            json!({ "dry_run": true, "method": method, "url": url, "would_send": body }),
        );
    }

    let reported = json!({ "method": method, "url": url, "sent": body });

    match request.json(&body).send().await {
        Ok(response) => {
            let status = response.status();
            if status.is_success() {
                log::info!("[webhook] {url} accepted it ({status})");
                ("ok".to_string(), reported)
            } else if status.is_client_error() {
                // Kept whole in the log: this is the branch a person has to
                // read to find out what the receiver disliked, and a status
                // code alone has never been enough to fix a payload.
                let detail = response.text().await.unwrap_or_default();
                log::warn!(
                    "[webhook] {url} refused it ({status}) — the payload is wrong, so retrying will not help: {}",
                    detail.chars().take(400).collect::<String>()
                );
                ("refused".to_string(), json!({ "method": method, "url": url, "sent": body, "status": status.as_u16(), "detail": detail }))
            } else {
                log::warn!("[webhook] {url} is unavailable ({status}) — worth trying again later");
                ("unavailable".to_string(), json!({ "method": method, "url": url, "sent": body, "status": status.as_u16() }))
            }
        }
        Err(problem) => {
            log::warn!("[webhook] could not reach {url}: {problem}");
            ("failed".to_string(), json!({ "method": method, "url": url, "problem": problem.to_string() }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vokoo::expression::Scope;
    use serde_json::json;

    // Substitution itself is `expression.rs`'s to test, and it does, including
    // the roots, the types and the injection case. What belongs here is the
    // webhook's own guarantee: whatever an author writes, what leaves this
    // node is JSON or nothing leaves at all.
    #[tokio::test]
    async fn a_templated_body_still_parses_as_json() {
        let mut scope = Scope::for_integration(json!({ "caller": "+919949879837" }));
        scope.record("Process call", json!({ "patient_name": "सात्या", "score": 8 }));

        let template = r#"={"name": "{{ $json.patient_name }}", "score": {{ $json.score }}, "from": "{{ $call.caller }}"}"#;
        let filled = expression::resolve_text(template, &scope).await;

        assert_eq!(
            serde_json::from_str::<Value>(&filled).expect("the filled body is JSON"),
            json!({ "name": "सात्या", "score": 8, "from": "+919949879837" }),
        );
    }

    // A number substituted into a JSON body must not arrive quoted — which is
    // why a sole `{{ }}` keeps its type and an interpolated one is written
    // without quotes around it.
    #[tokio::test]
    async fn a_missing_field_leaves_a_hole_the_author_can_see() {
        let scope = Scope::for_integration(json!({}));
        let filled = expression::resolve_text(r#"={"name": "{{ $json.nobody }}"}"#, &scope).await;
        assert_eq!(filled, r#"{"name": ""}"#);
    }
}
