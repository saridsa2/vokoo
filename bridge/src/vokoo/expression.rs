//! What a field may refer to, and who is allowed to run a script.
//!
//! n8n's model, and the reason it works: a node's parameter is either a literal
//! or an expression, expressions are written `{{ … }}` against a small set of
//! named roots, and there is exactly one evaluator behind all of them. IF, Set,
//! Loop and every HTTP field draw on the same machinery, so learning it once is
//! learning all of them.
//!
//! The roots:
//!
//! | | |
//! |---|---|
//! | `$json` | the previous node's output |
//! | `$('Process call')` | a named node's output |
//! | `$call` | the call itself — caller, transcript, duration, recording |
//! | `$vars` | what a `var` node has set |
//!
//! ## Two boards, one evaluator
//!
//! `vokoo_bridge` answers the phone and runs integrations in the same process,
//! so an evaluator linked into it shares an address space with the media path —
//! and the carrier ends the call if the bridge's socket errors. Author-written
//! code must therefore never run while somebody is on the line.
//!
//! That is [`Evaluation`], and it is a value the caller sets rather than a
//! second implementation: `runner.rs` builds a [`Evaluation::Paths`] scope,
//! `postcall.rs` builds a [`Evaluation::Script`] one. Both go through
//! [`resolve`]. A cheaper imitation of an evaluator is a second evaluator that
//! can disagree with the first, which this project has already paid for once.
//!
//! The catalogue gates the same rule independently — `code` is `{post_call}`,
//! so the calls palette never offers it. Two gates because a rule enforced in
//! one place is a rule the next screen forgets.

use serde_json::{Map, Value};

/// How far an expression may go.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Evaluation {
    /// Paths only: `{{ $json.patient_name }}` reads a value and nothing else.
    ///
    /// What a live call gets. There is no loop to run away and no program to
    /// take a thread, so the worst a typo does is resolve to empty.
    Paths,
    /// Full JavaScript, on the blocking pool.
    ///
    /// Integrations only. Nobody is waiting on one, and it must not be able to
    /// starve the runtime that is carrying calls.
    Script,
}

/// Everything a node may refer to, and what it may do with it.
#[derive(Clone, Debug)]
pub struct Scope {
    /// The previous node's output.
    pub json: Value,
    /// Every node's output so far, by the node's name on the canvas.
    pub nodes: Map<String, Value>,
    /// The call this flow is about.
    pub call: Value,
    /// What `var` nodes have set.
    pub vars: Map<String, Value>,
    pub evaluation: Evaluation,
}

impl Scope {
    /// A scope for a live call: the call's own facts, and no script.
    pub fn for_call(call: Value) -> Self {
        Self {
            json: Value::Null,
            nodes: Map::new(),
            call,
            vars: Map::new(),
            evaluation: Evaluation::Paths,
        }
    }

    /// A scope for an integration: nobody is waiting, so scripts are allowed.
    pub fn for_integration(call: Value) -> Self {
        Self {
            json: Value::Null,
            nodes: Map::new(),
            call,
            vars: Map::new(),
            evaluation: Evaluation::Script,
        }
    }

    /// Record what a node produced, and make it the new `$json`.
    pub fn record(&mut self, node_name: &str, output: Value) {
        self.nodes.insert(node_name.to_string(), output.clone());
        self.json = output;
    }

    pub fn set_var(&mut self, name: &str, value: Value) {
        self.vars.insert(name.to_string(), value);
    }

    /// The roots, as one object — what the evaluator is handed and what the
    /// console's data panel lists.
    fn roots(&self) -> Value {
        serde_json::json!({
            "json":  self.json,
            "nodes": self.nodes,
            "call":  self.call,
            "vars":  self.vars,
        })
    }
}

/// Whether a stored value is an expression.
///
/// A leading `=` marks one, which is n8n's own encoding. One character, no
/// migration, and every config written before expressions existed stays a
/// literal by construction.
pub fn is_expression(raw: &str) -> bool {
    raw.starts_with('=')
}

