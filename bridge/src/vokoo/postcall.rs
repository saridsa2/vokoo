//! What happens after everybody has hung up.
//!
//! `call.ended` has been a constant in `graph.rs`, a node type in the catalogue
//! and a bindable row in `number_flows` since the flow vocabulary landed, and
//! nothing ever resolved it. `resolve_for_event` was called with `call.answered`
//! and `call.failed` and nothing else, so a post-call flow could be drawn,
//! published and bound to a number, and would never run. This resolves it.
//!
//! **Nobody is waiting here**, which inverts every constraint the call path
//! works under. A tool has 2 seconds because a caller is mid-sentence; this has
//! as long as it needs. What it does not have is a second chance from the
//! carrier — the webhook fires once — so the order of operations matters more
//! than the speed: the extraction is written to the call *before* anything is
//! sent anywhere. A restart then loses the delivery and never the data.

use serde_json::{json, Value};

use super::expression::Scope;
use super::graph::{load_flow_version, resolve_for_event, EntryPoint, Flow, TRIGGER_ENDED};

#[derive(Debug, PartialEq, Eq)]
enum LifecycleSelection {
    Pinned { flow_id: String, version: i32 },
    Legacy,
    Invalid,
}

fn lifecycle_selection(call: &Value) -> LifecycleSelection {
    let flow_id = call.get("flow_id").and_then(Value::as_str);
    let version = call.get("flow_version").and_then(Value::as_i64);
    match (flow_id, version) {
        (Some(flow_id), Some(version)) if !flow_id.is_empty() => i32::try_from(version)
            .ok()
            .map(|version| LifecycleSelection::Pinned { flow_id: flow_id.to_owned(), version })
            .unwrap_or(LifecycleSelection::Invalid),
        (None, None) => LifecycleSelection::Legacy,
        _ => LifecycleSelection::Invalid,
    }
}

/// One node, as it ran.
///
/// Recorded only for a dry run, which is what the console's node view shows in
/// its Input and Output panes. A real run keeps nothing: the ledger of what
/// happened is `call_events`, and a second copy would be a second truth.
#[derive(serde::Serialize)]
pub struct Step {
    pub node_id: String,
    pub name: String,
    pub implementation: String,
    /// What `$json` held when this node began — the previous node's output.
    pub input: Value,
    /// What it produced, and for a webhook what it sent or would have sent.
    pub output: Value,
    pub outcome: String,
    pub ms: u64,
}

/// Walk a flow against a finished call without changing anything.
///
/// The same walk a real hangup takes — not a second implementation of it. The
/// two differ by one flag, which decides whether the reading is written and
/// whether the request is sent. A cheaper imitation of a runner is a runner
/// that can disagree with the first, and this project has paid for that once
/// already with pre-flight.
pub async fn dry_run(
    base: &str,
    key: &str,
    flow_id: &str,
    ucid: &str,
) -> Result<Vec<Step>, String> {
    let flow = super::graph::load_flow(base, key, flow_id)
        .await
        .ok_or_else(|| format!("no flow {flow_id}"))?;
    let call = load_call(base, key, ucid).await?;
    let ended_by = match call.get("ended_reason").and_then(Value::as_str) {
        Some("user_disconnected") => "caller_hung_up",
        _ => "we_ended",
    };
    let recording = call.get("recording_url").and_then(Value::as_str).map(str::to_owned);

    let mut steps = Vec::new();
    walk(base, key, &flow, None, None, &call, ucid, ended_by, recording.as_deref(), true, &mut steps).await?;
    Ok(steps)
}

