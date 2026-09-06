//! Durable invocation of reusable integration flows.

use serde_json::Value;

use super::expression::{self, Scope};
use super::graph::FlowNode;

#[derive(Debug, PartialEq)]
pub struct PreparedInvocation {
    pub target_flow_id: String,
    pub input: Value,
    pub idempotency_key: Option<String>,
    pub max_attempts: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvocationSource {
    pub flow_id: Option<String>,
    pub flow_version: Option<i32>,
    pub execution_id: String,
    pub call_id: Option<String>,
    pub node_id: String,
}

#[derive(Debug)]
struct ValidatedTarget {
    version: i32,
    contract: InputContract,
    schema: Value,
}

#[derive(Debug, PartialEq, Eq)]
pub struct InputContract {
    pub schema_id: String,
    pub clinical_kind: Option<String>,
}

/// Read the immutable contract embedded in a published flow snapshot.
pub fn contract_from_snapshot(snapshot: &Value) -> Result<InputContract, String> {
    let triggers: Vec<&Value> = snapshot
        .pointer("/graph/nodes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|node| node.get("implementation").and_then(Value::as_str) == Some("trigger.integration_invoked"))
        .collect();
    if triggers.len() != 1 {
        return Err("an integration snapshot needs exactly one Integration invoked trigger".into());
    }
    let config = triggers[0].get("config").unwrap_or(&Value::Null);
    let schema_id = config
        .get("input_schema_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .ok_or("the integration trigger has no input schema")?
        .to_owned();
    let clinical_kind = config
        .get("clinical_payload_kind")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|kind| !kind.is_empty())
        .map(str::to_owned);
    Ok(InputContract {
        schema_id,
        clinical_kind,
    })
}

/// Clinical contracts use the vendored Rust models. Other workspace schemas
/// use the JSON Schema subset authored by the console.
pub fn validate_contract_payload(clinical_kind: Option<&str>, schema: &Value, input: &Value) -> Result<(), String> {
    validate_schema(schema, input)?;
    match clinical_kind {
        Some(kind) => super::clinical::validate_clinical_payload(kind, input),
        None => Ok(()),
    }
}

pub fn validate_schema(schema: &Value, input: &Value) -> Result<(), String> {
    validate_at(schema, schema, input, "$")
}

fn validate_at(root: &Value, schema: &Value, input: &Value, path: &str) -> Result<(), String> {
    if let Some(reference) = schema.get("$ref").and_then(Value::as_str) {
        if let Some(pointer) = reference.strip_prefix('#') {
            let target = root
                .pointer(pointer)
                .ok_or_else(|| format!("{path}: schema reference {reference:?} does not exist"))?;
            return validate_at(root, target, input, path);
        }
        return Err(format!(
            "{path}: external schema reference {reference:?} is not supported"
        ));
    }

    for keyword in ["allOf", "anyOf", "oneOf"] {
        if let Some(choices) = schema.get(keyword).and_then(Value::as_array) {
            let passed = choices
                .iter()
                .filter(|candidate| validate_at(root, candidate, input, path).is_ok())
                .count();
            let valid = match keyword {
                "allOf" => passed == choices.len(),
                "anyOf" => passed > 0,
                "oneOf" => passed == 1,
                _ => unreachable!(),
            };
            if !valid {
                return Err(format!("{path}: does not satisfy {keyword}"));
            }
        }
    }

    if let Some(expected) = schema.get("type").and_then(Value::as_str) {
        let correct = match expected {
            "object" => input.is_object(),
            "array" => input.is_array(),
            "string" => input.is_string(),
            "integer" => input.as_i64().is_some() || input.as_u64().is_some(),
            "number" => input.is_number(),
            "boolean" => input.is_boolean(),
            "null" => input.is_null(),
            other => return Err(format!("{path}: unsupported schema type {other:?}")),
        };
        if !correct {
            return Err(format!("{path}: expected {expected}"));
        }
    }
    if let Some(constant) = schema.get("const") {
        if input != constant {
            return Err(format!("{path}: value does not match const"));
        }
    }
    if let Some(allowed) = schema.get("enum").and_then(Value::as_array) {
        if !allowed.contains(input) {
            return Err(format!("{path}: value is not in enum"));
        }
    }
    if let Some(object) = input.as_object() {
        if let Some(required) = schema.get("required").and_then(Value::as_array) {
            for name in required.iter().filter_map(Value::as_str) {
                if !object.contains_key(name) {
                    return Err(format!("{path}.{name}: required property is missing"));
                }
            }
        }
        if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
            for (name, child_schema) in properties {
                if let Some(child) = object.get(name) {
                    validate_at(root, child_schema, child, &format!("{path}.{name}"))?;
                }
            }
            if schema.get("additionalProperties") == Some(&Value::Bool(false)) {
                if let Some(name) = object.keys().find(|name| !properties.contains_key(*name)) {
                    return Err(format!("{path}.{name}: additional property is not allowed"));
                }
            }
        }
    }
    if let (Some(items), Some(values)) = (schema.get("items"), input.as_array()) {
        if let Some(minimum) = schema.get("minItems").and_then(Value::as_u64) {
            if values.len() < minimum as usize {
                return Err(format!("{path}: must contain at least {minimum} items"));
            }
        }
        for (index, value) in values.iter().enumerate() {
            validate_at(root, items, value, &format!("{path}[{index}]"))?;
        }
    }
    Ok(())
}

fn enqueue_body(org_id: &str, source: &InvocationSource, prepared: &PreparedInvocation, target_version: i32) -> Value {
    serde_json::json!({
        "p_org_id": org_id,
        "p_source_flow_id": source.flow_id,
        "p_source_flow_version": source.flow_version,
        "p_source_execution_id": source.execution_id,
        "p_source_node_id": source.node_id,
        "p_target_flow_id": prepared.target_flow_id,
        "p_target_flow_version": target_version,
        "p_input": prepared.input,
        "p_idempotency_key": prepared.idempotency_key,
        "p_max_attempts": prepared.max_attempts,
        "p_source_call_id": source.call_id,
    })
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|error| error.to_string())
}

