use rustvani::vokoo::compiler::{
    lower, validate_output, Action, ActionOperation, AgentConversation,
    CapabilityResolutionSnapshot, CarePathProgram, CatalogueField, CatalogueNode, CatalogueOutcome,
    CatalogueSnapshot, CompletionSpec, EvidenceRef, EvidenceRole, FailurePolicy, GapSeverity,
    Population, Recommendation, RequestActor, Threshold, TriggerOperation, TriggerSpec,
    WorkspaceResources,
};
use serde_json::{json, Value};

fn evidence(chunk_id: &str, excerpt: &str, role: EvidenceRole) -> EvidenceRef {
    EvidenceRef {
        chunk_id: chunk_id.into(),
        recommendation_id: "NG28-1.6.1".into(),
        excerpt: excerpt.into(),
        role,
    }
}

fn field(key: &str, field_type: &str, required: bool, options: &[&str]) -> CatalogueField {
    CatalogueField {
        key: key.into(),
        field_type: field_type.into(),
        required,
        default: None,
        options: options.iter().map(|id| json!({ "id": id })).collect(),
    }
}

fn node(
    id: &str,
    node_type: &str,
    outcomes: &[&str],
    fields: Vec<CatalogueField>,
) -> CatalogueNode {
    CatalogueNode {
        id: id.into(),
        node_type: node_type.into(),
        families: vec!["care_path".into()],
        outcomes: outcomes
            .iter()
            .map(|id| CatalogueOutcome { id: (*id).into() })
            .collect(),
        fields,
        outcomes_from: None,
        output: "opaque".into(),
        suspends: false,
        is_active: true,
    }
}

fn catalogue() -> CatalogueSnapshot {
    CatalogueSnapshot {
        digest: "catalogue-v1".into(),
        nodes: vec![
            node(
                "trigger.recurring",
                "trigger",
                &["due"],
                vec![
                    field("key", "text", true, &[]),
                    field(
                        "anchor",
                        "select",
                        true,
                        &[
                            "enrolment",
                            "birth",
                            "transfer_of_care",
                            "discharge",
                            "treatment_start",
                        ],
                    ),
                    field("every_days", "number", true, &[]),
                ],
            ),
            node(
                "outreach.request",
                "custom",
                &["fulfilled", "declined", "expired", "failed"],
                vec![
                    field(
                        "what",
                        "select",
                        true,
                        &[
                            "attendance",
                            "lab_report",
                            "imaging_report",
                            "test",
                            "medication_review",
                            "other",
                        ],
                    ),
                    field("instructions", "template", true, &[]),
                    field("expires_days", "number", true, &[]),
                ],
            ),
            node(
                "care_path.complete",
                "custom",
                &["completed", "not_found", "failed"],
                vec![field("milestone_key", "text", true, &[])],
            ),
            node(
                "escalate.notify",
                "custom",
                &["notified", "failed"],
                vec![
                    field(
                        "to",
                        "select",
                        true,
                        &["primary_team", "on_call", "clinician", "coordinator"],
                    ),
                    field(
                        "urgency",
                        "select",
                        true,
                        &["routine", "soon", "urgent", "immediate"],
                    ),
                    field("note", "template", true, &[]),
                ],
            ),
            node(
                "agent",
                "custom",
                &[
                    "done",
                    "out_of_scope",
                    "wants_human",
                    "failed",
                    "gone_quiet",
                    "timeout",
                ],
                vec![field("agent_id", "agent", true, &[])],
            ),
        ],
    }
}

fn hba1c_program(actions: Vec<Action>) -> CarePathProgram {
    let timing = evidence(
        "chunk-monitoring",
        "Measure HbA1c every 3 to 6 months until stable.",
        EvidenceRole::Timing,
    );
    CarePathProgram {
        title: "NG28 HbA1c monitoring".into(),
        recommendations: vec![Recommendation {
            id: "NG28-1.6.1".into(),
            title: "HbA1c monitoring".into(),
            population: Population {
                description: "Adults with type 2 diabetes".into(),
                inclusions: vec![],
                exclusions: vec![],
                evidence: vec![evidence(
                    "chunk-population",
                    "Adults with type 2 diabetes.",
                    EvidenceRole::Population,
                )],
            },
            trigger: TriggerSpec {
                key: "hba1c-monitoring".into(),
                operation: TriggerOperation::Recurring {
                    anchor: "enrolment".into(),
                    every_days: 90,
                },
                evidence: vec![timing],
            },
            thresholds: vec![],
            actions,
            completion: Some(CompletionSpec {
                milestone_key: "hba1c-monitoring".into(),
                evidence: vec![evidence(
                    "chunk-monitoring",
                    "Continue until stable.",
                    EvidenceRole::Requirement,
                )],
            }),
            failure_policy: Some(FailurePolicy {
                recipient: "primary_team".into(),
                urgency: "soon".into(),
                note: "Review an incomplete HbA1c request.".into(),
                evidence: vec![evidence(
                    "chunk-follow-up",
                    "Review people who do not complete monitoring.",
                    EvidenceRole::Escalation,
                )],
            }),
            evidence: vec![evidence(
                "chunk-monitoring",
                "Agree an individualised HbA1c target.",
                EvidenceRole::Requirement,
            )],
        }],
    }
}