/// Run the post-call flow for a call that has just ended.
///
/// Spawned rather than awaited by the webhook: the carrier wants its 200 back,
/// and a CRM taking eight seconds is nobody's problem but ours.
pub fn run_detached(
    base: String,
    key: String,
    did: String,
    ucid: String,
    ended_by: String,
    disconnect_reason: Option<String>,
    recording_url: Option<String>,
) {
    tokio::spawn(async move {
        super::record::CallRecord::finish_from_carrier(
            &base,
            &key,
            &ucid,
            disconnect_reason.as_deref(),
            recording_url.as_deref(),
        )
        .await;
        if let Err(problem) = run(&base, &key, &did, &ucid, &ended_by, recording_url.as_deref()).await {
            // Named, not swallowed. A post-call flow failing is invisible by
            // definition — there is no caller to notice — so the log is the
            // only place it can surface.
            log::warn!("[post-call] ucid={ucid} {problem}");
        }
    });
}

async fn run(
    base: &str,
    key: &str,
    did: &str,
    ucid: &str,
    ended_by: &str,
    recording_url: Option<&str>,
) -> Result<(), String> {
    let call = load_call(base, key, ucid).await?;
    let (flow, source_flow_id, source_flow_version) = match lifecycle_selection(&call) {
        LifecycleSelection::Pinned { flow_id, version } => {
            let flow = load_flow_version(base, key, &flow_id, version, TRIGGER_ENDED)
                .await
                .ok_or_else(|| format!("pinned flow {flow_id} v{version} is not readable"))?;
            (flow, Some(flow_id), Some(version))
        }
        LifecycleSelection::Legacy => {
            log::warn!(
                "[post-call] ucid={ucid} has no pinned flow — using the legacy call.ended number binding"
            );
            let Some(flow) = resolve_for_event(base, key, did, TRIGGER_ENDED).await else {
                return Ok(());
            };
            (flow, None, None)
        }
        LifecycleSelection::Invalid => {
            return Err("call has an incomplete flow pin; refusing to re-resolve it".into());
        }
    };

    if flow.entry_node(&EntryPoint::new(TRIGGER_ENDED)).is_err() {
        log::info!(
            "[post-call] ucid={ucid} pinned flow '{}' has no call.ended entry — nothing to run",
            flow.name
        );
        return Ok(());
    }

    let mut steps = Vec::new();
    walk(base, key, &flow, source_flow_id.as_deref(), source_flow_version,
        &call, ucid, ended_by, recording_url, false, &mut steps).await
}

