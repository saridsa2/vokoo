use std::{env, net::SocketAddr, sync::Arc};

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use supabase::types::SupabaseConfig;
use supabase::Client;
use thiserror::Error;
use tower_http::{
    cors::CorsLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};
use tracing::{info, warn};

#[derive(Clone)]
struct AppState {
    config: Arc<Config>,
}

#[derive(Debug)]
struct Config {
    supabase_url: String,
    supabase_anon_key: String,
    bind: SocketAddr,
    cors_origin: HeaderValue,
}

impl Config {
    fn from_env() -> Result<Self, ApiError> {
        let supabase_url = required_env("SUPABASE_URL")?;
        let supabase_anon_key = required_env("SUPABASE_ANON_KEY")?;
        let port = env::var("CONTROLPLANE_PORT")
            .unwrap_or_else(|_| "8081".into())
            .parse::<u16>()
            .map_err(|_| ApiError::configuration("CONTROLPLANE_PORT must be a valid port"))?;
        let cors_origin = env::var("CORS_ORIGIN")
            .unwrap_or_else(|_| "http://localhost:3000".into())
            .parse::<HeaderValue>()
            .map_err(|_| ApiError::configuration("CORS_ORIGIN must be a valid origin"))?;

        Ok(Self {
            supabase_url,
            supabase_anon_key,
            bind: SocketAddr::from(([0, 0, 0, 0], port)),
            cors_origin,
        })
    }

    fn anonymous_client(&self) -> Result<Client, ApiError> {
        Client::new(&self.supabase_url, &self.supabase_anon_key)
            .map_err(|error| ApiError::upstream(error.to_string()))
    }

    async fn user_client(&self, bearer: &str) -> Result<Client, ApiError> {
        // A fresh client per request prevents one user's auth session from ever
        // leaking into another concurrent request.
        //
        // set_auth() alone is NOT enough: it stores the token on the auth
        // module, but supabase-lib-rs's database layer never reads it and never
        // sets an Authorization header of its own -- PostgREST therefore sees
        // only the anon key, auth.uid() is null, and every RLS policy denies.
        // The symptom is silent: reads return an empty list and writes fail
        // with 42501, which looks like "no data yet" rather than "not
        // authenticated". Put the caller's JWT in the client's default headers
        // so it rides on every database and RPC request.
        let mut config = SupabaseConfig {
            url: self.supabase_url.clone(),
            key: self.supabase_anon_key.clone(),
            ..Default::default()
        };
        config.http_config.default_headers.insert(
            "Authorization".to_string(),
            format!("Bearer {bearer}"),
        );
        let client = Client::new_with_config(config)
            .map_err(|error| ApiError::upstream(error.to_string()))?;
        client
            .set_auth(bearer)
            .await
            .map_err(|error| ApiError::unauthorized(error.to_string()))?;
        Ok(client)
    }
}

fn required_env(name: &'static str) -> Result<String, ApiError> {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::configuration(format!("{name} is required")))
}

#[derive(Debug, Error)]
enum ApiError {
    #[error("configuration error: {0}")]
    Configuration(String),
    #[error("authentication required: {0}")]
    Unauthorized(String),
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid request: {0}")]
    BadRequest(String),
    #[error("Supabase request failed: {0}")]
    Upstream(String),
}

impl ApiError {
    fn configuration(message: impl Into<String>) -> Self {
        Self::Configuration(message.into())
    }

    fn unauthorized(message: impl Into<String>) -> Self {
        Self::Unauthorized(message.into())
    }

    fn upstream(message: impl Into<String>) -> Self {
        Self::Upstream(message.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            Self::Configuration(_) => (StatusCode::INTERNAL_SERVER_ERROR, "configuration_error"),
            Self::Unauthorized(_) => (StatusCode::UNAUTHORIZED, "unauthorized"),
            Self::Forbidden(_) => (StatusCode::FORBIDDEN, "forbidden"),
            Self::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
            Self::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            Self::Upstream(_) => (StatusCode::BAD_GATEWAY, "supabase_error"),
        };
        (status, Json(json!({ "error": { "code": code, "message": self.to_string() } })))
            .into_response()
    }
}

