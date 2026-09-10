use std::fmt;
use std::sync::{Arc, Mutex};

use aisdk::core::tools::ToolExecute;
use aisdk::core::{DynamicModel, LanguageModelRequest, Tool};
use aisdk::providers::{Anthropic, OpenAI};
use async_trait::async_trait;
use schemars::Schema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ModelPhase {
    Supervising,
    Compiling,
    Reconciling,
    Finishing,
}

#[derive(Clone)]
pub struct ModelRequest {
    pub phase: ModelPhase,
    pub task_id: Option<String>,
    pub tool_name: String,
    pub tool_description: String,
    pub schema: Value,
    pub system: String,
    pub payload: Value,
    /// A stable error code only. Source content and provider prose never enter it.
    pub correction: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct TokenUsage {
    pub input_tokens: Option<usize>,
    pub output_tokens: Option<usize>,
}

#[derive(Clone)]
pub struct ModelResponse {
    pub tool_name: String,
    pub arguments: Value,
    pub usage: TokenUsage,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompilerError {
    code: String,
    detail: String,
}

impl CompilerError {
    pub fn new(code: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            detail: detail.into(),
        }
    }

    pub fn model(code: impl Into<String>) -> Self {
        let code = code.into();
        Self::new(code.clone(), code)
    }

    pub fn code(&self) -> &str {
        &self.code
    }
}

impl fmt::Display for CompilerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.detail)
    }
}

impl std::error::Error for CompilerError {}

#[async_trait]
pub trait CompilerModel: Send + Sync {
    async fn call(&self, request: ModelRequest) -> Result<ModelResponse, CompilerError>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Provider {
    Anthropic,
    Minimax,
    OpenAi,
}

/// AISDK boundary for compiler calls. The secret must already have been resolved
/// through the service-role operator configuration before construction.
pub struct AisdkCompilerModel {
    provider: Provider,
    model: String,
    secret: String,
}

impl AisdkCompilerModel {
    pub fn new(
        provider: &str,
        model: impl Into<String>,
        resolved_secret: impl Into<String>,
    ) -> Result<Self, CompilerError> {
        let provider = match provider.trim().to_ascii_lowercase().as_str() {
            "anthropic" => Provider::Anthropic,
            "minimax" => Provider::Minimax,
            "openai" => Provider::OpenAi,
            _ => return Err(CompilerError::new("unsupported_provider", provider)),
        };
        let model = model.into();
        let secret = resolved_secret.into();
        if model.trim().is_empty() || secret.trim().is_empty() {
            return Err(CompilerError::new(
                "invalid_model_configuration",
                "model and resolved secret are required",
            ));
        }
        Ok(Self {
            provider,
            model,
            secret,
        })
    }
}

#[async_trait]
impl CompilerModel for AisdkCompilerModel {
    async fn call(&self, request: ModelRequest) -> Result<ModelResponse, CompilerError> {
        let schema = Schema::try_from(request.schema.clone())
            .map_err(|error| CompilerError::new("invalid_tool_schema", error.to_string()))?;
        let captured = Arc::new(Mutex::new(None::<Value>));
        let sink = Arc::clone(&captured);
        let tool = Tool::builder()
            .name(request.tool_name.clone())
            .description(request.tool_description.clone())
            .input_schema(schema)
            .execute(ToolExecute::from_sync(move |_context, value: Value| {
                *sink.lock().map_err(|_| {
                    aisdk::error::Error::ToolCallError("compiler tool lock poisoned".into())
                })? = Some(value);
                Ok("accepted".to_string())
            }))
            .build()
            .map_err(|error| CompilerError::new("tool_build_failed", error.to_string()))?;
        let mut prompt = serde_json::to_string(&request.payload).map_err(|error| {
            CompilerError::new("prompt_serialization_failed", error.to_string())
        })?;
        if let Some(code) = &request.correction {
            prompt.push_str("\nPrevious output was rejected with code: ");
            prompt.push_str(code);
            prompt.push_str(". ");
            prompt.push_str(correction_instruction(code));
            prompt.push_str(" Call the required tool again with corrected arguments.");
        }
        let anthropic_style = self.provider != Provider::OpenAi;
        let body = if anthropic_style {
            json!({"tool_choice":{"type":"tool","name":request.tool_name}})
        } else {
            json!({"tool_choice":{"type":"function","name":request.tool_name}})
        };
        let response = match self.provider {
            Provider::Anthropic | Provider::Minimax => {
                let base = if self.provider == Provider::Minimax {
                    "https://api.minimax.io/anthropic/v1/"
                } else {
                    "https://api.anthropic.com/v1/"
                };
                let chosen = Anthropic::<DynamicModel>::builder()
                    .model_name(&self.model)
                    .api_key(&self.secret)
                    .base_url(base)
                    .build()
                    .map_err(|error| {
                        CompilerError::new("provider_build_failed", error.to_string())
                    })?;
                LanguageModelRequest::builder()
                    .model(chosen)
                    .system(request.system)
                    .prompt(prompt)
                    .with_tool(tool)
                    .body(body)
                    .stop_when(|_| true)
                    .build()
                    .generate_text()
                    .await
            }
            Provider::OpenAi => {
                let chosen = OpenAI::<DynamicModel>::builder()
                    .model_name(&self.model)
                    .api_key(&self.secret)
                    .build()
                    .map_err(|error| {
                        CompilerError::new("provider_build_failed", error.to_string())
                    })?;
                LanguageModelRequest::builder()
                    .model(chosen)
                    .system(request.system)
                    .prompt(prompt)
                    .with_tool(tool)
                    .body(body)
                    .stop_when(|_| true)
                    .build()
                    .generate_text()
                    .await
            }
        }
        .map_err(|_| {
            CompilerError::new(
                "provider_request_failed",
                "the configured compiler provider request failed",
            )
        })?;
        let usage = response.usage();
        let arguments = captured
            .lock()
            .map_err(|_| CompilerError::model("compiler_tool_lock_poisoned"))?
            .take()
            .ok_or_else(|| CompilerError::model("required_tool_not_called"))?;
        Ok(ModelResponse {
            tool_name: request.tool_name,
            arguments,
            usage: TokenUsage {
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
            },
        })
    }
}

fn correction_instruction(code: &str) -> &'static str {
    match code {
        "required_tool_not_called" => "You must call the named tool exactly once.",
        "task_limit" => "Return between one and four tasks, inclusive; combine related source sections rather than returning a fifth task.",
        "chunk_outside_task_pages" => {
            "Every chunk_id must refer to a chunk whose page_start and page_end are inside that task's page range."
        }
        "invalid_tool_output_recommendations" => {
            "recommendations must be an array of objects matching the tool schema."
        }
        "invalid_tool_output_recommendation_evidence" => {
            "Every recommendation must include evidence as a non-empty array."
        }
        "invalid_tool_output_trigger_evidence" | "uncited_recommendation" => {
            "Every trigger must include evidence as a non-empty array of citation objects; do not omit it or use null."
        }
        "invalid_tool_output_action_evidence" | "uncited_action" => {
            "Every action must include evidence as a non-empty array of citation objects."
        }
        "invalid_tool_output_thresholds" => {
            "Every recommendation must include thresholds as an array; use an empty array when the source defines no threshold."
        }
        "invalid_tool_output_request_actor" => {
            "Every request action must include actor as exactly patient, clinician, care_team, or system."
        }
        _ => "Return every required field with the exact type and nesting defined by the tool schema.",
    }
}