/// Resolve a stored config value against a scope.
///
/// A literal comes back as itself. An expression is resolved segment by
/// segment, and a value that is *entirely* one `{{ … }}` keeps its type — so
/// `={{ $json.score }}` is the number 8 and not the string "8". That
/// distinction is what lets an expression fill a JSON body without quoting
/// every number.
pub async fn resolve(raw: &str, scope: &Scope) -> Value {
    if !is_expression(raw) {
        return Value::String(raw.to_string());
    }
    let body = &raw[1..];

    match sole_segment(body) {
        Some(source) => evaluate(source, scope).await,
        None => Value::String(interpolate(body, scope).await),
    }
}

/// The same, when the caller needs text whatever the type.
pub async fn resolve_text(raw: &str, scope: &Scope) -> String {
    match resolve(raw, scope).await {
        Value::String(text) => text,
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// `{{ x }}` and nothing else, returning `x`.
fn sole_segment(body: &str) -> Option<&str> {
    let trimmed = body.trim();
    let inner = trimmed.strip_prefix("{{")?.strip_suffix("}}")?;
    // Two segments back to back are not one segment.
    if inner.contains("}}") {
        return None;
    }
    Some(inner.trim())
}

/// Replace every `{{ … }}` and keep the text around them.
async fn interpolate(template: &str, scope: &Scope) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;

    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            // An unclosed brace is the author's typo. Passing the rest through
            // unchanged is what shows it to them in the log.
            out.push_str("{{");
            rest = after;
            continue;
        };

        match evaluate(after[..end].trim(), scope).await {
            Value::Null => {}
            Value::String(text) => out.push_str(&text),
            other => out.push_str(&other.to_string()),
        }
        rest = &after[end + 2..];
    }

    out.push_str(rest);
    out
}

/// One expression, evaluated as far as this scope allows.
async fn evaluate(source: &str, scope: &Scope) -> Value {
    match scope.evaluation {
        Evaluation::Paths => read_path(source, scope),
        Evaluation::Script => run_script(source, scope).await,
    }
}

/// A path, and only a path: `$json.a.b`, `$call.caller`, `$vars.n`,
/// `$('Node name').field`.
///
/// Anything else resolves to null rather than being run. A live call reaches
/// this and nothing else.
fn read_path(source: &str, scope: &Scope) -> Value {
    let roots = scope.roots();
    let (root, rest) = split_root(source);

    let mut value = match root {
        Root::Json => roots.get("json").cloned().unwrap_or(Value::Null),
        Root::Call => roots.get("call").cloned().unwrap_or(Value::Null),
        Root::Vars => roots.get("vars").cloned().unwrap_or(Value::Null),
        Root::Node(name) => scope.nodes.get(&name).cloned().unwrap_or(Value::Null),
        Root::Unknown => return Value::Null,
    };

    for segment in rest.split('.').map(str::trim).filter(|s| !s.is_empty()) {
        value = value.get(segment).cloned().unwrap_or(Value::Null);
    }
    value
}

enum Root {
    Json,
    Call,
    Vars,
    Node(String),
    Unknown,
}

/// Split `$('A name').field.sub` or `$json.field` into its root and the rest.
fn split_root(source: &str) -> (Root, &str) {
    let source = source.trim();

    if let Some(after) = source.strip_prefix("$(") {
        // The name is quoted, and may contain a dot — so the closing quote is
        // what ends it, not the first `.`.
        let quote = match after.chars().next() {
            Some(character @ ('\'' | '"')) => character,
            _ => return (Root::Unknown, ""),
        };
        let body = &after[quote.len_utf8()..];
        let Some(close) = body.find(quote) else { return (Root::Unknown, "") };
        let name = &body[..close];
        let remainder = body[close + quote.len_utf8()..].trim_start();
        let remainder = remainder.strip_prefix(')').unwrap_or(remainder);
        return (Root::Node(name.to_string()), remainder.trim_start_matches('.'));
    }

    let (head, rest) = match source.find('.') {
        Some(at) => (&source[..at], &source[at + 1..]),
        None => (source, ""),
    };
    match head {
        "$json" => (Root::Json, rest),
        "$call" => (Root::Call, rest),
        "$vars" => (Root::Vars, rest),
        _ => (Root::Unknown, ""),
    }
}