#[derive(Debug, Deserialize)]
struct SignInRequest {
    email: String,
    password: String,
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    limit: Option<u32>,
    offset: Option<u32>,
}


#[derive(Debug, Deserialize)]
struct SetCredentialRequest {
    vendor: String,
    /// Written, never read back. Nothing in this service logs it, and the
    /// database has no path that returns it to a browser.
    secret: String,
    label: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateOrganizationRequest {
    name: String,
    slug: String,
}

#[derive(Debug, Serialize)]
struct ApiResponse<T> {
    data: T,
    meta: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Resource {
    route: &'static str,
    table: &'static str,
}

const RESOURCES: &[Resource] = &[
    Resource { route: "agents", table: "agents" },
    Resource { route: "squads", table: "squads" },
    Resource { route: "tools", table: "tools" },
    Resource { route: "phone-numbers", table: "phone_numbers" },
    Resource { route: "voice-library", table: "voices" },
    Resource { route: "flows", table: "flows" },
    Resource { route: "files", table: "files" },
    Resource { route: "test-suites", table: "test_suites" },
    Resource { route: "evals", table: "evaluations" },
    Resource { route: "issues", table: "issues" },
    Resource { route: "monitors", table: "monitors" },
    Resource { route: "notifiers", table: "notifiers" },
    Resource { route: "boards", table: "boards" },
    Resource { route: "call-logs", table: "calls" },
    Resource { route: "chat-logs", table: "chats" },
    Resource { route: "structured-outputs", table: "structured_outputs" },
];

fn resource_for(route: &str) -> Result<Resource, ApiError> {
    RESOURCES
        .iter()
        .copied()
        .find(|resource| resource.route == route)
        .ok_or_else(|| ApiError::NotFound(format!("unknown resource '{route}'")))
}

fn bearer_token(headers: &HeaderMap) -> Result<&str, ApiError> {
    let value = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ApiError::unauthorized("missing Authorization bearer token"))?;
    value
        .strip_prefix("Bearer ")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::unauthorized("Authorization must use the Bearer scheme"))
}