fn clinical_task_resolution() -> CapabilityResolutionSnapshot {
    CapabilityResolutionSnapshot {
        id: "00000000-0000-4000-8000-000000000001".into(),
        recommendation_id: "NG28-1.6.1".into(),
        capability_key: "clinical.task".into(),
        adapter_key: "clinical-task-escalate-notify-v1".into(),
        adapter_version: 1,
        node_type_id: "escalate.notify".into(),
        mapping: json!({"to":"clinician","urgency":"soon"}),
    }
}

#[test]
fn recurring_request_lowers_to_real_components_and_safe_branches() {
    let program = hba1c_program(vec![Action {
        key: "request-hba1c".into(),
        operation: ActionOperation::Request {
            actor: RequestActor::Patient,
            what: "test".into(),
            instructions: "Complete an HbA1c test.".into(),
            expires_days: 7,
        },
        evidence: vec![evidence(
            "chunk-monitoring",
            "Measure HbA1c every 3 to 6 months until stable.",
            EvidenceRole::Requirement,
        )],
    }]);

    let output = lower(&program, &catalogue(), &WorkspaceResources::default(), &[]);
    assert!(output.gaps.is_empty(), "unexpected gaps: {:?}", output.gaps);
    assert_eq!(output.flows.len(), 1);
    assert!(output.agents.is_empty());

    let graph = &output.flows[0].graph;
    let implementations = graph
        .nodes
        .iter()
        .map(|node| node.implementation.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        implementations,
        vec![
            "trigger.recurring",
            "outreach.request",
            "care_path.complete",
            "escalate.notify"
        ]
    );
    for outcome in ["declined", "expired", "failed"] {
        assert!(graph.transitions.iter().any(|edge| {
            edge.from == "request-hba1c"
                && edge.outcome == outcome
                && edge.to == "ng28-1-6-1-escalation"
        }));
    }
    assert!(graph.transitions.iter().any(|edge| {
        edge.from == "request-hba1c"
            && edge.outcome == "fulfilled"
            && edge.to == "ng28-1-6-1-complete"
    }));
    assert!(validate_output(&output, &catalogue(), &program).is_ok());
}

#[test]
fn clinician_directed_requests_do_not_become_patient_outreach() {
    let program = hba1c_program(vec![Action {
        key: "order-genotyping".into(),
        operation: ActionOperation::Request {
            actor: RequestActor::Clinician,
            what: "test".into(),
            instructions: "Order CYP3A5 genotyping.".into(),
            expires_days: 7,
        },
        evidence: vec![evidence(
            "chunk-monitoring",
            "Clinicians should order CYP3A5 genotyping.",
            EvidenceRole::Requirement,
        )],
    }]);

    let output = lower(&program, &catalogue(), &WorkspaceResources::default(), &[]);

    assert!(output.flows.is_empty());
    assert_eq!(output.gaps.len(), 1);
    assert_eq!(output.gaps[0].code, "unsupported_action_actor");
    assert_eq!(output.gaps[0].severity, GapSeverity::Blocking);
    assert_eq!(
        output.gaps[0].missing_capability.as_deref(),
        Some("clinical.task")
    );
    assert_eq!(
        output.gaps[0].details,
        json!({
            "actor": "clinician",
            "action_key": "order-genotyping",
            "what": "test",
            "instructions": "Order CYP3A5 genotyping.",
            "expires_days": 7
        })
    );

    let resolved = lower(
        &program,
        &catalogue(),
        &WorkspaceResources::default(),
        &[clinical_task_resolution()],
    );
    assert!(resolved
        .gaps
        .iter()
        .all(|gap| gap.code != "unsupported_action_actor"));
    assert_eq!(resolved.flows.len(), 1);
    let task = resolved.flows[0]
        .graph
        .nodes
        .iter()
        .find(|node| node.id == "order-genotyping")
        .expect("resolved clinician task");
    assert_eq!(task.implementation, "escalate.notify");
    assert_eq!(task.config["to"], "clinician");
    assert_eq!(task.config["urgency"], "soon");
    assert_eq!(task.config["note"], "Order CYP3A5 genotyping.");
    assert!(resolved.flows[0].graph.transitions.iter().any(|edge| {
        edge.from == "order-genotyping"
            && edge.outcome == "failed"
            && edge.to == "ng28-1-6-1-escalation"
    }));
}

