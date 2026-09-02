//! The node that gathers values, before something sends them.
//!
//! n8n's Set node. Its whole job is to separate *which values* from *where they
//! go*: a webhook whose body is a hand-written template hides the payload
//! inside a textarea, and two webhooks wanting the same payload write it twice.
//! A node that holds the shape makes it readable on the canvas and reusable by
//! whatever follows.
//!
//! Its output is the object it builds, which is why a webhook after it needs no
//! body at all — an empty body already means "send the previous step's output".

use serde_json::{Map, Value};

use super::expression::{resolve, Scope};
use super::graph::FlowNode;

/// Build the node's output from its assignments.
///
/// Every row is resolved against the scope, so a value is either a literal
/// somebody typed or an expression reaching back into earlier steps.
///
/// A row with no name is skipped rather than failing the node: half-written
/// rows are the normal state of something being filled in, and a flow that
/// refuses to run until every row is complete is a flow that cannot be tested
/// while it is being built.
pub async fn run(node: &FlowNode, scope: &Scope) -> (String, Value) {
    let rows = match node.config.get("assignments").and_then(Value::as_array) {
        Some(rows) => rows,
        None => {
            log::warn!("[set] '{}' has no values to set", node.name);
            return ("ok".to_string(), Value::Object(Map::new()));
        }
    };

    let mut built = Map::new();
    for row in rows {
        let Some(name) = row.get("name").and_then(Value::as_str).map(str::trim).filter(|n| !n.is_empty())
        else {
            continue;
        };

        // Anything not a string is already a value — a number typed into the
        // row, say — and only a string can carry the `=` that marks an
        // expression.
        let value = match row.get("value") {
            Some(Value::String(raw)) => resolve(raw, scope).await,
            Some(other) => other.clone(),
            None => Value::Null,
        };

        built.insert(name.to_string(), value);
    }

    log::info!("[set] {} value(s) from '{}'", built.len(), node.name);
    ("ok".to_string(), Value::Object(built))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn node(assignments: Value) -> FlowNode {
        serde_json::from_value(json!({
            "id": "n1",
            "type": "var",
            "implementation": "var",
            "name": "Set lead",
            "config": { "assignments": assignments },
        }))
        .expect("a node")
    }

    fn scope() -> Scope {
        let mut scope = Scope::for_integration(json!({ "caller": "+919949879837", "duration_secs": 90 }));
        scope.record("Process call", json!({ "patient_name": "सात्या", "doctor": "cardiologist", "score": 8 }));
        scope
    }

    #[tokio::test]
    async fn it_renames_values_for_whoever_receives_them() {
        // The point of the node: the reading calls it `patient_name`, the CRM
        // calls it `contactName`, and neither has to change.
        let node = node(json!([
            { "name": "contactName", "value": "={{ $json.patient_name }}" },
            { "name": "speciality",  "value": "={{ $json.doctor }}" },
            { "name": "phone",       "value": "={{ $call.caller }}" },
            { "name": "source",      "value": "phone" }
        ]));
        let (outcome, output) = run(&node, &scope()).await;

        assert_eq!(outcome, "ok");
        assert_eq!(
            output,
            json!({
                "contactName": "सात्या",
                "speciality": "cardiologist",
                "phone": "+919949879837",
                "source": "phone",
            }),
        );
    }

    #[tokio::test]
    async fn a_number_arrives_as_a_number() {
        // So the payload this builds is valid JSON without quoting everything.
        let node = node(json!([{ "name": "score", "value": "={{ $json.score }}" }]));
        let (_, output) = run(&node, &scope()).await;
        assert_eq!(output, json!({ "score": 8 }));
    }

    #[tokio::test]
    async fn a_half_written_row_does_not_stop_the_flow() {
        let node = node(json!([
            { "name": "",     "value": "={{ $json.doctor }}" },
            { "name": "kept", "value": "yes" }
        ]));
        let (outcome, output) = run(&node, &scope()).await;
        assert_eq!(outcome, "ok");
        assert_eq!(output, json!({ "kept": "yes" }));
    }

    #[tokio::test]
    async fn a_live_call_still_cannot_run_a_script() {
        // The gate holds through this node too: it resolves through the same
        // `resolve`, so the scope's policy travels with it.
        let mut calling = Scope::for_call(json!({ "caller": "+919949879837" }));
        calling.record("Menu", json!({ "score": 8 }));

        let node = node(json!([{ "name": "doubled", "value": "={{ $json.score * 2 }}" }]));
        let (_, output) = run(&node, &calling).await;
        assert_eq!(output, json!({ "doubled": null }));
    }
}
