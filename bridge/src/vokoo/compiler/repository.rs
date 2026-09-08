use std::fmt;

use async_trait::async_trait;
use reqwest::{Client, Method, Response, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::vokoo::documents::{DocumentEvidence, EvidenceChunk};

use super::{CatalogueSnapshot, CompilationOutput, CompilerInput, WorkspaceResources};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CompilerRunStatus {
    Queued,
    Planning,
    Compiling,
    Validating,
    Materializing,
    Completed,
    CompletedWithGaps,
    Failed,
    Cancelled,
}

impl CompilerRunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Planning => "planning",
            Self::Compiling => "compiling",
            Self::Validating => "validating",
            Self::Materializing => "materializing",
            Self::Completed => "completed",
            Self::CompletedWithGaps => "completed_with_gaps",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ClaimedCompilerRun {
    pub id: String,
    pub org_id: String,
    pub file_version_id: String,
    pub status: CompilerRunStatus,
    pub provider: String,
    pub model: String,
    pub catalogue_digest: String,
    pub input_snapshot: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StoredCompilerStep {
    pub sequence: usize,
    pub kind: String,
    pub status: String,
    #[serde(default)]
    pub result: Value,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompilerRepositoryError {
    message: String,
    retryable: bool,
}

impl CompilerRepositoryError {
    pub fn retryable(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retryable: true,
        }
    }
    pub fn permanent(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retryable: false,
        }
    }
    pub fn is_retryable(&self) -> bool {
        self.retryable
    }
}

impl fmt::Display for CompilerRepositoryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for CompilerRepositoryError {}

#[async_trait]
pub trait CompilerRepository: Send + Sync {
    async fn claim(
        &self,
        worker: &str,
    ) -> Result<Option<ClaimedCompilerRun>, CompilerRepositoryError>;
    async fn renew_lease(&self, run_id: &str, worker: &str) -> Result<(), CompilerRepositoryError>;
    async fn is_active(&self, run_id: &str, worker: &str) -> Result<bool, CompilerRepositoryError>;
    async fn load_input(
        &self,
        run: &ClaimedCompilerRun,
    ) -> Result<CompilerInput, CompilerRepositoryError>;
    async fn load_steps(
        &self,
        run_id: &str,
    ) -> Result<Vec<StoredCompilerStep>, CompilerRepositoryError>;
    async fn append_step(
        &self,
        run_id: &str,
        worker: &str,
        step: Value,
    ) -> Result<StoredCompilerStep, CompilerRepositoryError>;
    async fn advance(
        &self,
        run_id: &str,
        worker: &str,
        status: CompilerRunStatus,
    ) -> Result<(), CompilerRepositoryError>;
    async fn materialize(
        &self,
        run_id: &str,
        worker: &str,
        output: &CompilationOutput,
    ) -> Result<Value, CompilerRepositoryError>;
    async fn fail(
        &self,
        run_id: &str,
        worker: &str,
        code: &str,
        retryable: bool,
    ) -> Result<(), CompilerRepositoryError>;
}

pub struct PostgrestCompilerRepository {
    base_url: String,
    service_key: String,
    client: Client,
    lease_seconds: u64,
}

impl PostgrestCompilerRepository {
    pub fn new(
        base_url: impl Into<String>,
        service_key: impl Into<String>,
    ) -> Result<Self, CompilerRepositoryError> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|_| {
                CompilerRepositoryError::permanent("could not build compiler database client")
            })?;
        Ok(Self {
            base_url: base_url.into().trim_end_matches('/').into(),
            service_key: service_key.into(),
            client,
            lease_seconds: 300,
        })
    }
    fn request(&self, method: Method, path: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, format!("{}/rest/v1/{path}", self.base_url))
            .header("apikey", &self.service_key)
            .header("Authorization", format!("Bearer {}", self.service_key))
    }
    async fn rpc(&self, name: &str, body: Value) -> Result<Response, CompilerRepositoryError> {
        checked(
            self.request(Method::POST, &format!("rpc/{name}"))
                .json(&body),
        )
        .await
    }
}

async fn checked(request: reqwest::RequestBuilder) -> Result<Response, CompilerRepositoryError> {
    let response = request
        .send()
        .await
        .map_err(|_| CompilerRepositoryError::retryable("compiler database request failed"))?;
    if response.status().is_success() {
        return Ok(response);
    }
    let retryable = response.status().is_server_error()
        || response.status() == StatusCode::TOO_MANY_REQUESTS
        || response.status() == StatusCode::REQUEST_TIMEOUT;
    if retryable {
        Err(CompilerRepositoryError::retryable(
            "compiler database temporarily unavailable",
        ))
    } else {
        Err(CompilerRepositoryError::permanent(
            "compiler database rejected request",
        ))
    }
}

#[derive(Deserialize)]
struct ChunkRow {
    id: String,
    file_version_id: String,
    page_start: Option<usize>,
    page_end: Option<usize>,
    section_path: Vec<String>,
    content: String,
}

