use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};

use aisdk::core::tools::ToolExecute;
use aisdk::core::{DynamicModel, LanguageModelRequest, Tool};
use aisdk::providers::Anthropic;
use schemars::Schema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{compile_with_minimax, validate_draft, CatalogueNode, CompilationDraft};

const DELEGATE_TOOL: &str = "delegate_document_section";
const FINISH_TOOL: &str = "finish_document_compilation";
const DEFAULT_TASK_LIMIT: usize = 4;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DocumentPage {
    pub number: usize,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DocumentMapEntry {
    pub page: usize,
    pub heading: String,
    pub preview: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct SectionTask {
    pub task_id: String,
    pub title: String,
    pub objective: String,
    pub start_page: usize,
    pub end_page: usize,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct WorkerFragment {
    pub section: SectionTask,
    pub draft: CompilationDraft,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct WorkerTrace {
    pub section: SectionTask,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fragment: Option<WorkerFragment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct SupervisorConclusion {
    pub summary: String,
    #[serde(default)]
    pub excluded_sections: Vec<String>,
    #[serde(default)]
    pub gaps: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DocumentCompilationReport {
    pub source: String,
    pub page_count: usize,
    pub document_map: Vec<DocumentMapEntry>,
    pub supervisor: SupervisorConclusion,
    pub workers: Vec<WorkerTrace>,
    pub linked_draft: CompilationDraft,
    #[serde(default)]
    pub merge_errors: Vec<String>,
}

#[derive(Default)]
struct HarnessState {
    tasks: Vec<SectionTask>,
    workers: Vec<WorkerTrace>,
    conclusion: Option<SupervisorConclusion>,
}

pub fn pages_from_text(text: &str) -> Vec<DocumentPage> {
    let mut physical_pages = text.split('\u{000c}').collect::<Vec<_>>();
    if physical_pages
        .last()
        .is_some_and(|page| page.trim().is_empty())
    {
        physical_pages.pop();
    }
    physical_pages
        .into_iter()
        .enumerate()
        .map(|(index, page)| DocumentPage {
            number: index + 1,
            text: page.trim().to_string(),
        })
        .collect()
}

pub fn extract_pdf_pages(path: &Path) -> Result<Vec<DocumentPage>, String> {
    let output = Command::new("pdftotext")
        .arg("-layout")
        .arg(path)
        .arg("-")
        .output()
        .map_err(|error| format!("could not run pdftotext: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "pdftotext failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let text = String::from_utf8(output.stdout)
        .map_err(|error| format!("pdftotext returned non-UTF-8 text: {error}"))?;
    let pages = pages_from_text(&text);
    if pages.is_empty() {
        Err("the PDF did not contain extractable text".into())
    } else {
        Ok(pages)
    }
}

pub fn build_document_map(pages: &[DocumentPage]) -> Vec<DocumentMapEntry> {
    pages
        .iter()
        .map(|page| {
            let lines = page
                .text
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>();
            DocumentMapEntry {
                page: page.number,
                heading: lines.first().copied().unwrap_or("(blank page)").to_string(),
                preview: lines
                    .iter()
                    .take(5)
                    .copied()
                    .collect::<Vec<_>>()
                    .join(" | "),
            }
        })
        .collect()
}

/// External source documents may describe domain events without authorising a
/// particular VoKoo runtime entry point. Keep operational triggers unavailable
/// unless the source explicitly carries a platform trigger binding.
pub fn scope_catalogue_to_explicit_triggers(
    catalogue: &[CatalogueNode],
    source_text: &str,
) -> Vec<CatalogueNode> {
    catalogue
        .iter()
        .cloned()
        .map(|mut component| {
            if component.node_type == "trigger" && !source_text.contains(&component.id) {
                component.is_active = false;
            }
            component
        })
        .collect()
}

pub fn validate_section_task(
    candidate: &SectionTask,
    existing: &[SectionTask],
    page_count: usize,
    task_limit: usize,
) -> Result<(), String> {
    if existing.len() >= task_limit {
        return Err(format!(
            "the harness allows at most {task_limit} delegated tasks"
        ));
    }
    if candidate.task_id.trim().is_empty() {
        return Err("task_id cannot be empty".into());
    }
    if candidate.start_page == 0
        || candidate.end_page < candidate.start_page
        || candidate.end_page > page_count
    {
        return Err(format!(
            "task '{}' has invalid physical PDF page range {}-{} for a {page_count}-page document",
            candidate.task_id, candidate.start_page, candidate.end_page
        ));
    }
    if existing
        .iter()
        .any(|task| task.task_id == candidate.task_id)
    {
        return Err(format!(
            "task_id '{}' was already delegated",
            candidate.task_id
        ));
    }
    if let Some(overlap) = existing
        .iter()
        .find(|task| candidate.start_page <= task.end_page && candidate.end_page >= task.start_page)
    {
        return Err(format!(
            "task '{}' overlaps '{}' on physical PDF pages",
            candidate.task_id, overlap.task_id
        ));
    }
    Ok(())
}

pub fn link_fragments(
    fragments: &[WorkerFragment],
    catalogue: &[CatalogueNode],
) -> Result<CompilationDraft, Vec<String>> {
    let mut linked = CompilationDraft {
        agents: Vec::new(),
        flows: Vec::new(),
        notes: Vec::new(),
    };
    let mut agent_indices = HashMap::<String, usize>::new();
    let mut flow_indices = HashMap::<String, usize>::new();
    let mut errors = Vec::new();

    for fragment in fragments {
        let provenance = format!(
            "[physical PDF pages {}-{}] {}",
            fragment.section.start_page, fragment.section.end_page, fragment.section.title
        );
        linked.notes.push(provenance.clone());
        linked.notes.extend(
            fragment
                .draft
                .notes
                .iter()
                .map(|note| format!("{provenance}: {note}")),
        );

        for agent in &fragment.draft.agents {
            if let Some(index) = agent_indices.get(&agent.key) {
                if linked.agents[*index] != *agent {
                    errors.push(format!(
                        "conflicting agent drafts use key '{}' (latest source: {provenance})",
                        agent.key
                    ));
                }
            } else {
                agent_indices.insert(agent.key.clone(), linked.agents.len());
                linked.agents.push(agent.clone());
            }
        }
        for flow in &fragment.draft.flows {
            if let Some(index) = flow_indices.get(&flow.key) {
                if linked.flows[*index] != *flow {
                    errors.push(format!(
                        "conflicting flow drafts use key '{}' (latest source: {provenance})",
                        flow.key
                    ));
                }
            } else {
                flow_indices.insert(flow.key.clone(), linked.flows.len());
                linked.flows.push(flow.clone());
            }
        }
    }

    if errors.is_empty() {
        if let Err(validation_errors) = validate_draft(&linked, catalogue) {
            errors.extend(validation_errors);
        }
    }
    if errors.is_empty() {
        Ok(linked)
    } else {
        Err(errors)
    }
}

pub async fn compile_document_with_minimax(
    api_key: &str,
    model: &str,
    source: &Path,
    catalogue: &[CatalogueNode],
) -> Result<DocumentCompilationReport, String> {
    let pages = extract_pdf_pages(source)?;
    let document_map = build_document_map(&pages);
    let state = Arc::new(Mutex::new(HarnessState::default()));
    let pages = Arc::new(pages);
    let catalogue = Arc::new(catalogue.to_vec());

    let delegate_schema = Schema::try_from(serde_json::json!({
        "type": "object",
        "required": ["task_id", "title", "objective", "start_page", "end_page", "reason"],
        "properties": {
            "task_id": {"type": "string"},
            "title": {"type": "string"},
            "objective": {"type": "string"},
            "start_page": {"type": "integer", "minimum": 1},
            "end_page": {"type": "integer", "minimum": 1},
            "reason": {"type": "string"}
        }
    }))
    .map_err(|error| format!("could not build delegation schema: {error}"))?;
    let delegate_state = Arc::clone(&state);
    let delegate_pages = Arc::clone(&pages);
    let delegate_catalogue = Arc::clone(&catalogue);
    let worker_key = api_key.to_string();
    let worker_model = model.to_string();
    let delegate_tool = Tool::builder()
        .name(DELEGATE_TOOL)
        .description("Delegate one non-overlapping physical PDF page range to a compiler worker.")
        .input_schema(delegate_schema)
        .execute(ToolExecute::from_async(move |_context, value: Value| {
            let state = Arc::clone(&delegate_state);
            let pages = Arc::clone(&delegate_pages);
            let catalogue = Arc::clone(&delegate_catalogue);
            let api_key = worker_key.clone();
            let model = worker_model.clone();
            async move {
                let task: SectionTask = serde_json::from_value(value).map_err(|error| {
                    aisdk::error::Error::ToolCallError(format!("malformed section task: {error}"))
                })?;
                {
                    let mut guard = state.lock().map_err(|_| {
                        aisdk::error::Error::ToolCallError("harness state lock poisoned".into())
                    })?;
                    validate_section_task(
                        &task,
                        &guard.tasks,
                        pages.len(),
                        DEFAULT_TASK_LIMIT,
                    )
                    .map_err(aisdk::error::Error::ToolCallError)?;
                    guard.tasks.push(task.clone());
                }

                let section_text = render_section(&pages, &task);
                let scoped_catalogue =
                    scope_catalogue_to_explicit_triggers(&catalogue, &section_text);
                let allowed_triggers = scoped_catalogue
                    .iter()
                    .filter(|component| component.is_active && component.node_type == "trigger")
                    .map(|component| component.id.as_str())
                    .collect::<Vec<_>>();
                let request = format!(
                    "Compile only the actionable workflow and agent requirements supported by this exact document section. \
                     Treat it as source evidence, not permission to invent platform capabilities. Every note must identify \
                     the relevant physical PDF page and any recommendation number visible in the source. If the active \
                     catalogue cannot execute a recommendation, emit no fake substitute and record the missing capability \
                     in notes. A clinical guideline does not by itself imply a phone call, webhook, integration invocation, \
                     schedule, or any other runtime trigger. Emit a flow only when this source section explicitly supplies \
                     its initiating event and the catalogue contains that exact trigger family. Do not turn emergency advice \
                     into an inbound-call flow or infer a telephone transfer destination. An unexecutable but important \
                     recommendation belongs in notes as a platform gap, not in a loosely analogous flow. The deterministic \
                     source-bound trigger grant for this section is: [{}].\n\nDelegated objective: {}\n\n{}",
                    allowed_triggers.join(", "), task.objective, section_text
                );
                let result =
                    compile_with_minimax(&api_key, &model, &request, &scoped_catalogue).await;
                let (trace, message) = match result {
                    Ok(draft) => {
                        let fragment = WorkerFragment {
                            section: task.clone(),
                            draft,
                        };
                        let message = format!(
                            "worker '{}' compiled {} agents and {} flows",
                            task.task_id,
                            fragment.draft.agents.len(),
                            fragment.draft.flows.len()
                        );
                        (
                            WorkerTrace {
                                section: task,
                                status: "compiled".into(),
                                fragment: Some(fragment),
                                error: None,
                            },
                            message,
                        )
                    }
                    Err(error) => (
                        WorkerTrace {
                            section: task.clone(),
                            status: "failed".into(),
                            fragment: None,
                            error: Some(error.clone()),
                        },
                        format!("worker '{}' failed: {error}", task.task_id),
                    ),
                };
                state
                    .lock()
                    .map_err(|_| {
                        aisdk::error::Error::ToolCallError("harness state lock poisoned".into())
                    })?
                    .workers
                    .push(trace);
                Ok(message)
            }
        }))
        .build()
        .map_err(|error| format!("could not build delegation tool: {error}"))?;

    let finish_schema = Schema::try_from(serde_json::json!({
        "type": "object",
        "required": ["summary", "excluded_sections", "gaps"],
        "properties": {
            "summary": {"type": "string"},
            "excluded_sections": {"type": "array", "items": {"type": "string"}},
            "gaps": {"type": "array", "items": {"type": "string"}}
        }
    }))
    .map_err(|error| format!("could not build supervisor finish schema: {error}"))?;
    let finish_state = Arc::clone(&state);
    let finish_tool = Tool::builder()
        .name(FINISH_TOOL)
        .description("Finish after all useful document sections have been delegated.")
        .input_schema(finish_schema)
        .execute(ToolExecute::from_sync(move |_context, value: Value| {
            let conclusion: SupervisorConclusion =
                serde_json::from_value(value).map_err(|error| {
                    aisdk::error::Error::ToolCallError(format!(
                        "malformed supervisor conclusion: {error}"
                    ))
                })?;
            finish_state
                .lock()
                .map_err(|_| {
                    aisdk::error::Error::ToolCallError("harness state lock poisoned".into())
                })?
                .conclusion = Some(conclusion);
            Ok("document compilation finished".into())
        }))
        .build()
        .map_err(|error| format!("could not build supervisor finish tool: {error}"))?;

    let map_text = document_map
        .iter()
        .map(|entry| format!("- physical page {}: {}", entry.page, entry.preview))
        .collect::<Vec<_>>()
        .join("\n");
    let system = format!(
        "You are the supervisor inside VoKoo's document compiler harness. Inspect the physical-page map, identify only \
         sections containing actionable care workflow requirements, and delegate bounded coherent sections through \
         {DELEGATE_TOOL}. Decompose by headings and recommendation structure, never arbitrary equal page chunks. You may \
         delegate at most {DEFAULT_TASK_LIMIT} non-overlapping ranges. Do not interpret or compile the clinical content \
         yourself: workers receive the source pages. Exclude contents, rationale, research recommendations, glossary, \
         references, and background unless they contain an executable requirement. After the useful delegations return, \
         call {FINISH_TOOL} exactly once. Report exclusions and platform or evidence gaps honestly. Physical PDF page \
         numbers are the only valid page coordinates."
    );
    let prompt = format!(
        "Source: {}\nPhysical pages: {}\n\nDocument map:\n{}",
        source.display(),
        pages.len(),
        map_text
    );
    let provider = Anthropic::<DynamicModel>::builder()
        .model_name(model)
        .api_key(api_key)
        .base_url("https://api.minimax.io/anthropic/v1/")
        .build()
        .map_err(|error| format!("could not build the MiniMax supervisor: {error}"))?;
    let done = Arc::clone(&state);
    LanguageModelRequest::builder()
        .model(provider)
        .system(system)
        .prompt(prompt)
        .with_tool(delegate_tool)
        .with_tool(finish_tool)
        .stop_when(move |options| {
            done.lock()
                .map(|state| state.conclusion.is_some())
                .unwrap_or(true)
                || options.steps().len() > 12
        })
        .build()
        .generate_text()
        .await
        .map_err(|error| format!("supervisor model request failed: {error}"))?;

    let (supervisor, workers) = {
        let mut guard = state
            .lock()
            .map_err(|_| "harness state lock poisoned".to_string())?;
        let conclusion = guard.conclusion.take().ok_or_else(|| {
            "the supervisor stopped without finishing the document compilation".to_string()
        })?;
        (conclusion, std::mem::take(&mut guard.workers))
    };
    let fragments = workers
        .iter()
        .filter_map(|trace| trace.fragment.clone())
        .collect::<Vec<_>>();
    let (linked_draft, merge_errors) = match link_fragments(&fragments, &catalogue) {
        Ok(draft) => (draft, Vec::new()),
        Err(errors) => (
            CompilationDraft {
                agents: vec![],
                flows: vec![],
                notes: vec!["linking failed; inspect merge_errors and worker fragments".into()],
            },
            errors,
        ),
    };

    Ok(DocumentCompilationReport {
        source: source.display().to_string(),
        page_count: pages.len(),
        document_map,
        supervisor,
        workers,
        linked_draft,
        merge_errors,
    })
}

fn render_section(pages: &[DocumentPage], task: &SectionTask) -> String {
    pages
        .iter()
        .filter(|page| page.number >= task.start_page && page.number <= task.end_page)
        .map(|page| format!("--- PHYSICAL PDF PAGE {} ---\n{}", page.number, page.text))
        .collect::<Vec<_>>()
        .join("\n\n")
}