/// The walk both runs take.
///
/// `dry` decides two things and nothing else: whether the reading is written to
/// the call, and whether the request leaves the machine. Everything before
/// those points happens either way, which is what makes a dry run worth
/// looking at — it resolves the URL, fills the body and finds the credential.
#[allow(clippy::too_many_arguments)]
async fn walk(
    base: &str,
    key: &str,
    flow: &Flow,
    source_flow_id: Option<&str>,
    source_flow_version: Option<i32>,
    call: &Value,
    ucid: &str,
    ended_by: &str,
    recording_url: Option<&str>,
    dry: bool,
    steps: &mut Vec<Step>,
) -> Result<(), String> {
    let call_id = call.get("id").and_then(Value::as_str).unwrap_or_default().to_string();

    // The call itself: `$call` for the whole flow, and what the trigger emits.
    // Assembled once, because every node needs it and none should be reaching
    // into the database on its own.
    let facts = json!({
        "call_id":       call_id,
        "ucid":          ucid,
        "did":           call.get("to_number").cloned().unwrap_or(Value::Null),
        "caller":        call.get("from_number").cloned().unwrap_or(Value::Null),
        "ended_by":      ended_by,
        "ended_reason":  call.get("ended_reason").cloned().unwrap_or(Value::Null),
        "duration_secs": call.get("duration_seconds").cloned().unwrap_or(Value::Null),
        "started_at":    call.get("started_at").cloned().unwrap_or(Value::Null),
        "transcript":    call.get("transcript").cloned().unwrap_or(json!([])),
        "recording_url": recording_url,
    });

    // An integration, so scripts are allowed: nobody is waiting on one. A live
    // call builds `Scope::for_call` instead and the same expressions read as
    // paths there — see `expression.rs`.
    let mut scope = Scope::for_integration(facts);

    log::info!("[post-call] ucid={ucid} {}'{}'", if dry { "dry run of " } else { "running " }, flow.name);

    let mut current = Some(
        flow.entry_node(&EntryPoint::new(TRIGGER_ENDED))
            .map_err(|error| error.to_string())?
            .to_owned(),
    );
    let mut count = 0;
    // How many times each loop node has sent the flow round, and when the walk
    // began. A loop is bounded by both: a comparison that never stops holding
    // and a body that is merely slow are different failures with the same
    // symptom.
    let mut passes: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let started = std::time::Instant::now();

    while let Some(node_id) = current {
        count += 1;
        if count > 32 {
            return Err(format!("'{}' did not finish in 32 steps — it probably loops", flow.name));
        }

        let Some(node) = flow.node(&node_id) else {
            return Err(format!("transition led to a node that is not here: {node_id}"));
        };

        // What a node is called on the canvas, which is what `$('...')` names.
        let node_name = if node.name.is_empty() { node.id.clone() } else { node.name.clone() };
        let began = std::time::Instant::now();
        // What `$json` held when this node started — its input, in the sense
        // the console's node view means.
        let input = scope.json.clone();

        let (outcome, produced) = match node.implementation.as_str() {
            implementation if implementation.starts_with("trigger.") => {
                // A trigger emits the thing it fired on, so the first node's
                // `$json` is the call. n8n's shape, and it means a webhook
                // wired straight to the trigger has something to send.
                scope.record(&node_name, scope.call.clone());
                (ended_by.to_string(), scope.call.clone())
            }

            "intelligence" => {
                let (outcome, extracted) =
                    super::intelligence::run(base, key, &flow.org_id, node, &scope.call, &call_id, dry).await;
                if let Some(shape) = extracted.clone() {
                    scope.record(&node_name, shape);
                }
                (outcome, extracted.unwrap_or(Value::Null))
            }

            // Gathers values from earlier steps under the names whatever
            // receives them expects. Its output is the payload, which is why a
            // webhook after it needs no body.
            "var" => {
                let (outcome, built) = super::setvalues::run(node, &scope).await;
                scope.record(&node_name, built.clone());
                (outcome, built)
            }

            "http.request" => super::webhook::send(base, key, &flow.org_id, node, &scope, dry).await,

            "integration.invoke" => match super::integration::prepare(node, &scope).await {
                Err(problem) => ("invalid_payload".to_string(), json!({ "problem": problem })),
                Ok(prepared) => {
                    let result = if dry {
                        super::integration::validate(base, key, &flow.org_id, &prepared).await.map(|version| json!({
                            "target_flow_id": prepared.target_flow_id,
                            "target_flow_version": version,
                            "input": prepared.input,
                            "dry_run": true
                        }))
                    } else {
                        let source = super::integration::InvocationSource {
                            flow_id: source_flow_id.map(str::to_owned),
                            flow_version: source_flow_version,
                            execution_id: format!("call:{}", if call_id.is_empty() { ucid } else { &call_id }),
                            call_id: (!call_id.is_empty()).then(|| call_id.clone()),
                            node_id: node.id.clone(),
                        };
                        super::integration::enqueue(base, key, &flow.org_id, &source, &prepared).await
                    };
                    match result {
                        Ok(run) => {
                            scope.record(&node_name, run.clone());
                            ("queued".to_string(), run)
                        }
                        Err(problem) if problem.contains("payload is invalid") =>
                            ("invalid_payload".to_string(), json!({ "problem": problem })),
                        Err(problem) => ("failed".to_string(), json!({ "problem": problem })),
                    }
                }
            },

            // Routes; produces nothing. `$json` passes through unchanged, which
            // is why neither this nor `loop` records an output — a node that
            // only chooses a path must not become the previous step's data.
            "condition" => {
                let held = super::compare::holds(node, &scope).await;
                (if held { "true" } else { "false" }.to_string(), Value::Null)
            }

            "loop" => {
                let seen = passes.entry(node.id.clone()).or_insert(0);
                let most = node.config_i64("max_iterations").unwrap_or(10).max(1) as u32;
                let longest = node.config_i64("max_seconds").unwrap_or(30).max(1) as u64;

                if *seen >= most || started.elapsed().as_secs() >= longest {
                    // Said by name rather than silently taking `done`: a loop
                    // that ran out and a loop that finished are different
                    // facts, and a flow may want to handle them differently.
                    log::warn!(
                        "[post-call] '{node_name}' ran out after {seen} pass(es) and {}s",
                        started.elapsed().as_secs()
                    );
                    ("exhausted".to_string(), Value::Null)
                } else if super::compare::holds(node, &scope).await {
                    *seen += 1;
                    ("each".to_string(), Value::Null)
                } else {
                    ("done".to_string(), Value::Null)
                }
            }

            // JavaScript, and only where a scope allows it. `expression.rs`
            // refuses to evaluate one on a call board whatever a graph asks
            // for, so this cannot become a way onto the call path.
            "code" => {
                let source = node.config_str("source").unwrap_or_default();
                if source.trim().is_empty() {
                    ("failed".to_string(), json!({ "problem": "nothing to run" }))
                } else {
                    // Through the same resolver every expression uses: wrapping
                    // the source in `{{ }}` is what makes it one expression, so
                    // there is no second evaluator to disagree with the first.
                    let returned = super::expression::resolve(&format!("={{{{ {source} }}}}"), &scope).await;
                    match returned {
                        Value::Null => ("failed".to_string(), json!({ "problem": "returned nothing, or threw — see the log" })),
                        value => {
                            scope.record(&node_name, value.clone());
                            ("ok".to_string(), value)
                        }
                    }
                }
            }

            // Everything else on a post-call board is a node somebody drew that
            // this cannot run. Said by name rather than treated as a dead end.
            other => {
                log::warn!("[post-call] '{}' is not something a post-call flow can run", other);
                ("failed".to_string(), json!({ "problem": format!("'{other}' is not implemented") }))
            }
        };

        log::info!("[post-call] {node_name} -> {outcome}");
        steps.push(Step {
            node_id: node.id.clone(),
            name: node_name,
            implementation: node.implementation.clone(),
            input,
            output: produced,
            outcome: outcome.clone(),
            ms: began.elapsed().as_millis() as u64,
        });

        current = flow.next(&node_id, &outcome).map(str::to_owned);
    }

    Ok(())
}