fn org_id(headers: &HeaderMap) -> Result<&str, ApiError> {
    headers
        .get("x-org-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::Forbidden("x-org-id is required".into()))
}

/// Translate a failure from `publish_agent` into the right status.
///
/// A publish that is refused because the configuration is invalid, or because
/// the caller's role may not release, is the caller's problem — reporting it as
/// a bad gateway sends the reader to check whether the database is up. The
/// database raises these with SQLSTATEs it chose for the purpose:
///
///   P0002  the agent does not exist (or is not visible to this caller)
///   P0003  this role may not publish
///   P0004  the configuration failed validation
///
/// supabase-lib-rs surfaces the failure as the raw PostgREST response body, so
/// both the code and a readable message are in there — as JSON. It is parsed
/// rather than pattern-matched so the console shows "temperature must be
/// between 0 and 2, not 9" instead of the envelope around it.
///
/// An unrecognised code stays an upstream error, which is the safe default: a
/// new failure mode should read as "something broke", not as "your input was
/// wrong".
fn publish_error(body: String) -> ApiError {
    let parsed: Option<Value> = serde_json::from_str(&body).ok();
    let code = parsed
        .as_ref()
        .and_then(|value| value.get("code"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let message = parsed
        .as_ref()
        .and_then(|value| value.get("message"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or(body);

    match code.as_str() {
        "P0001" => ApiError::Unauthorized(message),
        "P0002" => ApiError::NotFound(message),
        "P0003" => ApiError::Forbidden(message),
        "P0004" => ApiError::BadRequest(message),
        // 42501 is PostgreSQL's own permission denial, raised by row-level
        // security rather than by our checks. It means the same thing to the
        // caller even though it did not come from the same place.
        "42501" => ApiError::Forbidden(message),
        _ => ApiError::Upstream(message),
    }
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "service": "vokoo-controlplane", "version": env!("CARGO_PKG_VERSION") }))
}

#[derive(Debug, Deserialize)]
struct RefreshRequest {
    refresh_token: String,
}

/// Exchange a refresh token for a new access token.
///
/// Calls Supabase's token endpoint directly rather than going through
/// supabase-lib-rs: its `refresh_session()` reads the refresh token from a
/// session held on the client, and this server keeps none — a fresh client is
/// built per request so one user's auth can never leak into another's.
///
/// The refresh token is supplied by the caller and never stored server-side.
async fn refresh_session(
    State(state): State<AppState>,
    Json(payload): Json<RefreshRequest>,
) -> Result<Json<Value>, ApiError> {
    if payload.refresh_token.trim().is_empty() {
        return Err(ApiError::BadRequest("refresh_token is required".into()));
    }

    let response = reqwest::Client::new()
        .post(format!(
            "{}/auth/v1/token?grant_type=refresh_token",
            state.config.supabase_url
        ))
        .header("apikey", &state.config.supabase_anon_key)
        .header("content-type", "application/json")
        .json(&json!({ "refresh_token": payload.refresh_token }))
        .send()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;

    if !response.status().is_success() {
        // A rejected refresh token means the session is over, not that
        // something broke. Report it as unauthorized so the client signs the
        // user out rather than retrying.
        return Err(ApiError::unauthorized("refresh token rejected"));
    }

    let session: Value = response
        .json()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;

    Ok(Json(json!({ "data": { "session": session } })))
}

async fn sign_in(
    State(state): State<AppState>,
    Json(payload): Json<SignInRequest>,
) -> Result<Json<Value>, ApiError> {
    if payload.email.trim().is_empty() || payload.password.is_empty() {
        return Err(ApiError::BadRequest("email and password are required".into()));
    }
    let client = state.config.anonymous_client()?;
    let auth = client
        .auth()
        .sign_in_with_email_and_password(payload.email.trim(), &payload.password)
        .await
        .map_err(|error| ApiError::unauthorized(error.to_string()))?;
    Ok(Json(json!({ "data": auth })))
}

async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let user = client
        .current_user()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?
        .ok_or_else(|| ApiError::unauthorized("Supabase session has no current user"))?;
    Ok(Json(json!({ "data": user })))
}

async fn metrics(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let organization = org_id(&headers)?.to_owned();
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let data = client
        .database()
        .rpc(
            "control_plane_metrics",
            Some(json!({ "p_org_id": organization })),
        )
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse {
        data,
        meta: json!({ "resource": "metrics" }),
    }))
}

/// Publish an agent.
///
/// Delegates to the `publish_agent` database function rather than doing the
/// work here, so the row update, the version number and the snapshot are
/// written in one transaction. Split across two statements, a crash between
/// them would leave history disagreeing with the live configuration — and the
/// disagreement would only be discovered by someone trying to roll back.
async fn publish_agent(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    // Read the org header for its side effect: it rejects a request that has
    // not chosen an organisation, matching every other data route.
    org_id(&headers)?;

    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let data = client
        .database()
        .rpc(
            "publish_agent",
            Some(json!({ "p_agent_id": id, "p_payload": payload })),
        )
        .await
        .map_err(|error| publish_error(error.to_string()))?;

    Ok(Json(ApiResponse {
        data,
        meta: json!({ "resource": "agents", "action": "publish" }),
    }))
}

/// Restore a previous version. This republishes an old snapshot through the
/// same path, so it appends a new version rather than rewriting history.
async fn restore_agent_version(
    State(state): State<AppState>,
    Path((id, version)): Path<(String, i32)>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    org_id(&headers)?;

    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let data = client
        .database()
        .rpc(
            "restore_agent_version",
            Some(json!({ "p_agent_id": id, "p_version": version })),
        )
        .await
        .map_err(|error| publish_error(error.to_string()))?;

    Ok(Json(ApiResponse {
        data,
        meta: json!({ "resource": "agents", "action": "restore" }),
    }))
}

