//! The flow a number points at.
//!
//! Read over PostgREST rather than a direct Postgres connection: the bridge
//! already carries an HTTP client for the carrier, the service-role key is the
//! same credential the rest of the platform uses, and one fewer connection pool
//! is one fewer thing to exhaust on a two-core box.
//!
//! Every failure here returns `None` rather than an error. A number with no
//! flow, an unpublished flow, a database that cannot be reached — all mean the
//! same thing to a caller, and all have the same right answer: fall back to the
//! agent the number points at, which is how the line behaved before flows
//! existed. A call answered imperfectly beats a call that fails.

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

/// A registry entry: what a node offers and how it is run.
#[derive(Debug, Clone, Deserialize)]
pub struct NodeType {
    pub id: String,
    /// The primitive the engine runs: condition · loop · var · code · custom.
    pub node_type: String,
    pub label: String,
    /// The carrier endpoint this maps to, for carrier actions.
    pub provider_action: Option<String>,
    /// True when the node parks the flow until an event or a timeout.
    #[serde(default)]
    pub suspends: bool,
    pub default_timeout_seconds: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FlowNode {
    pub id: String,
    /// Which primitive the engine runs.
    #[serde(rename = "type")]
    pub kind: String,
    /// Which registry entry supplies this node's behaviour.
    pub implementation: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub config: Value,
}

impl FlowNode {
    pub fn config_str(&self, key: &str) -> Option<&str> {
        self.config.get(key)?.as_str()
    }

    pub fn config_bool(&self, key: &str, default: bool) -> bool {
        self.config.get(key).and_then(Value::as_bool).unwrap_or(default)
    }

    pub fn config_i64(&self, key: &str) -> Option<i64> {
        self.config.get(key)?.as_i64()
    }