#[async_trait]
impl CompilerRepository for PostgrestCompilerRepository {
    async fn claim(
        &self,
        worker: &str,
    ) -> Result<Option<ClaimedCompilerRun>, CompilerRepositoryError> {
        self.rpc(
            "claim_compiler_run",
            json!({"p_worker":worker,"p_lease_seconds":self.lease_seconds}),
        )
        .await?
        .json()
        .await
        .map_err(|_| CompilerRepositoryError::permanent("invalid compiler claim response"))
    }
    async fn renew_lease(&self, run_id: &str, worker: &str) -> Result<(), CompilerRepositoryError> {
        let renewed: bool = self
            .rpc(
                "renew_compiler_run_lease",
                json!({"p_run_id":run_id,"p_worker":worker,"p_lease_seconds":self.lease_seconds}),
            )
            .await?
            .json()
            .await
            .map_err(|_| CompilerRepositoryError::permanent("invalid compiler lease response"))?;
        if renewed {
            Ok(())
        } else {
            Err(CompilerRepositoryError::permanent(
                "compiler run lease was lost",
            ))
        }
    }
    async fn is_active(&self, run_id: &str, worker: &str) -> Result<bool, CompilerRepositoryError> {
        let rows: Vec<Value> = checked(self.request(Method::GET, "compiler_runs").query(&[
            ("select", "id"),
            ("id", &format!("eq.{run_id}")),
            ("lease_owner", &format!("eq.{worker}")),
            ("status", "in.(planning,compiling,validating,materializing)"),
        ]))
        .await?
        .json()
        .await
        .map_err(|_| CompilerRepositoryError::permanent("invalid compiler status response"))?;
        Ok(rows.len() == 1)
    }
    async fn load_input(
        &self,
        run: &ClaimedCompilerRun,
    ) -> Result<CompilerInput, CompilerRepositoryError> {
        let rows: Vec<ChunkRow> = checked(self.request(Method::GET, "document_chunks").query(&[
            (
                "select",
                "id,file_version_id,page_start,page_end,section_path,content",
            ),
            ("file_version_id", &format!("eq.{}", run.file_version_id)),
            ("order", "ordinal.asc"),
        ]))
        .await?
        .json()
        .await
        .map_err(|_| CompilerRepositoryError::permanent("invalid compiler chunk response"))?;
        let chunks = rows
            .into_iter()
            .map(|row| EvidenceChunk {
                chunk_id: row.id,
                version_id: row.file_version_id,
                page_start: row.page_start,
                page_end: row.page_end,
                section_path: row.section_path,
                text: row.content,
            })
            .collect::<Vec<_>>();
        let outline = chunks
            .iter()
            .flat_map(|chunk| chunk.section_path.iter().cloned())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        let nodes = run
            .input_snapshot
            .get("catalogue")
            .cloned()
            .unwrap_or_else(|| json!([]));
        let catalogue = CatalogueSnapshot {
            digest: run.catalogue_digest.clone(),
            nodes: serde_json::from_value(nodes).map_err(|_| {
                CompilerRepositoryError::permanent("invalid frozen compiler catalogue")
            })?,
        };
        let resources = parse_resources(
            run.input_snapshot
                .get("resources")
                .cloned()
                .unwrap_or_else(|| json!({})),
        )?;
        Ok(CompilerInput {
            run_id: run.id.clone(),
            version_id: run.file_version_id.clone(),
            evidence: DocumentEvidence {
                outline,
                representative_chunks: chunks,
                compiler_matches: vec!["care_path".into()],
            },
            catalogue,
            resources,
        })
    }
    async fn load_steps(
        &self,
        run_id: &str,
    ) -> Result<Vec<StoredCompilerStep>, CompilerRepositoryError> {
        checked(self.request(Method::GET, "compiler_steps").query(&[
            ("select", "sequence,kind,status,result"),
            ("run_id", &format!("eq.{run_id}")),
            ("order", "sequence.asc"),
        ]))
        .await?
        .json()
        .await
        .map_err(|_| CompilerRepositoryError::permanent("invalid compiler steps response"))
    }
    async fn append_step(
        &self,
        run_id: &str,
        worker: &str,
        step: Value,
    ) -> Result<StoredCompilerStep, CompilerRepositoryError> {
        self.rpc(
            "append_compiler_step",
            json!({"p_run_id":run_id,"p_worker":worker,"p_step":step}),
        )
        .await?
        .json()
        .await
        .map_err(|_| CompilerRepositoryError::permanent("invalid appended compiler step"))
    }
    async fn advance(
        &self,
        run_id: &str,
        worker: &str,
        status: CompilerRunStatus,
    ) -> Result<(), CompilerRepositoryError> {
        self.rpc(
            "advance_compiler_run",
            json!({"p_run_id":run_id,"p_worker":worker,"p_status":status.as_str()}),
        )
        .await?;
        Ok(())
    }
    async fn materialize(
        &self,
        run_id: &str,
        worker: &str,
        output: &CompilationOutput,
    ) -> Result<Value, CompilerRepositoryError> {
        self.rpc("materialize_care_path_compilation",json!({"p_run_id":run_id,"p_worker":worker,"p_agents":output.agents,"p_flows":output.flows,"p_gaps":output.gaps,"p_evidence":output.evidence})).await?.json().await.map_err(|_| CompilerRepositoryError::permanent("invalid materialization response"))
    }
    async fn fail(
        &self,
        run_id: &str,
        worker: &str,
        code: &str,
        retryable: bool,
    ) -> Result<(), CompilerRepositoryError> {
        self.rpc("fail_compiler_run",json!({"p_run_id":run_id,"p_worker":worker,"p_code":code,"p_detail":code,"p_retryable":retryable})).await?;
        Ok(())
    }
}

fn parse_resources(value: Value) -> Result<WorkspaceResources, CompilerRepositoryError> {
    fn strings(value: Option<&Value>) -> std::collections::BTreeSet<String> {
        value
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect()
    }
    Ok(WorkspaceResources {
        published_agent_ids: strings(value.get("agents")),
        structured_output_ids: strings(value.get("schemas")),
        tool_ids: strings(value.get("tools")),
        integration_flow_ids: strings(value.get("integrations")),
    })
}