/// Version history for one agent, newest first.
async fn list_agent_versions(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let organization = org_id(&headers)?.to_owned();
    let client = state.config.user_client(bearer_token(&headers)?).await?;

    let rows = client
        .database()
        .from("agent_versions")
        .select("id,version,snapshot,published_by,created_at")
        .eq("agent_id", &id)
        // Redundant with row-level security, and kept anyway: two independent
        // checks mean neither is a single point of failure.
        .eq("org_id", &organization)
        .order("version", supabase::types::OrderDirection::Descending)
        .execute::<Value>()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;

    Ok(Json(ApiResponse {
        data: json!(rows),
        meta: json!({ "resource": "agent_versions", "agent_id": id }),
    }))
}

/// What the platform can do: providers, models, voices, transcribers.
///
/// One request rather than four, because the console needs the whole registry
/// to render a single screen — four requests can arrive out of order and paint
/// a provider whose models have not loaded yet.
///
/// No `x-org-id`: what a model can do is a property of the model, not of who is
/// using it. The catalogue is the same for every organisation.
/// Publish a flow.
///
/// The graph, the version number and the snapshot are written in one
/// transaction by the database, for the same reason agents are: split across
/// statements, a crash between them leaves history disagreeing with what is
/// live, and that is only discovered by someone trying to roll back.
async fn publish_flow(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    org_id(&headers)?;
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let data = client
        .database()
        .rpc("publish_flow", Some(json!({ "p_flow_id": id, "p_graph": payload })))
        .await
        .map_err(|error| publish_error(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "flows", "action": "publish" }) }))
}

async fn restore_flow_version(
    State(state): State<AppState>,
    Path((id, version)): Path<(String, i32)>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    org_id(&headers)?;
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let data = client
        .database()
        .rpc("restore_flow_version", Some(json!({ "p_flow_id": id, "p_version": version })))
        .await
        .map_err(|error| publish_error(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "flows", "action": "restore" }) }))
}

async fn list_flow_versions(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let organization = org_id(&headers)?.to_owned();
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let rows = client
        .database()
        .from("flow_versions")
        .select("id,version,snapshot,published_by,created_at")
        .eq("flow_id", &id)
        .eq("org_id", &organization)
        .order("version", supabase::types::OrderDirection::Descending)
        .execute::<Value>()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse {
        data: json!(rows),
        meta: json!({ "resource": "flow_versions", "flow_id": id }),
    }))
}

async fn capability_catalogue(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let data = client
        .database()
        .rpc("capability_catalogue", None)
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;

    Ok(Json(ApiResponse {
        data,
        meta: json!({ "resource": "catalogue" }),
    }))
}

