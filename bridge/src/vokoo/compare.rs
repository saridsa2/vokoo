//! One comparison, used by `condition` and by `loop`.
//!
//! Structured — left operand, operator, right operand — rather than a language.
//! That was settled on 1 September and is the reason `condition` may sit on a
//! call board at all: comparing two values needs no evaluator, so on a live call
//! each side resolves as a path and the comparison itself is Rust. The same row
//! on an integration resolves through the scripted scope, so its operands may
//! compute. One row, one meaning, two amounts of power on either side of it.
//!
//! A typo degrades one operand instead of failing the node — `{{ $json.nam }}`
//! is null, the comparison is false, and the flow takes its other branch. On a
//! live call that is the difference between a wrong turn and a dropped caller.

use serde_json::Value;

use super::expression::{resolve, Scope};
use super::graph::FlowNode;

/// Whether the node's comparison holds.
pub async fn holds(node: &FlowNode, scope: &Scope) -> bool {
    let operator = node.config_str("operator").unwrap_or("equals");
    let left = operand(node, "left", scope).await;
    let right = operand(node, "right", scope).await;
    evaluate(&left, operator, &right)
}

async fn operand(node: &FlowNode, key: &str, scope: &Scope) -> Value {
    match node.config.get(key) {
        Some(Value::String(raw)) => resolve(raw, scope).await,
        Some(other) => other.clone(),
        None => Value::Null,
    }
}

/// Compare two resolved values.
///
/// Split out so it is testable without a scope, and so the whole table of
/// operators is in one place rather than spread through the runner.
pub fn evaluate(left: &Value, operator: &str, right: &Value) -> bool {
    match operator {
        // Operators that take one operand. Listed first because otherwise an
        // empty `right` would be compared against and always disagree.
        "is_empty" => is_empty(left),
        "is_not_empty" => !is_empty(left),
        "is_true" => truthy(left),
        "is_false" => !truthy(left),

        "equals" => same(left, right),
        "not_equals" => !same(left, right),

        "contains" => text(left).contains(&text(right)),
        "not_contains" => !text(left).contains(&text(right)),
        "starts_with" => text(left).starts_with(&text(right)),

        // Numbers where both sides are numbers, and text otherwise — so
        // "at least" works on a duration and on a name without the author
        // choosing which kind of comparison they meant.
        "gt" | "gte" | "lt" | "lte" => match (number(left), number(right)) {
            (Some(a), Some(b)) => match operator {
                "gt" => a > b,
                "gte" => a >= b,
                "lt" => a < b,
                _ => a <= b,
            },
            _ => {
                let (a, b) = (text(left), text(right));
                match operator {
                    "gt" => a > b,
                    "gte" => a >= b,
                    "lt" => a < b,
                    _ => a <= b,
                }
            }
        },

        other => {
            log::warn!("[compare] '{other}' is not an operator — treating the comparison as false");
            false
        }
    }
}

/// Equal, comparing a number to its own text rather than refusing.
///
/// A schema field is a string and a literal typed into the row is a string, but
/// `$call.duration_secs` is a number. Making `90` and `"90"` disagree would be
/// technically right and useless.
fn same(left: &Value, right: &Value) -> bool {
    if left == right {
        return true;
    }
    match (number(left), number(right)) {
        (Some(a), Some(b)) => a == b,
        _ => text(left) == text(right),
    }
}

fn is_empty(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(text) => text.trim().is_empty(),
        Value::Array(items) => items.is_empty(),
        Value::Object(fields) => fields.is_empty(),
        _ => false,
    }
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Bool(held) => *held,
        Value::Null => false,
        Value::Number(n) => n.as_f64().map(|n| n != 0.0).unwrap_or(false),
        // "false" from a model or a form is the string, not the boolean.
        Value::String(text) => !matches!(text.trim().to_ascii_lowercase().as_str(), "" | "false" | "0" | "no"),
        _ => true,
    }
}

fn number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(n) => n.as_f64(),
        Value::String(text) => text.trim().parse().ok(),
        Value::Bool(held) => Some(if *held { 1.0 } else { 0.0 }),
        _ => None,
    }
}