#[test]
fn rejects_invalid_clinical_task_resolution_snapshots() {
    let program = hba1c_program(vec![Action {
        key: "review-prophylaxis".into(),
        operation: ActionOperation::Request {
            actor: RequestActor::CareTeam,
            what: "medication_review".into(),
            instructions: "Review prophylaxis with the transplant team.".into(),
            expires_days: 3,
        },
        evidence: vec![evidence(
            "chunk-monitoring",
            "The transplant team should review prophylaxis.",
            EvidenceRole::Requirement,
        )],
    }]);
    let mut invalid = Vec::new();
    let mut wrong_capability = clinical_task_resolution();
    wrong_capability.capability_key = "clinical.threshold_mapping".into();
    invalid.push(wrong_capability);
    let mut wrong_version = clinical_task_resolution();
    wrong_version.adapter_version = 2;
    invalid.push(wrong_version);
    let mut wrong_node = clinical_task_resolution();
    wrong_node.node_type_id = "outreach.request".into();
    invalid.push(wrong_node);
    let mut extra_mapping = clinical_task_resolution();
    extra_mapping.mapping = json!({"to":"clinician","urgency":"soon","extra":true});
    invalid.push(extra_mapping);

    for resolution in invalid {
        let output = lower(
            &program,
            &catalogue(),
            &WorkspaceResources::default(),
            &[resolution],
        );
        assert!(output.flows.is_empty());
        assert_eq!(output.gaps[0].code, "unsupported_action_actor");
    }

    let mut inactive_catalogue = catalogue();
    inactive_catalogue
        .nodes
        .iter_mut()
        .find(|node| node.id == "escalate.notify")
        .unwrap()
        .is_active = false;
    let output = lower(
        &program,
        &inactive_catalogue,
        &WorkspaceResources::default(),
        &[clinical_task_resolution()],
    );
    assert!(output.flows.is_empty());
    assert_eq!(output.gaps[0].code, "unsupported_action_actor");
}

#[test]
fn unsupported_action_becomes_a_gap_without_an_approximate_node() {
    let program = hba1c_program(vec![
        Action {
            key: "request-hba1c".into(),
            operation: ActionOperation::Request {
                actor: RequestActor::Patient,
                what: "test".into(),
                instructions: "Complete an HbA1c test.".into(),
                expires_days: 7,
            },
            evidence: vec![evidence(
                "chunk-monitoring",
                "Measure HbA1c every 3 to 6 months until stable.",
                EvidenceRole::Requirement,
            )],
        },
        Action {
            key: "order-lab".into(),
            operation: ActionOperation::Unsupported {
                capability: "laboratory.order".into(),
                description: "Order the HbA1c laboratory test".into(),
            },
            evidence: vec![evidence(
                "chunk-monitoring",
                "Arrange an HbA1c measurement.",
                EvidenceRole::Requirement,
            )],
        },
    ]);

    let output = lower(&program, &catalogue(), &WorkspaceResources::default(), &[]);
    assert_eq!(output.gaps.len(), 1);
    assert_eq!(output.gaps[0].code, "missing_capability");
    assert_eq!(
        output.gaps[0].missing_capability.as_deref(),
        Some("laboratory.order")
    );
    assert!(output.flows[0]
        .graph
        .nodes
        .iter()
        .all(|node| node.implementation != "laboratory.order"));
}