/// The organisations the caller belongs to.
///
/// This is the one data route that must not require `x-org-id`: it is what the
/// client calls to find out which organisation ids it is allowed to send. A
/// single-organisation install works without it by configuration, but nothing
/// else can tell a member of two organisations which two they are.
///
/// Membership is the source of truth, not the organisations table — reading
/// organisations directly would depend on that table's policy happening to
/// match, and the two could drift apart without anyone noticing.
async fn list_my_organizations(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<Value>>>, ApiError> {
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let user = client
        .current_user()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?
        .ok_or_else(|| ApiError::unauthorized("Supabase session has no current user"))?;
    let user_id = user.id.to_string();

    // An embedded select, so one round trip returns the membership and the
    // organisation it points at. Two queries would need the client to join them
    // and would report a half-loaded list while the second was in flight.
    let rows = client
        .database()
        .from("memberships")
        .select("role,org_id,organizations(id,name,slug,plan)")
        .eq("user_id", &user_id)
        .execute::<Value>()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;

    // Flatten to the shape the console wants — an organisation with the
    // caller's role on it — rather than making every caller reach through the
    // membership wrapper.
    let data = rows
        .into_iter()
        .filter_map(|row| {
            let organization = row.get("organizations")?.clone();
            if !organization.is_object() {
                return None;
            }
            let mut merged = organization.as_object()?.clone();
            merged.insert("role".into(), row.get("role").cloned().unwrap_or(Value::Null));
            Some(Value::Object(merged))
        })
        .collect::<Vec<_>>();

    Ok(Json(ApiResponse {
        meta: json!({ "resource": "organizations", "count": data.len() }),
        data,
    }))
}

/// Provider keys for the organisation — what is connected, never what it is.
///
/// The response carries a four-character hint and a date. There is no route
/// that returns a secret: the only function that can decrypt one is granted to
/// the service role alone, which the bridge holds and no browser ever sees.
async fn list_credentials(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let organization = org_id(&headers)?.to_owned();
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let data = client
        .database()
        .rpc("list_vendor_credentials", Some(json!({ "p_org_id": organization })))
        .await
        .map_err(|error| publish_error(error.to_string()))?;

    Ok(Json(ApiResponse {
        data,
        meta: json!({ "resource": "vendors" }),
    }))
}

/// Connect or rotate a provider key.
///
/// Rotation replaces the secret behind the same row rather than creating a new
/// one, so anything holding a reference keeps working across a rotation.
async fn set_credential(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SetCredentialRequest>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    if payload.secret.trim().is_empty() {
        return Err(ApiError::BadRequest("a key is required".into()));
    }
    let organization = org_id(&headers)?.to_owned();
    let client = state.config.user_client(bearer_token(&headers)?).await?;

    let data = client
        .database()
        .rpc(
            "set_vendor_credential",
            Some(json!({
                "p_org_id": organization,
                "p_vendor": payload.vendor,
                "p_secret": payload.secret,
                "p_label": payload.label,
            })),
        )
        .await
        .map_err(|error| publish_error(error.to_string()))?;

    Ok(Json(ApiResponse {
        data,
        meta: json!({ "resource": "vendors", "action": "set" }),
    }))
}

async fn delete_credential(
    State(state): State<AppState>,
    Path(vendor): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    let organization = org_id(&headers)?.to_owned();
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    client
        .database()
        .rpc(
            "delete_vendor_credential",
            Some(json!({ "p_org_id": organization, "p_vendor": vendor })),
        )
        .await
        .map_err(|error| publish_error(error.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_organization(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let organization = org_id(&headers)?.to_owned();
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let row = client
        .database()
        .from("organizations")
        .select("id,name,slug,plan,settings,created_at,updated_at")
        .eq("id", &organization)
        .single_execute::<Value>()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?
        .ok_or_else(|| ApiError::NotFound("organization was not found".into()))?;
    Ok(Json(ApiResponse {
        data: row,
        meta: json!({ "resource": "organization" }),
    }))
}

async fn create_organization(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateOrganizationRequest>,
) -> Result<(StatusCode, Json<ApiResponse<Value>>), ApiError> {
    if payload.name.trim().is_empty() || payload.slug.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "organization name and slug are required".into(),
        ));
    }
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let data = client
        .database()
        .rpc(
            "create_control_plane_organization",
            Some(json!({
                "p_name": payload.name.trim(),
                "p_slug": payload.slug.trim().to_lowercase(),
            })),
        )
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok((
        StatusCode::CREATED,
        Json(ApiResponse {
            data,
            meta: json!({ "resource": "organization" }),
        }),
    ))
}

async fn update_organization(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let organization = org_id(&headers)?.to_owned();
    let input = payload
        .as_object()
        .ok_or_else(|| ApiError::BadRequest("request body must be a JSON object".into()))?;
    let mut body = Map::new();
    for field in ["name", "settings"] {
        if let Some(value) = input.get(field) {
            body.insert(field.into(), value.clone());
        }
    }
    if body.is_empty() {
        return Err(ApiError::BadRequest(
            "organization updates support name and settings".into(),
        ));
    }
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let mut rows = client
        .database()
        .update("organizations")
        .set(body)
        .map_err(|error| ApiError::BadRequest(error.to_string()))?
        .eq("id", &organization)
        .returning("*")
        .execute::<Value>()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    let row = rows
        .pop()
        .ok_or_else(|| ApiError::NotFound("organization was not found".into()))?;
    Ok(Json(ApiResponse {
        data: row,
        meta: json!({ "resource": "organization" }),
    }))
}

async fn list_members(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<Value>>>, ApiError> {
    let organization = org_id(&headers)?.to_owned();
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let rows = client
        .database()
        .from("memberships")
        .select("id,org_id,user_id,role,display_name,invited_email,created_at,updated_at")
        .eq("org_id", &organization)
        .execute::<Value>()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse {
        data: rows,
        meta: json!({ "resource": "members", "organization_id": organization }),
    }))
}

