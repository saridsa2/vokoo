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
fn spellings(did: &str) -> Vec<String> {
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

/// The published flow for a DID, or `None` to fall back to the agent.
pub async fn resolve_for_did(base: &str, key: &str, did: &str) -> Option<Flow> {
    if base.is_empty() || key.is_empty() || did.is_empty() {
        return None;
    }
    match load(base, key, did).await {
        Ok(flow) => flow,
        Err(e) => {
            log::warn!("[flow] could not load a flow for {did} ({e}) — using the agent");
            None
        }
    }
}

async fn load(base: &str, key: &str, did: &str) -> Result<Option<Flow>, String> {
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
            ("select", "flow_id".into()),
            ("limit", "1".into()),
        ],
    )
    .await?;

    let Some(flow_id) = numbers.first().and_then(|n| n.get("flow_id")).and_then(Value::as_str)
    else {
        return Ok(None);
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
        .json(&serde_json::json!({ "p_org_id": org_id, "p_vendor": vendor }))
        .send()
        .await
        .ok()?;

    response.json::<Option<String>>().await.ok().flatten().filter(|s| !s.is_empty())
}