#[test]
fn repeated_threshold_gaps_share_one_materialization_identity() {
    let mut program = hba1c_program(vec![Action {
        key: "request-hba1c".into(),
        operation: ActionOperation::Request {
            actor: RequestActor::Patient,
            what: "test".into(),
            instructions: "Complete an HbA1c test.".into(),
            expires_days: 7,
        },
        evidence: vec![evidence(
            "chunk-monitoring",
            "Measure HbA1c every 3 to 6 months until stable.",
            EvidenceRole::Requirement,
        )],
    }]);
    program.recommendations[0].thresholds = vec![
        Threshold {
            observation: "frailty".into(),
            operator: "equals".into(),
            value: json!(true),
            unit: "boolean".into(),
            evidence: vec![evidence(
                "chunk-frailty-1",
                "Assess frailty before treatment.",
                EvidenceRole::Threshold,
            )],
        },
        Threshold {
            observation: "medicine-risk".into(),
            operator: "equals".into(),
            value: json!("high"),
            unit: "category".into(),
            evidence: vec![evidence(
                "chunk-frailty-2",
                "Review medicine risk for people with frailty.",
                EvidenceRole::Threshold,
            )],
        },
    ];

    let output = lower(&program, &catalogue(), &WorkspaceResources::default(), &[]);
    let threshold_gaps = output
        .gaps
        .iter()
        .filter(|gap| gap.code == "threshold_requires_mapping")
        .collect::<Vec<_>>();

    assert_eq!(threshold_gaps.len(), 1);
    assert_eq!(threshold_gaps[0].evidence.len(), 2);
    assert_eq!(
        threshold_gaps[0].details,
        json!({
            "observation": "frailty",
            "operator": "equals",
            "value": true,
            "unit": "boolean"
        })
    );
}

#[test]
fn conversational_action_creates_a_linked_draft_agent() {
    let program = hba1c_program(vec![Action {
        key: "review-conversation".into(),
        operation: ActionOperation::Conversation(AgentConversation {
            name: "HbA1c review".into(),
            system_prompt: "Discuss only the cited HbA1c monitoring requirement.".into(),
            first_message: "Let us review your HbA1c monitoring.".into(),
        }),
        evidence: vec![evidence(
            "chunk-monitoring",
            "Agree an individualised HbA1c target.",
            EvidenceRole::Requirement,
        )],
    }]);
    let encoded = serde_json::to_value(&program).expect("serialize source-bound program");
    let decoded: CarePathProgram =
        serde_json::from_value(encoded).expect("deserialize source-bound program");
    assert_eq!(decoded, program);

    let output = lower(&program, &catalogue(), &WorkspaceResources::default(), &[]);
    assert_eq!(output.agents.len(), 1);
    let agent = &output.agents[0];
    let node = output.flows[0]
        .graph
        .nodes
        .iter()
        .find(|node| node.id == "review-conversation")
        .expect("agent node");
    assert_eq!(node.agent_key.as_deref(), Some(agent.key.as_str()));
    assert_eq!(node.config, Value::Object(Default::default()));
    assert!(output.evidence.iter().any(|link| {
        link.artifact_key == agent.key && link.target_path == "agent.system_prompt"
    }));
    assert!(validate_output(&output, &catalogue(), &program).is_ok());
}

#[test]
fn validation_rejects_invented_uncited_and_unsafe_output() {
    let program = hba1c_program(vec![Action {
        key: "request-hba1c".into(),
        operation: ActionOperation::Request {
            actor: RequestActor::Patient,
            what: "test".into(),
            instructions: "Complete an HbA1c test.".into(),
            expires_days: 7,
        },
        evidence: vec![evidence(
            "chunk-monitoring",
            "Measure HbA1c every 3 to 6 months until stable.",
            EvidenceRole::Requirement,
        )],
    }]);
    let mut output = lower(&program, &catalogue(), &WorkspaceResources::default(), &[]);
    output.flows[0].graph.nodes[2].implementation = "laboratory.order".into();
    output.flows[0]
        .graph
        .transitions
        .retain(|edge| !(edge.from == "request-hba1c" && edge.outcome == "expired"));
    output.evidence.retain(|link| {
        !(link.artifact_key == output.flows[0].key
            && link.target_path == "flow.nodes.request-hba1c")
    });

    let errors = validate_output(&output, &catalogue(), &program).expect_err("invalid output");
    let codes = errors
        .iter()
        .map(|error| error.code.as_str())
        .collect::<Vec<_>>();
    assert!(codes.contains(&"unknown_component"));
    assert!(codes.contains(&"missing_provenance"));
    assert!(codes.contains(&"unsafe_clinical_terminal"));
}