async fn list_resources(
    State(state): State<AppState>,
    Path(route): Path<String>,
    Query(query): Query<ListQuery>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<Value>>>, ApiError> {
    let resource = resource_for(&route)?;
    let organization = org_id(&headers)?.to_owned();
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let limit = query.limit.unwrap_or(50).clamp(1, 100);
    let offset = query.offset.unwrap_or(0);
    let rows = client
        .database()
        .from(resource.table)
        .select("*")
        .eq("org_id", &organization)
        .order("updated_at", supabase::types::OrderDirection::Descending)
        .limit(limit)
        .offset(offset)
        .execute::<Value>()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse {
        meta: json!({ "resource": route, "limit": limit, "offset": offset, "count": rows.len() }),
        data: rows,
    }))
}

async fn get_resource(
    State(state): State<AppState>,
    Path((route, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let resource = resource_for(&route)?;
    let organization = org_id(&headers)?.to_owned();
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let row = client
        .database()
        .from(resource.table)
        .select("*")
        .eq("org_id", &organization)
        .eq("id", &id)
        .single_execute::<Value>()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?
        .ok_or_else(|| ApiError::NotFound(format!("{} '{}' was not found", route, id)))?;
    Ok(Json(ApiResponse { data: row, meta: json!({ "resource": route }) }))
}

fn mutable_payload(payload: Value, organization: &str) -> Result<Map<String, Value>, ApiError> {
    let mut object = payload
        .as_object()
        .cloned()
        .ok_or_else(|| ApiError::BadRequest("request body must be a JSON object".into()))?;
    for protected in ["id", "org_id", "created_at", "updated_at"] {
        object.remove(protected);
    }
    object.insert("org_id".into(), Value::String(organization.into()));
    Ok(object)
}

async fn create_resource(
    State(state): State<AppState>,
    Path(route): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<(StatusCode, Json<ApiResponse<Value>>), ApiError> {
    let resource = resource_for(&route)?;
    let organization = org_id(&headers)?.to_owned();
    let body = mutable_payload(payload, &organization)?;
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let mut rows = client
        .database()
        .insert(resource.table)
        .values(body)
        .map_err(|error| ApiError::BadRequest(error.to_string()))?
        .returning("*")
        .execute::<Value>()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    let row = rows.pop().ok_or_else(|| ApiError::upstream("Supabase returned no inserted row"))?;
    Ok((StatusCode::CREATED, Json(ApiResponse { data: row, meta: json!({ "resource": route }) })))
}

async fn update_resource(
    State(state): State<AppState>,
    Path((route, id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let resource = resource_for(&route)?;
    let organization = org_id(&headers)?.to_owned();
    let body = mutable_payload(payload, &organization)?;
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let mut rows = client
        .database()
        .update(resource.table)
        .set(body)
        .map_err(|error| ApiError::BadRequest(error.to_string()))?
        .eq("org_id", &organization)
        .eq("id", &id)
        .returning("*")
        .execute::<Value>()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    let row = rows.pop().ok_or_else(|| ApiError::NotFound(format!("{} '{}' was not found", route, id)))?;
    Ok(Json(ApiResponse { data: row, meta: json!({ "resource": route }) }))
}

async fn delete_resource(
    State(state): State<AppState>,
    Path((route, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    let resource = resource_for(&route)?;
    let organization = org_id(&headers)?.to_owned();
    let client = state.config.user_client(bearer_token(&headers)?).await?;
    let rows = client
        .database()
        .delete(resource.table)
        .eq("org_id", &organization)
        .eq("id", &id)
        .returning("id")
        .execute::<Value>()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    if rows.is_empty() {
        return Err(ApiError::NotFound(format!(
            "{} '{}' was not found",
            route, id
        )));
    }
    Ok(StatusCode::NO_CONTENT)
}

fn app(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(state.config.cors_origin.clone())
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE, Method::OPTIONS])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE, header::HeaderName::from_static("x-org-id")]);

    Router::new()
        .route("/health", get(health))
        .route("/api/v1/auth/sign-in", post(sign_in))
        .route("/api/v1/auth/refresh", post(refresh_session))
        .route("/api/v1/me", get(me))
        .route("/api/v1/me/organizations", get(list_my_organizations))
        .route("/api/v1/catalogue", get(capability_catalogue))
        .route("/api/v1/metrics", get(metrics))
        .route("/api/v1/settings/organizations", post(create_organization))
        .route(
            "/api/v1/settings/organization",
            get(get_organization).patch(update_organization),
        )
        // Registered before the generic `/{resource}` routes so these specific
        // paths are not swallowed by the catch-all.
        .route("/api/v1/agents/{id}/publish", post(publish_agent))
        .route("/api/v1/flows/{id}/publish", post(publish_flow))
        .route("/api/v1/flows/{id}/versions", get(list_flow_versions))
        .route(
            "/api/v1/flows/{id}/versions/{version}/restore",
            post(restore_flow_version),
        )
        .route("/api/v1/agents/{id}/versions", get(list_agent_versions))
        .route(
            "/api/v1/agents/{id}/versions/{version}/restore",
            post(restore_agent_version),
        )
        .route(
            "/api/v1/settings/vendors",
            get(list_credentials).post(set_credential),
        )
        .route(
            "/api/v1/settings/vendors/{vendor}",
            delete(delete_credential),
        )
        .route("/api/v1/settings/members", get(list_members))
        .route("/api/v1/{resource}", get(list_resources).post(create_resource))
        .route(
            "/api/v1/{resource}/{id}",
            get(get_resource).patch(update_resource).delete(delete_resource),
        )
        .with_state(state)
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "vokoo_controlplane=info,tower_http=info".into()))
        .init();

    let config = Arc::new(Config::from_env()?);
    let bind = config.bind;
    let listener = tokio::net::TcpListener::bind(bind).await?;
    info!(%bind, "VoKoo control-plane API listening");
    axum::serve(listener, app(AppState { config }))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        warn!(%error, "failed to install Ctrl+C handler");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_allowlist_maps_public_routes_to_tables() {
        assert_eq!(resource_for("phone-numbers").unwrap().table, "phone_numbers");
        assert!(resource_for("../../secrets").is_err());
    }

    #[test]
    fn bearer_tokens_require_the_expected_scheme() {
        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, HeaderValue::from_static("Bearer test-token"));
        assert_eq!(bearer_token(&headers).unwrap(), "test-token");
        headers.insert(header::AUTHORIZATION, HeaderValue::from_static("Basic bad"));
        assert!(bearer_token(&headers).is_err());
    }

    #[test]
    fn protected_fields_are_server_controlled() {
        let body = json!({ "id": "forged", "org_id": "wrong", "name": "Agent" });
        let sanitized = mutable_payload(body, "right").unwrap();
        assert!(!sanitized.contains_key("id"));
        assert_eq!(sanitized.get("org_id"), Some(&json!("right")));
    }
}
