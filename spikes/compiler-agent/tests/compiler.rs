use vokoo_compiler_spike::{emission_schema, validate_draft, CatalogueNode, CompilationDraft};

fn catalogue() -> Vec<CatalogueNode> {
    serde_json::from_value(serde_json::json!([
        {
            "id": "trigger.call_answered",
            "node_type": "trigger",
            "families": ["call"],
            "outcomes": [{"id": "started"}],
            "is_active": true
        },
        {
            "id": "agent",
            "node_type": "custom",
            "families": ["call"],
            "outcomes": [{"id": "completed"}],
            "is_active": true
        },
        {
            "id": "http.request",
            "node_type": "custom",
            "families": ["integration"],
            "outcomes": [{"id": "accepted"}],
            "is_active": true
        },
        {
            "id": "kookoo.transfer",
            "node_type": "custom",
            "families": ["call"],
            "fields": [{"key": "phoneno", "required": true}],
            "outcomes": [{"id": "connected"}],
            "is_active": true
        },
        {
            "id": "retired.node",
            "node_type": "custom",
            "families": ["call"],
            "outcomes": [],
            "is_active": false
        }
    ]))
    .unwrap()
}

#[test]
fn rejects_a_component_from_a_different_flow_family() {
    let errors = validate_draft(&draft("http.request"), &catalogue())
        .expect_err("an integration component cannot appear in a call flow");

    assert!(errors.iter().any(|error| error.contains("family 'call'")));
}

#[test]
fn rejects_an_agent_node_that_does_not_reference_an_emitted_agent() {
    let mut candidate = draft("agent");
    candidate.flows[0].nodes[1].agent_key = Some("invented-agent".into());

    let errors = validate_draft(&candidate, &catalogue())
        .expect_err("flow agent references must resolve inside the compilation");

    assert!(errors.iter().any(|error| error.contains("invented-agent")));
}

#[test]
fn rejects_an_edge_outcome_the_source_component_does_not_expose() {
    let mut candidate = draft("agent");
    candidate.flows[0].edges[0].outcome = "invented_outcome".into();

    let errors = validate_draft(&candidate, &catalogue())
        .expect_err("edge outcomes must come from the catalogue");

    assert!(errors
        .iter()
        .any(|error| error.contains("invented_outcome")));
}

#[test]
fn tool_schema_offers_only_active_catalogue_component_ids() {
    let schema = emission_schema(&catalogue());
    let component_ids = schema
        .pointer("/properties/flows/items/properties/nodes/items/properties/component/enum")
        .and_then(serde_json::Value::as_array)
        .expect("component must be a runtime catalogue enum");

    assert!(component_ids.iter().any(|id| id == "agent"));
    assert!(component_ids.iter().any(|id| id == "trigger.call_answered"));
    assert!(!component_ids.iter().any(|id| id == "retired.node"));
}

#[test]
fn accepts_a_valid_agent_and_flow_draft() {
    validate_draft(&draft("agent"), &catalogue()).expect("the platform can represent this draft");
}

#[test]
fn rejects_a_node_missing_required_catalogue_configuration() {
    let mut candidate = draft("agent");
    candidate.flows[0].nodes.push(
        serde_json::from_value(serde_json::json!({
            "key": "handoff",
            "component": "kookoo.transfer",
            "name": "Transfer to staff",
            "config": {}
        }))
        .unwrap(),
    );

    let errors = validate_draft(&candidate, &catalogue())
        .expect_err("a real component with unusable configuration must be rejected");

    assert!(errors.iter().any(|error| error.contains("phoneno")));
}

#[test]
fn reads_the_platforms_checked_in_catalogue() {
    let catalogue: Vec<CatalogueNode> =
        serde_json::from_str(include_str!("../../../docs/flow-node-catalogue.json"))
            .expect("the compiler must consume the catalogue format the platform actually ships");

    assert!(catalogue
        .iter()
        .any(|component| component.id == "kookoo.transfer"));
}

#[test]
fn rejects_a_flow_without_a_predefined_trigger() {
    let mut candidate = draft("agent");
    candidate.flows[0].nodes.remove(0);
    candidate.flows[0].edges.clear();

    let errors = validate_draft(&candidate, &catalogue())
        .expect_err("an inert collection of nodes is not an executable flow");

    assert!(errors
        .iter()
        .any(|error| error.contains("has no active trigger")));
}

fn draft(component: &str) -> CompilationDraft {
    serde_json::from_value(serde_json::json!({
        "agents": [{
            "key": "follow-up-agent",
            "name": "Follow-up agent",
            "instructions": "Ask the approved follow-up questions.",
            "first_message": "Hello, I am calling for your follow-up."
        }],
        "flows": [{
            "key": "follow-up-flow",
            "name": "Follow-up flow",
            "family": "call",
            "nodes": [
                {"key": "start", "component": "trigger.call_answered", "name": "Call answered"},
                {"key": "conversation", "component": component, "name": "Follow up", "agent_key": "follow-up-agent"}
            ],
            "edges": [{"source": "start", "outcome": "started", "target": "conversation"}]
        }]
    })).unwrap()
}

#[test]
fn rejects_a_component_the_platform_does_not_define() {
    let errors = validate_draft(&draft("compiler.invented_node"), &catalogue())
        .expect_err("an invented component must be rejected");

    assert!(errors
        .iter()
        .any(|error| error.contains("compiler.invented_node")));
}