    /// Branches the flow author wrote, as `(id, label)`.
    ///
    /// A menu's outcomes are not declared by its type — the composer stores one
    /// entry per key here and draws a port for each. A row without an id cannot
    /// be transitioned from, so it is dropped rather than carried as a branch
    /// nothing can leave by.
    pub fn config_branches(&self, key: &str) -> Vec<(String, String)> {
        self.config
            .get(key)
            .and_then(Value::as_array)
            .map(|rows| {
                rows.iter()
                    .filter_map(|row| {
                        let id = row.get("id")?.as_str()?.trim();
                        if id.is_empty() {
                            return None;
                        }
                        let label = row.get("label").and_then(Value::as_str).unwrap_or(id);
                        Some((id.to_string(), label.to_string()))
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

#[derive(Debug, Deserialize)]
struct Transition {
    from: String,
    outcome: String,
    to: String,
}

#[derive(Debug, Deserialize)]
struct Graph {
    #[serde(default)]
    start: String,
    #[serde(default)]
    nodes: Vec<FlowNode>,
    #[serde(default)]
    transitions: Vec<Transition>,
}

#[derive(Debug, Deserialize)]
struct FlowRow {
    id: String,
    org_id: String,
    name: String,
    graph: Graph,
}

pub struct Flow {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub start: String,
    nodes: HashMap<String, FlowNode>,
    /// (from, outcome) -> to. Keyed on the outcome, because that is the whole
    /// design: two lines leave one node for different reasons.
    transitions: HashMap<(String, String), String>,
    registry: HashMap<String, NodeType>,
}

impl Flow {
    pub fn node(&self, id: &str) -> Option<&FlowNode> {
        self.nodes.get(id)
    }

    pub fn definition(&self, node: &FlowNode) -> Option<&NodeType> {
        self.registry.get(&node.implementation)
    }

    pub fn next(&self, from: &str, outcome: &str) -> Option<&str> {
        self.transitions
            .get(&(from.to_string(), outcome.to_string()))
            .map(String::as_str)
    }
}

/// The DID as it might have been stored.
///
/// The carrier reports the called number without a plus and sometimes without
/// the country code, while the console stores whatever the operator typed.
/// Matching one spelling makes a number that is plainly present look unmapped.
/// Every way this number might be written in the database.
///
/// The carrier sends `918040802529`; the console stores `+918040802529`. An
/// exact match finds neither from the other, which is why anything looking a
/// number up goes through here rather than comparing strings.
pub(crate) fn spellings(did: &str) -> Vec<String> {
    let digits: String = did.chars().filter(char::is_ascii_digit).collect();
    let mut out = vec![did.to_string(), digits.clone(), format!("+{digits}")];
    if digits.len() >= 10 {
        let tail = &digits[digits.len() - 10..];
        out.push(tail.to_string());
        out.push(format!("91{tail}"));
        out.push(format!("+91{tail}"));
    }
    out.sort();
    out.dedup();
    out.retain(|s| !s.is_empty());
    out
}

/// One PostgREST select, for callers outside this module.
///
/// The client is built per call rather than shared: this is used by things that
/// happen once a call or once a registration, not per audio frame, and a
/// three-second ceiling on a query the caller is waiting behind is worth more
/// than a pooled connection.
pub async fn rows(
    base: &str,
    key: &str,
    path: &str,
    query: &[(&str, String)],
) -> Result<Vec<Value>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;
    get(&client, base, key, path, query).await
}

async fn get(
    client: &reqwest::Client,
    base: &str,
    key: &str,
    path: &str,
    query: &[(&str, String)],
) -> Result<Vec<Value>, String> {
    let response = client
        .get(format!("{base}/rest/v1/{path}"))
        .query(query)
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("{} {}", response.status(), response.text().await.unwrap_or_default()));
    }
    response.json::<Vec<Value>>().await.map_err(|e| e.to_string())
}

/// The event a flow handles. A call is the durable object; flows are handlers
/// bound to events on it, siblings rather than subflows.
pub const TRIGGER_ANSWERED: &str = "call.answered";
pub const TRIGGER_ENDED: &str = "call.ended";
/// The exception flow: what to do when the call cannot be served at all.
pub const TRIGGER_FAILED: &str = "call.failed";

/// The published flow that answers a DID, or `None` to fall back to the agent.
pub async fn resolve_for_did(base: &str, key: &str, did: &str) -> Option<Flow> {
    resolve_for_event(base, key, did, TRIGGER_ANSWERED).await
}

/// The published flow bound to one event on a DID.
///
/// `number_flows` binds a number to a flow per event, so a number can answer
/// with one flow and do its post-call work with another. Until that table
/// exists the lookup falls back to `phone_numbers.flow_id`, which only ever
/// meant the answering flow — so the fallback applies to `call.answered` and
/// nothing else. A post-call handler that silently ran the conversation flow
/// would put a caller-facing node on a call that has already ended.
pub async fn resolve_for_event(base: &str, key: &str, did: &str, trigger: &str) -> Option<Flow> {
    if base.is_empty() || key.is_empty() || did.is_empty() {
        return None;
    }
    match load(base, key, did, trigger).await {
        Ok(flow) => flow,
        Err(e) => {
            log::warn!("[flow] could not load a {trigger} flow for {did} ({e}) — using the agent");
            None
        }
    }
}

async fn load(base: &str, key: &str, did: &str, trigger: &str) -> Result<Option<Flow>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let numbers = get(
        &client,
        base,
        key,
        "phone_numbers",
        &[
            ("number", format!("in.({})", spellings(did).join(","))),
            ("select", "id,flow_id".into()),
            ("limit", "1".into()),
        ],
    )
    .await?;

    let Some(number) = numbers.first() else { return Ok(None) };
    let number_id = number.get("id").and_then(Value::as_str).unwrap_or_default();

    // The binding is asked first, and its absence is not an error: this runs
    // against databases from either side of the migration that introduces it.
    // A failed request here means the table is not there yet, which is a
    // different thing from the number having no handler for this event.
    let bound = match get(
        &client,
        base,
        key,
        "number_flows",
        &[
            ("phone_number_id", format!("eq.{number_id}")),
            ("trigger_event", format!("eq.{trigger}")),
            ("select", "flow_id".into()),
            ("limit", "1".into()),
        ],
    )
    .await
    {
        Ok(rows) => rows.first().and_then(|r| r.get("flow_id")).and_then(Value::as_str).map(str::to_owned),
        Err(e) => {
            log::debug!("[flow] no number_flows binding readable ({e}) — falling back to phone_numbers.flow_id");
            None
        }
    };

    let flow_id = match bound {
        Some(id) => id,
        // See resolve_for_event: the legacy pointer only ever meant the
        // answering flow.
        None if trigger == TRIGGER_ANSWERED => {
            let Some(id) = number.get("flow_id").and_then(Value::as_str) else { return Ok(None) };
            id.to_owned()
        }
        None => {
            log::info!("[flow] {did} has no {trigger} handler");
            return Ok(None);
        }
    };

    // Draft flows are excluded by the query rather than filtered after: a draft
    // must never answer a call, and letting one through here would put that
    // decision in the caller's hands.
    let rows = get(
        &client,
        base,
        key,
        "flows",
        &[
            ("id", format!("eq.{flow_id}")),
            ("status", "eq.published".into()),
            ("select", "id,org_id,name,graph".into()),
            ("limit", "1".into()),
        ],
    )
    .await?;

    let Some(row) = rows.into_iter().next() else {
        log::info!("[flow] {did} points at a flow that is not published — using the agent");
        return Ok(None);
    };
    let row: FlowRow = serde_json::from_value(row).map_err(|e| e.to_string())?;

    if row.graph.start.is_empty() || !row.graph.nodes.iter().any(|n| n.id == row.graph.start) {
        log::warn!("[flow] {} has no node to answer with — using the agent", row.name);
        return Ok(None);
    }

    let registry_rows = get(
        &client,
        base,
        key,
        "catalogue_node_types",
        &[
            ("is_active", "eq.true".into()),
            ("select", "id,node_type,label,provider_action,suspends,default_timeout_seconds".into()),
        ],
    )
    .await?;

    let registry = registry_rows
        .into_iter()
        .filter_map(|r| serde_json::from_value::<NodeType>(r).ok())
        .map(|t| (t.id.clone(), t))
        .collect();

    Ok(Some(Flow {
        id: row.id,
        org_id: row.org_id,
        name: row.name,
        start: row.graph.start,
        nodes: row.graph.nodes.into_iter().map(|n| (n.id.clone(), n)).collect(),
        transitions: row
            .graph
            .transitions
            .into_iter()
            .map(|t| ((t.from, t.outcome), t.to))
            .collect(),
        registry,
    }))
}

/// One flow by id, published or not.
///
/// For the dry run behind the console's node view. Draft is deliberate and is
/// the difference from `load`: a call must never reach a draft, which is why
/// that query filters on `status`, but testing a flow *before* publishing it is
/// the entire point of being able to test one.
pub async fn load_flow(base: &str, key: &str, flow_id: &str) -> Option<Flow> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;

    let rows = get(
        &client,
        base,
        key,
        "flows",
        &[
            ("id", format!("eq.{flow_id}")),
            ("select", "id,org_id,name,graph".into()),
            ("limit", "1".into()),
        ],
    )
    .await
    .ok()?;
    let row: FlowRow = serde_json::from_value(rows.into_iter().next()?).ok()?;

    let registry_rows = get(
        &client,
        base,
        key,
        "catalogue_node_types",
        &[
            ("is_active", "eq.true".into()),
            ("select", "id,node_type,label,provider_action,suspends,default_timeout_seconds".into()),
        ],
    )
    .await
    .ok()?;

    Some(Flow {
        id: row.id,
        org_id: row.org_id,
        name: row.name,
        start: row.graph.start,
        nodes: row.graph.nodes.into_iter().map(|n| (n.id.clone(), n)).collect(),
        transitions: row
            .graph
            .transitions
            .into_iter()
            .map(|t| ((t.from, t.outcome), t.to))
            .collect(),
        registry: registry_rows
            .into_iter()
            .filter_map(|r| serde_json::from_value::<NodeType>(r).ok())
            .map(|t| (t.id.clone(), t))
            .collect(),
    })
}

/// An organisation's key for a vendor, from the vault.
///
/// Read through a function only the service role may execute, so a key can be
/// written in the console and never read back by anyone signed in there.
/// The non-secret half of a carrier connection.
///
/// Ozonetel's call-control API needs the CloudAgent account's `userName` and
/// `agentPhoneName` alongside the key. Neither is a secret, both are per
/// organisation, and neither belongs in an environment variable — connecting
/// KooKoo in the console has to be the one place these are configured.
/// The provider's model id for an agent, from the catalogue.
///
/// `LIVE_MODEL` in `bridge.env` applies one model to every call, which is wrong
/// in two ways: a second agent cannot choose a different model, and an id
/// renamed by the provider needs a file edited on the server. The catalogue is
/// where that id belongs, so a rename becomes an `UPDATE`.
///
/// Two requests rather than one embedded query: `agents.model` names a
/// `catalogue_models.id` but is not a foreign key to it, so PostgREST has no
/// relationship to traverse.
///
/// `None` on anything unexpected — no such agent, a model missing from the
/// catalogue, a row marked inactive, a request that failed. The caller keeps
/// `LIVE_MODEL`, so a catalogue mistake degrades the call rather than silencing
/// the phone. The same contract `resolve_for_did` and `agent_prompt` follow.
/// How an agent hears and speaks.
///
/// The composition lives in the database and the implementations live here, the
/// same division `catalogue_node_types` uses for the flow vocabulary: an engine
/// built from providers this binary has is a row and needs no deploy.
///
/// Resolved per call, so changing an agent's engine takes effect on the next
/// call rather than the next restart.
#[derive(Debug, Clone)]
pub struct Engine {
    /// The row id. Carried because cost is reported per engine, and a name is
    /// not a key: two engines may share one, and renaming one would detach it
    /// from every call it had already run.
    pub id: String,
    pub name: String,
    /// `realtime` or `cascading`.
    pub mode: String,
    /// The stages, keyed by name. Read by whichever mode is in play.
    pub config: Value,
}

impl Engine {
    /// A value from one stage of the composition, e.g. `("realtime", "voice")`.
    pub fn get(&self, stage: &str, field: &str) -> Option<&str> {
        self.config.get(stage)?.get(field)?.as_str()
    }