/// JavaScript, on the blocking pool.
///
/// `spawn_blocking` and not a plain call: the engine is synchronous CPU work,
/// and an integration runs on the same tokio runtime that is carrying live
/// calls' audio. Evaluating it on a worker thread would block that worker; the
/// blocking pool is a separate one, so the worst an expensive expression does
/// is take longer.
async fn run_script(source: &str, scope: &Scope) -> Value {
    let source = source.to_string();
    let roots = scope.roots().to_string();

    let outcome = tokio::task::spawn_blocking(move || script(&source, &roots)).await;

    match outcome {
        Ok(Ok(value)) => value,
        Ok(Err(problem)) => {
            log::warn!("[expression] {problem}");
            Value::Null
        }
        Err(problem) => {
            log::warn!("[expression] the evaluator panicked: {problem}");
            Value::Null
        }
    }
}

/// One evaluation, start to finish, on the calling thread.
fn script(source: &str, roots_json: &str) -> Result<Value, String> {
    use boa_engine::{Context, Source};

    let mut context = Context::default();

    // A runaway expression must end by itself. These bound the two ways a
    // script does not return: looping and recursing. Straight-line code cannot
    // run forever, so between them there is no program that never finishes.
    context.runtime_limits_mut().set_loop_iteration_limit(100_000);
    context.runtime_limits_mut().set_recursion_limit(256);

    // The scope arrives as a JSON *string literal* parsed inside the engine,
    // rather than as source pasted into the program. Pasting would make any
    // value in a transcript able to close its own quote and become code.
    let encoded = serde_json::to_string(roots_json).map_err(|problem| problem.to_string())?;

    let program = format!(
        r#"
        (function () {{
          var __roots = JSON.parse({encoded});
          var $json = __roots.json, $call = __roots.call, $vars = __roots.vars;
          var __nodes = __roots.nodes;
          function $(name) {{
            if (!Object.prototype.hasOwnProperty.call(__nodes, name)) {{
              throw new Error("no node named '" + name + "' has produced anything yet");
            }}
            return __nodes[name];
          }}
          var __result = (function () {{ return ({source}); }})();
          return __result === undefined ? null : JSON.stringify(__result);
        }})()
        "#
    );

    let value = context
        .eval(Source::from_bytes(program.as_bytes()))
        .map_err(|problem| format!("{source} — {problem}"))?;

    if value.is_null() {
        return Ok(Value::Null);
    }
    let text = value
        .as_string()
        .ok_or_else(|| format!("{source} — did not return something that can be sent"))?
        .to_std_string()
        .map_err(|problem| problem.to_string())?;

    serde_json::from_str(&text).map_err(|problem| problem.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scope(evaluation: Evaluation) -> Scope {
        let mut scope = Scope {
            json: Value::Null,
            nodes: Map::new(),
            call: json!({ "caller": "+919949879837", "duration_secs": 90 }),
            vars: Map::new(),
            evaluation,
        };
        scope.record("Process call", json!({ "patient_name": "सात्या", "score": 8 }));
        scope.set_var("attempts", json!(2));
        scope
    }

    #[tokio::test]
    async fn a_literal_is_left_alone() {
        let scope = scope(Evaluation::Paths);
        assert_eq!(resolve("https://example.com/hook", &scope).await, json!("https://example.com/hook"));
        // Including one that merely contains braces.
        assert_eq!(resolve("{{ not an expression }}", &scope).await, json!("{{ not an expression }}"));
    }

    #[tokio::test]
    async fn a_sole_segment_keeps_its_type() {
        let scope = scope(Evaluation::Paths);
        assert_eq!(resolve("={{ $json.score }}", &scope).await, json!(8));
        assert_eq!(resolve("={{ $json.patient_name }}", &scope).await, json!("सात्या"));
    }

    #[tokio::test]
    async fn text_around_a_segment_makes_it_text() {
        let scope = scope(Evaluation::Paths);
        assert_eq!(
            resolve("=Lead for {{ $json.patient_name }} ({{ $call.caller }})", &scope).await,
            json!("Lead for सात्या (+919949879837)"),
        );
    }

    #[tokio::test]
    async fn every_root_resolves() {
        let scope = scope(Evaluation::Paths);
        assert_eq!(resolve("={{ $call.duration_secs }}", &scope).await, json!(90));
        assert_eq!(resolve("={{ $vars.attempts }}", &scope).await, json!(2));
        assert_eq!(resolve("={{ $('Process call').score }}", &scope).await, json!(8));
    }

    #[tokio::test]
    async fn a_missing_path_is_empty_rather_than_an_error() {
        // A body that is 90% right and one field short is more use to whoever
        // is debugging than no request at all.
        let scope = scope(Evaluation::Paths);
        assert_eq!(resolve("={{ $json.nothing_here }}", &scope).await, Value::Null);
        assert_eq!(resolve("=x{{ $json.nothing_here }}y", &scope).await, json!("xy"));
    }

    #[tokio::test]
    async fn a_live_call_does_not_run_a_script() {
        // The gate this module exists for. The same expression that computes on
        // an integration reads as a path on a call, finds nothing, and resolves
        // to null — it does not execute.
        let calling = scope(Evaluation::Paths);
        assert_eq!(resolve("={{ $json.score * 2 }}", &calling).await, Value::Null);

        let integrating = scope(Evaluation::Script);
        assert_eq!(resolve("={{ $json.score * 2 }}", &integrating).await, json!(16));
    }

    #[tokio::test]
    async fn a_script_can_use_the_language() {
        let scope = scope(Evaluation::Script);
        // Six, not five: `सात्या` is six UTF-16 code units — स ा त ् य ा —
        // because a vowel sign and a virama are characters of their own. JS
        // string length is what it has always been, and an expression written
        // against a Devanagari transcript will meet that.
        assert_eq!(
            resolve("={{ $json.patient_name.length }}", &scope).await,
            json!(6),
        );
        assert_eq!(
            resolve("={{ $call.duration_secs > 60 ? 'long' : 'short' }}", &scope).await,
            json!("long"),
        );
        assert_eq!(
            resolve("={{ Object.keys($json).sort().join(',') }}", &scope).await,
            json!("patient_name,score"),
        );
    }

    #[tokio::test]
    async fn a_whole_object_can_be_nested_into_a_body() {
        // What a Set node hands a webhook that wants the payload under a key.
        // A non-string substitutes as JSON, so the result parses.
        let mut scope = scope(Evaluation::Script);
        scope.record("Set lead", json!({ "contactName": "सात्या", "seconds": 90 }));

        let filled = resolve_text(r#"={"lead": {{ $json }}, "source": "phone"}"#, &scope).await;
        assert_eq!(
            serde_json::from_str::<Value>(&filled).expect("valid JSON"),
            json!({ "lead": { "contactName": "सात्या", "seconds": 90 }, "source": "phone" }),
        );
    }

    #[tokio::test]
    async fn a_runaway_loop_ends_by_itself() {
        let scope = scope(Evaluation::Script);
        // Returns null rather than never returning. The caller carries on.
        assert_eq!(resolve("={{ (function () { while (true) {} })() }}", &scope).await, Value::Null);
    }

    #[tokio::test]
    async fn a_transcript_cannot_become_code() {
        // The scope is parsed inside the engine rather than pasted into the
        // program, so a caller who says something quote-shaped stays data.
        let mut scope = scope(Evaluation::Script);
        scope.record("Process call", json!({ "note": "\"); throw new Error('run'); (\"" }));
        assert_eq!(
            resolve("={{ $json.note }}", &scope).await,
            json!("\"); throw new Error('run'); (\""),
        );
    }

    #[tokio::test]
    async fn a_node_that_has_not_run_is_named_in_the_error() {
        let scope = scope(Evaluation::Script);
        // Resolves to null, and the reason reaches the log rather than the flow.
        assert_eq!(resolve("={{ $('Nowhere').x }}", &scope).await, Value::Null);
    }
}