async fn json_response(response: reqwest::Response, action: &str) -> Result<Value, String> {
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("{action} failed ({status}): {body}"));
    }
    serde_json::from_str(&body).map_err(|error| format!("{action} returned invalid JSON: {error}"))
}

async fn load_validated_target(base: &str, key: &str, org_id: &str, flow_id: &str) -> Result<ValidatedTarget, String> {
    let http = client()?;
    let flow_response = http
        .get(format!("{base}/rest/v1/flows"))
        .query(&[
            ("id", format!("eq.{flow_id}")),
            ("org_id", format!("eq.{org_id}")),
            ("family", "eq.integration".into()),
            ("status", "eq.published".into()),
            ("select", "id".into()),
            ("limit", "1".into()),
        ])
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .await
        .map_err(|error| format!("could not read integration target: {error}"))?;
    let flows = json_response(flow_response, "read integration target").await?;
    if flows.as_array().is_none_or(Vec::is_empty) {
        return Err("target is not a published integration in this workspace".into());
    }

    let version_response = http
        .get(format!("{base}/rest/v1/flow_versions"))
        .query(&[
            ("flow_id", format!("eq.{flow_id}")),
            ("org_id", format!("eq.{org_id}")),
            ("select", "version,snapshot".into()),
            ("order", "version.desc".into()),
            ("limit", "1".into()),
        ])
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .await
        .map_err(|error| format!("could not read integration version: {error}"))?;
    let versions = json_response(version_response, "read integration version").await?;
    let row = versions
        .as_array()
        .and_then(|rows| rows.first())
        .ok_or("published integration has no immutable version")?;
    let version = row
        .get("version")
        .and_then(Value::as_i64)
        .and_then(|version| i32::try_from(version).ok())
        .filter(|version| *version > 0)
        .ok_or("published integration has an invalid version")?;
    let contract = contract_from_snapshot(row.get("snapshot").ok_or("integration version has no snapshot")?)?;

    let schema_response = http
        .get(format!("{base}/rest/v1/structured_outputs"))
        .query(&[
            ("id", format!("eq.{}", contract.schema_id)),
            ("org_id", format!("eq.{org_id}")),
            ("enabled", "eq.true".into()),
            ("select", "schema".into()),
            ("limit", "1".into()),
        ])
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .await
        .map_err(|error| format!("could not read integration input schema: {error}"))?;
    let schemas = json_response(schema_response, "read integration input schema").await?;
    let schema = schemas
        .as_array()
        .and_then(|rows| rows.first())
        .and_then(|row| row.get("schema"))
        .cloned()
        .ok_or("integration input schema is not enabled in this workspace")?;
    Ok(ValidatedTarget {
        version,
        contract,
        schema,
    })
}