    /// A number from a stage. The console writes these as JSON numbers, but a
    /// hand-edited row can hold a string, and a model parameter is not worth
    /// dropping a call over.
    pub fn get_f64(&self, stage: &str, field: &str) -> Option<f64> {
        let value = self.config.get(stage)?.get(field)?;
        value.as_f64().or_else(|| value.as_str()?.trim().parse().ok())
    }
}

/// The engine an agent runs on, with its provider model id already resolved.
///
/// Returns `None` for an agent with no engine, which keeps the behaviour it had
/// before engines existed: whatever the bridge's environment says. Removing that
/// fallback before every agent has an engine would take the phone down.
/// One engine by id, with the organisation that owns it.
///
/// `engine_for_agent` reaches an engine through the agent that runs on it, which
/// is the only route a call needs. Pre-flight has an engine and no agent — it
/// answers "would this work" before anything is attached to it.
pub async fn engine_by_id(base: &str, key: &str, engine_id: &str) -> Option<(Engine, String)> {
    if base.is_empty() || key.is_empty() || engine_id.is_empty() {
        return None;
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;

    let rows = get(
        &client,
        base,
        key,
        "engines",
        &[
            ("id", format!("eq.{engine_id}")),
            ("select", "name,mode,config,status,org_id".into()),
            ("limit", "1".into()),
        ],
    )
    .await
    .map_err(|e| log::warn!("[preflight] could not read engine {engine_id} ({e})"))
    .ok()?;

    let row = rows.first()?;
    // **Empty, not absent, when the engine is the platform's.**
    //
    // This was `row.get("org_id")?.as_str()?`, which is `None` on a null — so
    // the moment engines became platform-owned (0091) every pre-flight would
    // have returned "no such engine" for an engine that exists and works. The
    // caller then reports a broken engine with no reason a log can explain,
    // which is the shape of failure this project keeps writing down.
    //
    // An empty org is meaningful rather than missing: `resolve_vendor_secret`
    // takes null and goes straight to the platform's key, which is what a
    // platform engine should run on.
    let org = row
        .get("org_id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    Some((
        Engine {
            id: row.get("id").and_then(Value::as_str).unwrap_or_default().to_owned(),
            name: row.get("name")?.as_str()?.to_owned(),
            mode: row.get("mode")?.as_str()?.to_owned(),
            config: row.get("config").cloned().unwrap_or_else(|| serde_json::json!({})),
        },
        org,
    ))
}

pub async fn engine_for_agent(base: &str, key: &str, agent_id: &str) -> Option<Engine> {
    if base.is_empty() || key.is_empty() || agent_id.is_empty() {
        return None;
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;

    // One request: PostgREST embeds the engine through the foreign key, so this
    // does not cost a second round trip on a call somebody is waiting on.
    let rows = get(
        &client,
        base,
        key,
        "agents",
        &[
            ("id", format!("eq.{agent_id}")),
            ("select", "engines(id,name,mode,config,status)".into()),
            ("limit", "1".into()),
        ],
    )
    .await
    .map_err(|e| log::warn!("[engine] could not read agent {agent_id} ({e})"))
    .ok()?;

    let engine = rows.first()?.get("engines")?;
    if engine.is_null() {
        return None;
    }

    // A draft engine must not answer a call, the same rule a draft flow and a
    // draft skill already follow.
    if engine.get("status").and_then(Value::as_str) != Some("published") {
        log::warn!("[engine] agent {agent_id} points at a draft engine — using the environment");
        return None;
    }

    Some(Engine {
        id: engine.get("id").and_then(Value::as_str).unwrap_or_default().to_string(),
        name: engine.get("name").and_then(Value::as_str).unwrap_or("engine").to_string(),
        mode: engine.get("mode").and_then(Value::as_str)?.to_string(),
        config: engine.get("config").cloned().unwrap_or_else(|| serde_json::json!({})),
    })
}

/// A catalogue id turned into the provider's own model id.
///
/// Split out of `model_for_agent` so an engine can name a model the same way an
/// agent used to: a provider rename stays an `UPDATE` to one row rather than an
/// edit to `bridge.env` on the server.
pub async fn model_id(base: &str, key: &str, catalogue_id: &str) -> Option<String> {
    if base.is_empty() || key.is_empty() || catalogue_id.is_empty() {
        return None;
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;

    let models = get(
        &client,
        base,
        key,
        "catalogue_models",
        &[
            ("id", format!("eq.{catalogue_id}")),
            ("is_active", "eq.true".into()),
            ("select", "provider_model_id".into()),
            ("limit", "1".into()),
        ],
    )
    .await
    .ok()?;

    models
        .first()?
        .get("provider_model_id")
        .and_then(Value::as_str)
        .map(str::to_owned)
}

pub async fn model_for_agent(base: &str, key: &str, agent_id: &str) -> Option<String> {
    if base.is_empty() || key.is_empty() || agent_id.is_empty() {
        return None;
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;

    let agents = get(
        &client,
        base,
        key,
        "agents",
        &[
            ("id", format!("eq.{agent_id}")),
            ("select", "model".into()),
            ("limit", "1".into()),
        ],
    )
    .await
    .map_err(|e| log::warn!("[model] could not read agent {agent_id} ({e})"))
    .ok()?;

    let model_id = agents.first().and_then(|a| a.get("model")).and_then(Value::as_str)?;

    let models = get(
        &client,
        base,
        key,
        "catalogue_models",
        &[
            ("id", format!("eq.{model_id}")),
            ("is_active", "eq.true".into()),
            ("select", "provider_model_id".into()),
            ("limit", "1".into()),
        ],
    )
    .await
    .map_err(|e| log::warn!("[model] could not read the catalogue for {model_id} ({e})"))
    .ok()?;

    let resolved = models
        .first()
        .and_then(|m| m.get("provider_model_id"))
        .and_then(Value::as_str)
        .map(str::to_owned);

    if resolved.is_none() {
        log::warn!("[model] {model_id} is not an active row in catalogue_models");
    }
    resolved
}

/// The functions an agent may call, from its skills' tools.
///
/// A sibling of [`agent_prompt`]: the prompt names these tools in prose, and
/// until this existed nothing declared them, so the model was told about tools
/// it had no channel to invoke. It reported failures of work it had never been
/// able to attempt.
///
/// Each entry is `{ name, description, schema }`. `schema` is stored as a plain
/// JSON Schema, which is what a provider's `parameters` field takes — so it is
/// passed through rather than translated, and the model, the dispatcher's
/// validation and the composer's config form all read one declaration.
pub async fn agent_tools(base: &str, key: &str, agent_id: &str) -> Vec<Value> {
    if base.is_empty() || key.is_empty() || agent_id.is_empty() {
        return Vec::new();
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let response = client
        .post(format!("{base}/rest/v1/rpc/compose_agent_tools"))
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .json(&serde_json::json!({ "p_agent_id": agent_id }))
        .send()
        .await;

    // An empty list is the safe failure: the agent keeps its prompt and its
    // outcome function, and simply cannot act. Refusing the call instead would
    // trade a limited agent for no agent.
    match response {
        Ok(r) => r.json::<Vec<Value>>().await.unwrap_or_default(),
        Err(e) => {
            log::warn!("[tools] could not read declarations for agent {agent_id}: {e}");
            Vec::new()
        }
    }
}

/// The agent's instructions, with its skills folded in.
///
/// The bridge used to send a system prompt from its environment, so the skills
/// attached to an agent in the console never reached the model: it was told it
/// was a receptionist and left to invent what a receptionist there can do. It
/// invented differently on different calls — the same request for a
/// cardiologist was refused twice and accepted once.
///
/// `compose_agent_prompt` assembles the prompt, the skills, each skill's tools
/// and the closing instruction to escalate anything not on the list. That last
/// line is what makes an out-of-scope request a decision rather than a guess.
/// How the agent opens the call, and whether it opens at all.
///
/// The greeting used to be `GREETING_PROMPT` in `bridge.env`: one sentence for
/// every agent on every number, while the console had a First Message field per
/// agent that nothing read. This makes that field the one that decides.
///
/// `None` means the agent does not speak first — it connects and waits, which is
/// what "user speaks first" asks for.
pub async fn agent_greeting(base: &str, key: &str, agent_id: &str) -> Option<Option<String>> {
    if base.is_empty() || key.is_empty() {
        return None;
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;

    let rows = get(
        &client,
        base,
        key,
        "agents",
        &[
            ("id", format!("eq.{agent_id}")),
            ("select", "first_message,config".into()),
            ("limit", "1".into()),
        ],
    )
    .await
    .map_err(|e| log::warn!("[greeting] could not read agent {agent_id} ({e})"))
    .ok()?;

    let row = rows.first()?;
    let mode = row
        .get("config")
        .and_then(|c| c.get("first_message_mode"))
        .and_then(Value::as_str)
        .unwrap_or("agent-first");
    if mode == "user-first" {
        return Some(None);
    }

    let text = row.get("first_message").and_then(Value::as_str).unwrap_or("").trim();
    // An agent set to speak first with nothing to say still has to speak, or
    // KooKoo never starts streaming caller audio. Falling back to the
    // environment keeps that true.
    if text.is_empty() {
        return None;
    }
    Some(Some(format!(
        "The caller has just connected. Open the call by saying exactly this, and nothing more: {text}"
    )))
}

pub async fn agent_prompt(base: &str, key: &str, agent_id: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;

    let response = client
        .post(format!("{base}/rest/v1/rpc/compose_agent_prompt"))
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .json(&serde_json::json!({ "p_agent_id": agent_id }))
        .send()
        .await
        .ok()?;

    response.json::<Option<String>>().await.ok().flatten().filter(|s| !s.trim().is_empty())
}

pub async fn vendor_account(
    base: &str,
    key: &str,
    org_id: &str,
    vendor: &str,
) -> Option<serde_json::Value> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;

    let response = client
        .get(format!("{base}/rest/v1/vendor_credentials"))
        .query(&[
            ("select", "metadata"),
            ("org_id", &format!("eq.{org_id}")),
            ("vendor", &format!("eq.{vendor}")),
            ("limit", "1"),
        ])
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .await
        .ok()?;

    let rows: Vec<serde_json::Value> = response.json().await.ok()?;
    rows.into_iter().next().and_then(|r| r.get("metadata").cloned())
}

pub async fn vendor_secret(base: &str, key: &str, org_id: &str, vendor: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;

    let response = client
        .post(format!("{base}/rest/v1/rpc/resolve_vendor_secret"))
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        // Null rather than `""` for a platform engine: `p_org_id` is a uuid,
        // and an empty string fails the cast rather than resolving to the
        // platform's key. PostgREST would answer 400 and this would look like
        // a missing credential.
        .json(&serde_json::json!({
            "p_org_id": if org_id.is_empty() { Value::Null } else { Value::String(org_id.to_owned()) },
            "p_vendor": vendor,
        }))
        .send()
        .await
        .ok()?;

    response.json::<Option<String>>().await.ok().flatten().filter(|s| !s.is_empty())
}