/// The call, as the flow will see it.
async fn load_call(base: &str, key: &str, ucid: &str) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(format!("{base}/rest/v1/calls"))
        .query(&[
            ("provider_call_id", format!("eq.{ucid}")),
            // `to_number` and `recording_url` are here for the dry run, which has
            // no webhook to take them from: a real hangup is handed the DID and
            // the recording by the carrier, and a replay has only the row.
            ("select", "id,flow_id,flow_version,from_number,to_number,started_at,duration_seconds,ended_reason,recording_url,transcript".into()),
            ("limit", "1".into()),
        ])
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .await
        .map_err(|e| format!("could not read the call: {e}"))?;

    let rows: Vec<Value> = response.json().await.map_err(|e| e.to_string())?;
    rows.into_iter().next().ok_or_else(|| format!("no call row for {ucid}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_complete_pin_selects_the_exact_snapshot() {
        assert_eq!(
            lifecycle_selection(&json!({ "flow_id": "flow-1", "flow_version": 4 })),
            LifecycleSelection::Pinned { flow_id: "flow-1".into(), version: 4 }
        );
    }

    #[test]
    fn only_a_call_with_no_pin_uses_the_legacy_binding() {
        assert_eq!(
            lifecycle_selection(&json!({ "flow_id": null, "flow_version": null })),
            LifecycleSelection::Legacy
        );
        assert_eq!(
            lifecycle_selection(&json!({ "flow_id": "flow-1", "flow_version": null })),
            LifecycleSelection::Invalid
        );
    }
}