/// Validate against the exact published target snapshot, then enqueue that
/// exact version. This function never executes the target flow inline.
pub async fn enqueue(
    base: &str,
    key: &str,
    org_id: &str,
    source: &InvocationSource,
    prepared: &PreparedInvocation,
) -> Result<Value, String> {
    let target = load_validated_target(base, key, org_id, &prepared.target_flow_id).await?;
    validate_contract_payload(
        target.contract.clinical_kind.as_deref(),
        &target.schema,
        &prepared.input,
    )
    .map_err(|error| format!("integration payload is invalid: {error}"))?;

    let response = client()?
        .post(format!("{base}/rest/v1/rpc/enqueue_integration_run"))
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .json(&enqueue_body(org_id, source, prepared, target.version))
        .send()
        .await
        .map_err(|error| format!("could not enqueue integration: {error}"))?;
    json_response(response, "enqueue integration").await
}

/// Validate without writing, used by the editor's dry run.
pub async fn validate(base: &str, key: &str, org_id: &str, prepared: &PreparedInvocation) -> Result<i32, String> {
    let target = load_validated_target(base, key, org_id, &prepared.target_flow_id).await?;
    validate_contract_payload(
        target.contract.clinical_kind.as_deref(),
        &target.schema,
        &prepared.input,
    )
    .map_err(|error| format!("integration payload is invalid: {error}"))?;
    Ok(target.version)
}

fn retryable_node_failure(implementation: &str, outcome: &str, output: &Value) -> bool {
    if implementation != "http.request" {
        return false;
    }
    let status = output.get("status").and_then(Value::as_u64);
    outcome == "unavailable"
        || status == Some(429)
        || (outcome == "failed" && output.get("method").and_then(Value::as_str).is_some())
}

#[derive(Debug, serde::Deserialize)]
struct ClaimedRun {
    id: String,
    org_id: String,
    source_execution_id: Option<String>,
    target_flow_id: String,
    target_flow_version: i32,
    input: Value,
    attempt_count: i64,
}

#[derive(Debug)]
struct RunFailure {
    message: String,
    retryable: bool,
}

async fn rpc(base: &str, key: &str, name: &str, body: Value) -> Result<Value, String> {
    let response = client()?
        .post(format!("{base}/rest/v1/rpc/{name}"))
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("{name} request failed: {error}"))?;
    json_response(response, name).await
}

async fn append_event(
    base: &str,
    key: &str,
    worker: &str,
    run_id: &str,
    node: &FlowNode,
    outcome: &str,
    duration_ms: u64,
    input: Value,
    output: Value,
) -> Result<(), String> {
    rpc(
        base,
        key,
        "integration_run_event",
        serde_json::json!({
            "p_run_id": run_id,
            "p_worker": worker,
            "p_node_id": node.id,
            "p_node_name": node.name,
            "p_implementation": node.implementation,
            "p_outcome": outcome,
            "p_duration_ms": i32::try_from(duration_ms).unwrap_or(i32::MAX),
            "p_input": input,
            "p_output": output,
            "p_detail": {}
        }),
    )
    .await
    .map(|_| ())
}