fn text(value: &Value) -> String {
    match value {
        Value::String(held) => held.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_number_and_its_own_text_are_equal() {
        // `$call.duration_secs` is a number; anything typed into the row is a
        // string. Making these disagree would be right and useless.
        assert!(evaluate(&json!(90), "equals", &json!("90")));
        assert!(evaluate(&json!("90"), "gte", &json!(60)));
    }

    #[test]
    fn text_compares_as_text_when_it_is_not_a_number() {
        assert!(evaluate(&json!("cardiologist"), "contains", &json!("cardio")));
        assert!(evaluate(&json!("Satya"), "starts_with", &json!("Sat")));
        assert!(!evaluate(&json!("book"), "equals", &json!("cancel")));
    }

    #[test]
    fn the_one_sided_operators_ignore_the_right_hand_side() {
        // The row leaves `right` empty for these, and an empty right must not
        // make them all false.
        assert!(evaluate(&Value::Null, "is_empty", &Value::Null));
        assert!(evaluate(&json!("  "), "is_empty", &Value::Null));
        assert!(evaluate(&json!("Satya"), "is_not_empty", &Value::Null));
        assert!(evaluate(&json!(true), "is_true", &Value::Null));
        assert!(evaluate(&json!(false), "is_false", &Value::Null));
    }

    #[test]
    fn a_model_writing_false_as_text_still_reads_as_false() {
        assert!(evaluate(&json!("false"), "is_false", &Value::Null));
        assert!(evaluate(&json!(""), "is_false", &Value::Null));
        assert!(!evaluate(&json!("false"), "is_true", &Value::Null));
    }

    #[test]
    fn an_unknown_operator_is_false_rather_than_a_panic() {
        // A graph published against a newer catalogue must take a branch, not
        // end the call.
        assert!(!evaluate(&json!("x"), "sounds_like", &json!("x")));
    }

    #[tokio::test]
    async fn a_missing_path_degrades_one_operand() {
        // The whole reason this is a row and not a language: a typo makes one
        // side null and the comparison false. The flow takes its other branch
        // instead of failing on a live call.
        let scope = Scope::for_call(json!({ "caller": "+919949879837" }));
        let node: FlowNode = serde_json::from_value(json!({
            "id": "n", "type": "condition", "implementation": "condition", "name": "Is it Satya",
            "config": { "left": "={{ $json.nam }}", "operator": "equals", "right": "Satya" },
        }))
        .unwrap();
        assert!(!holds(&node, &scope).await);
    }

    #[tokio::test]
    async fn both_sides_may_be_expressions() {
        let mut scope = Scope::for_integration(json!({ "duration_secs": 90 }));
        scope.record("Process call", json!({ "intent": "book", "follow_up_needed": false }));

        let node = |left: &str, op: &str, right: &str| -> FlowNode {
            serde_json::from_value(json!({
                "id": "n", "type": "condition", "implementation": "condition", "name": "c",
                "config": { "left": left, "operator": op, "right": right },
            }))
            .unwrap()
        };

        assert!(holds(&node("={{ $json.intent }}", "equals", "book"), &scope).await);
        assert!(holds(&node("={{ $call.duration_secs }}", "gt", "60"), &scope).await);
        assert!(holds(&node("={{ $json.follow_up_needed }}", "is_false", ""), &scope).await);
        assert!(!holds(&node("={{ $json.intent }}", "equals", "cancel"), &scope).await);
    }

    #[tokio::test]
    async fn a_live_call_compares_without_running_anything() {
        // `Paths` on a call board: the operand reads a value and no script is
        // evaluated, so the comparison is available where the evaluator is not.
        let mut scope = Scope::for_call(json!({}));
        scope.record("Menu", json!({ "key": "2" }));
        let node: FlowNode = serde_json::from_value(json!({
            "id": "n", "type": "condition", "implementation": "condition", "name": "c",
            "config": { "left": "={{ $json.key }}", "operator": "equals", "right": "2" },
        }))
        .unwrap();
        assert!(holds(&node, &scope).await);
    }
}
