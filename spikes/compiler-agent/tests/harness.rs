use vokoo_compiler_spike::{
    link_fragments, pages_from_text, scope_catalogue_to_explicit_triggers, validate_section_task,
    AgentDraft, CatalogueNode, CompilationDraft, SectionTask, WorkerFragment,
};

fn task(id: &str, start_page: usize, end_page: usize) -> SectionTask {
    SectionTask {
        task_id: id.into(),
        title: format!("Section {id}"),
        objective: "Compile actionable recommendations only".into(),
        start_page,
        end_page,
        reason: "Contains recommendations".into(),
    }
}

fn agent(key: &str, instructions: &str) -> AgentDraft {
    AgentDraft {
        key: key.into(),
        name: key.into(),
        instructions: instructions.into(),
        first_message: "Hello".into(),
    }
}

fn fragment(section: SectionTask, agents: Vec<AgentDraft>) -> WorkerFragment {
    WorkerFragment {
        section,
        draft: CompilationDraft {
            agents,
            flows: vec![],
            notes: vec![],
        },
    }
}

#[test]
fn splits_extracted_pdf_text_into_physical_pages() {
    let pages = pages_from_text("Cover\n\x0cRecommendations\n1.1 First visit\n\x0cLast page\n");

    assert_eq!(pages.len(), 3);
    assert_eq!(pages[0].number, 1);
    assert_eq!(pages[1].number, 2);
    assert!(pages[1].text.contains("1.1 First visit"));
}

#[test]
fn preserves_blank_physical_pages_in_page_coordinates() {
    let pages = pages_from_text("First\n\x0c   \n\x0cThird\n");

    assert_eq!(pages.len(), 3);
    assert_eq!(pages[1].number, 2);
    assert!(pages[1].text.is_empty());
    assert_eq!(pages[2].number, 3);
}

#[test]
fn rejects_out_of_bounds_and_overlapping_delegations() {
    let existing = vec![task("maternal-care", 6, 12)];

    assert!(validate_section_task(&task("bad-range", 0, 2), &existing, 20, 4).is_err());
    assert!(validate_section_task(&task("overlap", 12, 15), &existing, 20, 4).is_err());
    assert!(validate_section_task(&task("baby-care", 13, 18), &existing, 20, 4).is_ok());
}

#[test]
fn rejects_more_tasks_than_the_harness_budget() {
    let existing = vec![task("one", 1, 1), task("two", 2, 2)];

    let error = validate_section_task(&task("three", 3, 3), &existing, 10, 2)
        .expect_err("the supervisor must respect the bounded delegation budget");

    assert!(error.contains("at most 2"));
}

#[test]
fn linker_deduplicates_identical_agent_drafts() {
    let shared = agent("postnatal-check", "Assess recovery");
    let linked = link_fragments(
        &[
            fragment(task("one", 1, 1), vec![shared.clone()]),
            fragment(task("two", 2, 2), vec![shared]),
        ],
        &[],
    )
    .expect("identical artifacts from adjacent sections should merge");

    assert_eq!(linked.agents.len(), 1);
}

#[test]
fn linker_rejects_conflicting_artifacts_with_the_same_key() {
    let error = link_fragments(
        &[
            fragment(task("one", 1, 1), vec![agent("follow-up", "Call tomorrow")]),
            fragment(
                task("two", 2, 2),
                vec![agent("follow-up", "Call next week")],
            ),
        ],
        &[],
    )
    .expect_err("a key collision must not silently choose one clinical interpretation");

    assert!(error.iter().any(|message| message.contains("follow-up")));
}

#[test]
fn document_workers_only_receive_triggers_explicitly_named_in_the_source() {
    let catalogue: Vec<CatalogueNode> = serde_json::from_value(serde_json::json!([
        {
            "id": "trigger.call_answered",
            "node_type": "trigger",
            "families": ["call"]
        },
        {
            "id": "agent",
            "node_type": "custom",
            "families": ["call"]
        }
    ]))
    .unwrap();

    let without_grant = scope_catalogue_to_explicit_triggers(
        &catalogue,
        "Parents should contact emergency services if the baby is seriously ill.",
    );
    assert!(!without_grant[0].is_active);
    assert!(without_grant[1].is_active);

    let with_grant =
        scope_catalogue_to_explicit_triggers(&catalogue, "Platform binding: trigger.call_answered");
    assert!(with_grant[0].is_active);
}