async fn execute_claimed(base: &str, key: &str, worker: &str, run: &ClaimedRun) -> Result<Value, RunFailure> {
    let flow = super::graph::load_flow_version(
        base,
        key,
        &run.target_flow_id,
        run.target_flow_version,
        "integration.invoked",
    )
    .await
    .ok_or_else(|| RunFailure {
        message: format!(
            "target flow {} v{} is not readable",
            run.target_flow_id, run.target_flow_version
        ),
        retryable: false,
    })?;
    if flow.org_id != run.org_id {
        return Err(RunFailure {
            message: "target flow version belongs to another workspace".into(),
            retryable: false,
        });
    }

    let source_execution_id = run.source_execution_id.as_deref().unwrap_or_default();
    let mut scope = Scope::for_invocation(run.input.clone(), &run.id, source_execution_id, run.attempt_count);
    let invocation_input = run.input.clone();
    let mut current = Some(
        flow.entry_node(&super::graph::EntryPoint::new("integration.invoked"))
            .map_err(|error| RunFailure {
                message: error.to_string(),
                retryable: false,
            })?
            .to_owned(),
    );
    let mut passes = std::collections::HashMap::<String, u32>::new();
    let started = std::time::Instant::now();
    let mut count = 0;

    while let Some(node_id) = current {
        count += 1;
        if count > 64 {
            return Err(RunFailure {
                message: "integration did not finish in 64 steps".into(),
                retryable: false,
            });
        }
        let node = flow.node(&node_id).ok_or_else(|| RunFailure {
            message: format!("transition led to missing node {node_id}"),
            retryable: false,
        })?;
        let node_name = if node.name.is_empty() {
            node.id.clone()
        } else {
            node.name.clone()
        };
        let input = scope.json.clone();
        let began = std::time::Instant::now();
        let (outcome, output) = match node.implementation.as_str() {
            "trigger.integration_invoked" => {
                scope.record(&node_name, invocation_input.clone());
                ("started".to_string(), invocation_input.clone())
            }
            "var" => {
                let (outcome, output) = super::setvalues::run(node, &scope).await;
                scope.record(&node_name, output.clone());
                (outcome, output)
            }
            "condition" => {
                let held = super::compare::holds(node, &scope).await;
                (if held { "true" } else { "false" }.to_string(), Value::Null)
            }
            "loop" => {
                let seen = passes.entry(node.id.clone()).or_insert(0);
                let most = node.config_i64("max_iterations").unwrap_or(10).max(1) as u32;
                let longest = node.config_i64("max_seconds").unwrap_or(30).max(1) as u64;
                if *seen >= most || started.elapsed().as_secs() >= longest {
                    ("exhausted".to_string(), Value::Null)
                } else if super::compare::holds(node, &scope).await {
                    *seen += 1;
                    ("each".to_string(), Value::Null)
                } else {
                    ("done".to_string(), Value::Null)
                }
            }
            "code" => {
                let source = node.config_str("source").unwrap_or_default();
                if source.trim().is_empty() {
                    ("failed".to_string(), serde_json::json!({ "problem": "nothing to run" }))
                } else {
                    let value = super::expression::resolve(&format!("={{{{ {source} }}}}"), &scope).await;
                    if value.is_null() {
                        (
                            "failed".to_string(),
                            serde_json::json!({ "problem": "returned nothing, or threw" }),
                        )
                    } else {
                        scope.record(&node_name, value.clone());
                        ("ok".to_string(), value)
                    }
                }
            }
            "http.request" => super::webhook::send(base, key, &flow.org_id, node, &scope, false).await,
            other => (
                "failed".to_string(),
                serde_json::json!({ "problem": format!("{other:?} is not integration-safe") }),
            ),
        };

        append_event(
            base,
            key,
            worker,
            &run.id,
            node,
            &outcome,
            began.elapsed().as_millis() as u64,
            input,
            output.clone(),
        )
        .await
        .map_err(|message| RunFailure {
            message,
            retryable: true,
        })?;

        let next = flow.next(&node_id, &outcome).map(str::to_owned);
        if next.is_none() && matches!(outcome.as_str(), "failed" | "refused" | "unavailable" | "exhausted") {
            return Err(RunFailure {
                message: output
                    .get("problem")
                    .and_then(Value::as_str)
                    .unwrap_or(&outcome)
                    .to_owned(),
                retryable: retryable_node_failure(&node.implementation, &outcome, &output),
            });
        }
        current = next;
    }
    Ok(scope.json)
}

async fn work_once(base: &str, key: &str, worker: &str) -> Result<bool, String> {
    let claimed = rpc(
        base,
        key,
        "claim_integration_run",
        serde_json::json!({ "p_worker": worker, "p_lease_seconds": 120 }),
    )
    .await?;
    if claimed.is_null() {
        return Ok(false);
    }
    let run: ClaimedRun =
        serde_json::from_value(claimed).map_err(|error| format!("claim returned an invalid run: {error}"))?;
    let (stop_heartbeat, mut stopped) = tokio::sync::watch::channel(false);
    let heartbeat_base = base.to_owned();
    let heartbeat_key = key.to_owned();
    let heartbeat_worker = worker.to_owned();
    let heartbeat_run = run.id.clone();
    let heartbeat = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = stopped.changed() => break,
                _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => {
                    if let Err(problem) = rpc(
                        &heartbeat_base,
                        &heartbeat_key,
                        "renew_integration_run_lease",
                        serde_json::json!({
                            "p_run_id": heartbeat_run,
                            "p_worker": heartbeat_worker
                        }),
                    ).await {
                        log::warn!("[integration-worker] could not renew {heartbeat_run}: {problem}");
                    }
                }
            }
        }
    });
    let executed = execute_claimed(base, key, worker, &run).await;
    let _ = stop_heartbeat.send(true);
    let _ = heartbeat.await;
    match executed {
        Ok(result) => {
            rpc(
                base,
                key,
                "complete_integration_run",
                serde_json::json!({ "p_run_id": run.id, "p_worker": worker, "p_result": result }),
            )
            .await?;
        }
        Err(failure) => {
            rpc(
                base,
                key,
                "fail_integration_run",
                serde_json::json!({
                    "p_run_id": run.id,
                    "p_worker": worker,
                    "p_error": failure.message,
                    "p_retryable": failure.retryable
                }),
            )
            .await?;
        }
    }
    Ok(true)
}

/// Start one durable queue consumer. Several bridge processes may safely run
/// this because PostgreSQL leases each row with `SKIP LOCKED`.
pub fn schedule_worker(base: String, key: String) {
    if base.is_empty() || key.is_empty() {
        log::warn!("[integration-worker] disabled because Supabase is not configured");
        return;
    }
    let worker = format!("bridge-{}-{}", std::process::id(), uuid::Uuid::new_v4());
    tokio::spawn(async move {
        log::info!("[integration-worker] started {worker}");
        loop {
            match work_once(&base, &key, &worker).await {
                Ok(true) => continue,
                Ok(false) => tokio::time::sleep(std::time::Duration::from_secs(1)).await,
                Err(problem) => {
                    log::warn!("[integration-worker] {problem}");
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                }
            }
        }
    });
}

/// Resolve everything an invocation contributes before touching the queue.
pub async fn prepare(node: &FlowNode, scope: &Scope) -> Result<PreparedInvocation, String> {
    let target_flow_id = node
        .config_str("target_flow_id")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or("Invoke integration has no target flow")?
        .to_owned();

    let configured = node.config.get("input").ok_or("Invoke integration has no input")?;
    let resolved = match configured {
        Value::String(raw) => expression::resolve(raw, scope).await,
        value => value.clone(),
    };
    let input = match resolved {
        Value::String(text) => {
            serde_json::from_str(&text).map_err(|error| format!("Invoke integration input is not JSON: {error}"))?
        }
        value => value,
    };

    let idempotency_key = match node.config_str("idempotency_key") {
        Some(raw) => {
            let key = expression::resolve_text(raw, scope).await;
            let key = key.trim();
            (!key.is_empty()).then(|| key.to_owned())
        }
        None => None,
    };

    Ok(PreparedInvocation {
        target_flow_id,
        input,
        idempotency_key,
        max_attempts: node.config_i64("max_attempts").unwrap_or(5).clamp(1, 20),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn node(config: serde_json::Value) -> FlowNode {
        FlowNode {
            id: "invoke-crm".into(),
            kind: "custom".into(),
            implementation: "integration.invoke".into(),
            name: "Send to CRM".into(),
            config,
        }
    }

    #[tokio::test]
    async fn materializes_the_payload_and_idempotency_key_from_the_same_scope() {
        let mut scope = Scope::for_integration(json!({ "call_id": "call-42" }));
        scope.record("Set lead", json!({ "name": "Mira", "score": 8 }));

        let prepared = prepare(
            &node(json!({
                "target_flow_id": "00000000-0000-4000-8000-000000000002",
                "input": "={{ $json }}",
                "idempotency_key": "=call/{{ $call.call_id }}",
                "max_attempts": 50
            })),
            &scope,
        )
        .await
        .expect("valid invocation");

        assert_eq!(prepared.input, json!({ "name": "Mira", "score": 8 }));
        assert_eq!(prepared.idempotency_key.as_deref(), Some("call/call-42"));
        assert_eq!(prepared.max_attempts, 20);
    }

    #[tokio::test]
    async fn invalid_json_is_refused_before_any_queue_request() {
        let scope = Scope::for_integration(json!({}));
        let error = prepare(
            &node(json!({
                "target_flow_id": "00000000-0000-4000-8000-000000000002",
                "input": "{not json}"
            })),
            &scope,
        )
        .await
        .expect_err("invalid input must not enqueue");

        assert!(error.contains("input is not JSON"), "{error}");
    }

    #[tokio::test]
    async fn a_missing_target_is_refused() {
        let scope = Scope::for_integration(json!({}));
        let error = prepare(&node(json!({ "input": "={}" })), &scope)
            .await
            .expect_err("a queue row needs a target");

        assert_eq!(error, "Invoke integration has no target flow");
    }

    #[test]
    fn reads_the_input_contract_from_the_only_invocation_trigger() {
        let contract = contract_from_snapshot(&json!({
            "graph": {
                "nodes": [{
                    "id": "input",
                    "implementation": "trigger.integration_invoked",
                    "config": {
                        "input_schema_id": "00000000-0000-4000-8000-000000000099",
                        "clinical_payload_kind": "person"
                    }
                }]
            }
        }))
        .expect("published integration contract");

        assert_eq!(contract.schema_id, "00000000-0000-4000-8000-000000000099");
        assert_eq!(contract.clinical_kind.as_deref(), Some("person"));
    }

    #[test]
    fn an_ambiguous_or_missing_invocation_trigger_is_rejected() {
        let missing = json!({ "graph": { "nodes": [] } });
        assert!(contract_from_snapshot(&missing).unwrap_err().contains("exactly one"));

        let duplicate = json!({ "graph": { "nodes": [
            { "implementation": "trigger.integration_invoked", "config": { "input_schema_id": "a" } },
            { "implementation": "trigger.integration_invoked", "config": { "input_schema_id": "b" } }
        ] } });
        assert!(contract_from_snapshot(&duplicate).unwrap_err().contains("exactly one"));
    }

    #[test]
    fn generic_schema_validation_enforces_required_types_and_closed_enums() {
        let schema = json!({
            "type": "object",
            "required": ["name", "priority", "tags"],
            "properties": {
                "name": { "type": "string" },
                "priority": { "type": "string", "enum": ["normal", "urgent"] },
                "tags": { "type": "array", "minItems": 1, "items": { "type": "string" } }
            }
        });

        validate_schema(&schema, &json!({ "name": "Mira", "priority": "urgent", "tags": ["lead"] })).expect("valid input");
        assert!(validate_schema(&schema, &json!({ "name": "Mira", "tags": ["lead"] }))
            .unwrap_err()
            .contains("priority"));
        assert!(validate_schema(&schema, &json!({ "name": 42, "priority": "later", "tags": ["lead"] }))
            .unwrap_err()
            .contains("name"));
        assert!(validate_schema(&schema, &json!({ "name": "Mira", "priority": "urgent", "tags": [] }))
            .unwrap_err()
            .contains("at least 1"));
    }

    #[test]
    fn a_vokoo_clinical_contract_uses_the_vendored_runtime_type() {
        let invalid = json!({ "id": "patient-1", "name": [], "birthDate": "1990-01-01" });
        assert!(validate_contract_payload(Some("person"), &json!({}), &invalid).is_err());
    }

    #[test]
    fn enqueue_body_carries_the_exact_validated_version_and_source_pin() {
        let source = InvocationSource {
            flow_id: Some("source-flow".into()),
            flow_version: Some(8),
            execution_id: "call:call-42".into(),
            call_id: Some("call-42".into()),
            node_id: "invoke-crm".into(),
        };
        let prepared = PreparedInvocation {
            target_flow_id: "target-flow".into(),
            input: json!({ "name": "Mira" }),
            idempotency_key: Some("lead-42".into()),
            max_attempts: 6,
        };
        let body = enqueue_body("org-1", &source, &prepared, 12);

        assert_eq!(body["p_target_flow_version"], 12);
        assert_eq!(body["p_source_flow_version"], 8);
        assert_eq!(body["p_input"], json!({ "name": "Mira" }));
    }

    #[test]
    fn only_transport_rate_limit_and_server_outcomes_are_retryable() {
        assert!(retryable_node_failure(
            "http.request",
            "unavailable",
            &json!({ "status": 503 })
        ));
        assert!(retryable_node_failure(
            "http.request",
            "refused",
            &json!({ "status": 429 })
        ));
        assert!(retryable_node_failure(
            "http.request",
            "failed",
            &json!({ "method": "POST", "problem": "connection reset" })
        ));
        assert!(!retryable_node_failure(
            "http.request",
            "refused",
            &json!({ "status": 422 })
        ));
        assert!(!retryable_node_failure(
            "http.request",
            "failed",
            &json!({ "problem": "not an http url" })
        ));
        assert!(!retryable_node_failure("code", "failed", &json!({})));
    }
}
