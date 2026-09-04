use std::{collections::HashMap, env, net::SocketAddr, sync::Arc};

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
    /// Shared, because a limit that resets per request limits nothing.
    limiter: Arc<RateLimit>,
}

#[derive(Debug)]
struct Config {
    supabase_url: String,
    supabase_anon_key: String,
    /// The secret PostgREST verifies tokens with. An API key is exchanged for a
    /// short-lived token signed with this, so a key reaches the database as a
    /// member and RLS stays the single place the organisation boundary is
    /// enforced.
    supabase_jwt_secret: String,
    /// Shared with the `run` edge function. Not the service role key: a process
    /// holding that can read every table in every organisation, and the
    /// executor needs to read nothing at all.
    run_secret: String,
    bind: SocketAddr,
    cors_origins: Vec<HeaderValue>,
}

impl Config {
    fn from_env() -> Result<Self, ApiError> {
        let supabase_url = required_env("SUPABASE_URL")?;
        let supabase_anon_key = required_env("SUPABASE_ANON_KEY")?;
        let supabase_jwt_secret = required_env("SUPABASE_JWT_SECRET")?;
        let run_secret = required_env("VOKOO_RUN_SECRET")?;
        let port = env::var("CONTROLPLANE_PORT")
            .unwrap_or_else(|_| "8081".into())
            .parse::<u16>()
            .map_err(|_| ApiError::configuration("CONTROLPLANE_PORT must be a valid port"))?;
        // **A list, not one origin.** There are two products on two hostnames
        // now, and a developer running the console locally is a third — one
        // value meant deploying broke local work and local work broke the
        // deployment. Comma-separated, and an entry that is not a valid origin
        // is a configuration error rather than a silently ignored one: a
        // mistyped origin fails as CORS in a browser, which sends the reader to
        // look at the server.
        let cors_origins = env::var("CORS_ORIGIN")
            .unwrap_or_else(|_| "http://localhost:3000".into())
            .split(',')
            .map(str::trim)
            .filter(|origin| !origin.is_empty())
            .map(|origin| {
                origin
                    .parse::<HeaderValue>()
                    .map_err(|_| ApiError::configuration(format!("not a valid origin: {origin}")))
            })
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Self {
            supabase_url,
            supabase_anon_key,
            supabase_jwt_secret,
            run_secret,
            bind: SocketAddr::from(([0, 0, 0, 0], port)),
            cors_origins,
        })
    }

    fn anonymous_client(&self) -> Result<Client, ApiError> {
        Client::new(&self.supabase_url, &self.supabase_anon_key)
            .map_err(|error| ApiError::upstream(error.to_string()))
    }

    /// A client carrying a token this process minted.
    ///
    /// Deliberately does not call `set_auth`, which round-trips to GoTrue to
    /// validate a session. There is no session here — the token was signed a
    /// moment ago against the same secret PostgREST verifies with, and the
    /// database layer reads the Authorization header rather than the auth
    /// module. See the note in `user_client`.
    fn token_client(&self, jwt: &str) -> Result<Client, ApiError> {
        let mut config = SupabaseConfig {
            url: self.supabase_url.clone(),
            key: self.supabase_anon_key.clone(),
            ..Default::default()
        };
        config
            .http_config
            .default_headers
            .insert("Authorization".to_string(), format!("Bearer {jwt}"));
        Client::new_with_config(config).map_err(|error| ApiError::upstream(error.to_string()))
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
    /// The request is well formed and disagrees with what is already stored.
    /// Distinct from BadRequest because retrying it unchanged will not help.
    #[error("conflict: {0}")]
    Conflict(String),
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
            Self::Conflict(_) => (StatusCode::CONFLICT, "conflict"),
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
struct TestCredentialRequest {
    /// The key as typed. Never stored by this handler, and never logged.
    secret: String,
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
    /// What a list selects. `"*"` for almost everything.
    ///
    /// A phone number's real binding lives in `number_flows`, not in the legacy
    /// `flow_id` column the console was reading — so the list said "Unassigned"
    /// for a number that was answering calls, and somebody fixing that would
    /// have assigned an agent and been wrong. An embed is the difference
    /// between a row and the answer to the question the screen is asking.
    select: &'static str,
    /// The column a list is ordered by, newest first. Most tables carry
    /// `updated_at`; an append-only one has only `created_at`, and ordering by
    /// a column that is not there fails the whole request with 42703.
    order_by: &'static str,
}

const RESOURCES: &[Resource] = &[
    Resource { route: "agents", table: "agents", order_by: "updated_at", select: "*" },
    // `squads` had no rows and no reader. `skills` is what decides which tools
    // an agent may call, and had no route at all.
    Resource { route: "skills", table: "skills", order_by: "updated_at", select: "*" },
    Resource { route: "tools", table: "tools", order_by: "updated_at", select: "*" },
    Resource {
        route: "phone-numbers",
        table: "phone_numbers",
        order_by: "updated_at",
        select: "*,number_flows(trigger_event,flows(id,name))",
    },
    // An engine is the chain a call runs through, of which the voice is one
    // step. `voices` remains for the voices themselves, unreferenced until
    // something needs to list them.
    // **`engines` is deliberately absent from this list.** It became the
    // platform's in 0091, and the table's `config` carries the model names a
    // tenant must not see. A generic resource route selects `*`, so leaving it
    // here would hide the models on the screen and not in the API — which is
    // not hiding them. `/api/v1/engines` is served by `available_engines`
    // below: a name and a description, and only the engines that workspace is
    // entitled to.
    Resource { route: "flows", table: "flows", order_by: "updated_at", select: "*" },
    Resource { route: "files", table: "files", order_by: "updated_at", select: "*" },
    Resource { route: "test-suites", table: "test_suites", order_by: "updated_at", select: "*" },
    Resource { route: "evals", table: "evaluations", order_by: "updated_at", select: "*" },
    Resource { route: "issues", table: "issues", order_by: "updated_at", select: "*" },
    Resource { route: "monitors", table: "monitors", order_by: "updated_at", select: "*" },
    Resource { route: "notifiers", table: "notifiers", order_by: "updated_at", select: "*" },
    Resource { route: "boards", table: "boards", order_by: "updated_at", select: "*" },
    Resource { route: "call-logs", table: "calls", order_by: "updated_at", select: "*" },
    // The steps inside a call, including every tool invocation. `call-logs` is
    // the call; this is what happened during it.
    Resource { route: "call-events", table: "call_events", order_by: "created_at", select: "*" },
    // What a call consumed, priced. A view, not a table: the numbers are
    // derived from the usage ledger and the rate card on every read, so a rate
    // corrected today reprices every call already taken rather than leaving
    // history frozen at whatever was configured when it happened.
    Resource { route: "call-costs", table: "call_costs", order_by: "started_at", select: "*" },
    // The question the whole exercise is for: what each engine costs to run.
    // No timestamp of its own — it is an aggregate — so it orders by name.
    Resource { route: "engine-costs", table: "engine_costs", order_by: "engine_name", select: "*" },
    // The rate card. Editable, because nobody can price a call until somebody
    // enters what the vendors charge.
    Resource { route: "vendor-rates", table: "catalogue_vendor_rates", order_by: "updated_at", select: "*" },
    Resource { route: "chat-logs", table: "chats", order_by: "updated_at", select: "*" },
    Resource { route: "structured-outputs", table: "structured_outputs", order_by: "updated_at", select: "*" },
    // Human agents. **The SIP password is not selected.** PJSIP digest auth
    // needs it in plaintext, so it cannot be hashed the way a login password
    // is — which makes it a credential that must never be listed. Somebody's
    // own is fetched from `my_agent_extension`, which is scoped to auth.uid().
    Resource {
        route: "agent-extensions",
        table: "agent_extensions",
        order_by: "created_at",
        select: "id,org_id,user_id,membership_id,extension,endpoint,display_name,status,created_at,updated_at",
    },
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

/// How long a token minted for an API key lives.
///
/// Short because it is minted per request and never handed out: nothing needs
/// to refresh it, and a leaked one expires before it is useful. Long enough
/// that clock skew between this process and PostgREST cannot reject it.
const KEY_TOKEN_TTL_SECONDS: i64 = 300;

/// The visible half of a key, used to find the row before verifying the secret.
const KEY_PREFIX_LEN: usize = 11; // "vk_live_" + 3

#[derive(serde::Serialize)]
struct KeyClaims {
    sub: String,
    role: &'static str,
    aud: &'static str,
    exp: i64,
    iat: i64,
}

/// A newly minted key. The secret exists in this struct and nowhere else.
struct MintedKey {
    secret: String,
    prefix: String,
    hash: String,
}

fn mint_key() -> MintedKey {
    use rand::Rng;
    // 32 bytes of entropy rendered in an alphabet with no look-alike characters,
    // because these get copied out of terminals and into CI settings by hand.
    const ALPHABET: &[u8] = b"abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    let body: String = (0..43).map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char).collect();
    let secret = format!("vk_live_{body}");
    MintedKey {
        prefix: secret[..KEY_PREFIX_LEN].to_string(),
        hash: hash_key(&secret),
        secret,
    }
}

/// A key is 32 bytes of entropy, so there is no dictionary to attack and a slow
/// KDF would buy nothing while adding its cost to every request.
fn hash_key(secret: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(secret.as_bytes()))
}

fn looks_like_api_key(bearer: &str) -> bool {
    bearer.starts_with("vk_live_") && bearer.len() > KEY_PREFIX_LEN
}

/// Exchange a presented API key for a token that reaches the database as the
/// key's machine user.
///
/// The lookup runs through `resolve_api_key`, a `security definer` function, so
/// this process never needs the service role key. A process holding that key
/// can read every table in every organisation; this one can ask exactly one
/// question and gets back only the principal to act as.
async fn exchange_api_key(state: &AppState, presented: &str) -> Result<String, ApiError> {
    let client = state.config.anonymous_client()?;
    let rows: Value = client
        .database()
        .rpc(
            "resolve_api_key",
            Some(json!({
                "p_prefix": &presented[..KEY_PREFIX_LEN],
                "p_hash": hash_key(presented),
            })),
        )
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;

    // An unknown, revoked or expired key all come back the same way: no row.
    // Saying which would tell someone probing keys that they had found a real
    // prefix.
    let principal = rows
        .as_array()
        .and_then(|rows| rows.first())
        .and_then(|row| row.get("user_id"))
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::unauthorized("that API key is not valid"))?;

    let now = chrono::Utc::now().timestamp();
    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &KeyClaims {
            sub: principal.to_string(),
            role: "authenticated",
            aud: "authenticated",
            iat: now,
            exp: now + KEY_TOKEN_TTL_SECONDS,
        },
        &jsonwebtoken::EncodingKey::from_secret(state.config.supabase_jwt_secret.as_bytes()),
    )
    .map_err(|error| ApiError::upstream(error.to_string()))
}

/// The client a request acts through, however it authenticated.
///
/// A browser presents a Supabase session; the CLI presents `vk_live_…`. Both
/// end up as a JWT PostgREST verifies, so RLS is the only place the
/// organisation boundary is decided and there is no second copy of that rule in
/// this process to drift from it.
async fn authed_client(state: &AppState, headers: &HeaderMap) -> Result<Client, ApiError> {
    let bearer = bearer_token(headers)?;
    if looks_like_api_key(bearer) {
        let jwt = exchange_api_key(state, bearer).await?;
        return state.config.token_client(&jwt);
    }
    state.config.user_client(bearer).await
}

fn org_id(headers: &HeaderMap) -> Result<&str, ApiError> {
    headers
        .get("x-org-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::Forbidden("x-org-id is required".into()))
}

/// A refusal by row-level security is the caller's problem, not the database's.
///
/// `42501` reaching the client as a 502 sends the reader to check whether
/// Supabase is up, when what happened is that they may not do this. It is the
/// expected answer when a key — whose machine user is a `developer` — tries to
/// mint another key, and that path is a defence, so it has to read like one.
fn denied_or_upstream<E: std::fmt::Display>(error: E) -> ApiError {
    let text = error.to_string();
    if text.contains("42501") || text.contains("row-level security") {
        return ApiError::Forbidden(
            "this credential may not manage API keys — minting requires an owner or admin".into(),
        );
    }
    ApiError::upstream(text)
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

/// A crude per-caller rate limit, for the one route that answers a question
/// about somebody else's account.
///
/// In-process and in-memory on purpose: this is one process behind one reverse
/// proxy, and a Redis dependency to slow down an endpoint would be a second
/// thing to run and keep alive. It resets when the process restarts, which is
/// acceptable — the attack this blunts is a script working through an address
/// list, not a patient adversary waiting for a deploy.
struct RateLimit {
    hits: std::sync::Mutex<HashMap<String, (u32, std::time::Instant)>>,
}

impl RateLimit {
    fn new() -> Self {
        Self { hits: std::sync::Mutex::new(HashMap::new()) }
    }

    /// True when the caller may proceed.
    fn allow(&self, who: &str, limit: u32, window: std::time::Duration) -> bool {
        let now = std::time::Instant::now();
        let Ok(mut hits) = self.hits.lock() else {
            // A poisoned lock must not become an open door.
            return false;
        };

        // Swept here rather than on a timer: the map only grows while requests
        // arrive, so the moment to clean it is when one does.
        hits.retain(|_, (_, started)| now.duration_since(*started) < window);

        let entry = hits.entry(who.to_owned()).or_insert((0, now));
        if now.duration_since(entry.1) >= window {
            *entry = (0, now);
        }
        entry.0 += 1;
        entry.0 <= limit
    }
}

/// Who is calling, as well as this can be known behind a reverse proxy.
///
/// Caddy sets `x-forwarded-for` and the leftmost entry is the client. A client
/// can forge that header, but it reaches this process only through Caddy, which
/// appends rather than replaces — so a forged value shifts a real one along
/// instead of hiding it. Good enough to slow a script down, which is all this
/// is for.
fn caller_key(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(|value| value.trim().to_owned())
        .unwrap_or_else(|| "unknown".into())
}

/// Which ways this address can sign in.
///
/// **This is an account-enumeration oracle and was chosen deliberately** — it
/// is what lets the sign-in form ask for a password only when there is one.
/// Two things keep the cost down:
///
///   * The database answers identically for a link-only account and an address
///     with no account (see `account_sign_in_methods` in 0101), so the only
///     fact leaked is "this address has a password".
///   * It is rate limited here. Ten a minute is far above what a person
///     signing in needs and far below what enumerating a list requires.
async fn auth_methods(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let email = payload
        .get("email")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned();
    if email.is_empty() {
        return Err(ApiError::BadRequest("an email address is required".into()));
    }

    if !state.limiter.allow(
        &caller_key(&headers),
        10,
        std::time::Duration::from_secs(60),
    ) {
        // Deliberately not "you are rate limited on the methods endpoint": the
        // less this says, the less it is worth probing.
        return Err(ApiError::BadRequest("too many attempts, wait a minute".into()));
    }

    let client = state.config.anonymous_client()?;
    let data = client
        .database()
        .rpc("account_sign_in_methods", Some(json!({ "p_email": email })))
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;

    Ok(Json(json!({ "data": data })))
}

/// Mail a link that signs you in, to an account that already exists.
///
/// Unauthenticated by necessity — it is what somebody without a password uses —
/// and therefore deliberately narrow: it creates no account (see
/// `send_sign_in_link`), and it takes the destination from the browser's own
/// `Origin` header rather than from the body, checked against `CORS_ORIGIN`.
/// Reading it from the body would let anybody name the host a stranger's token
/// is delivered to.
///
/// **The answer is the same whether or not the address is known.** Replying
/// "no such account" would turn this into a way to test which addresses have
/// accounts here, one request at a time.
async fn sign_in_link(
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let email = payload
        .get("email")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned();
    if email.is_empty() {
        return Err(ApiError::BadRequest("an email address is required".into()));
    }

    let origin = headers
        .get(axum::http::header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);

    if let Err(problem) = send_sign_in_link(&email, origin.as_deref(), false).await {
        // A rate limit is about the *caller*, not the account, so saying so
        // discloses nothing and stops somebody waiting for mail that was never
        // sent. Every other refusal stays quiet: it would distinguish a known
        // address from an unknown one, which is what this route is shaped to
        // avoid.
        if problem == "rate_limited" {
            return Err(ApiError::BadRequest(
                "Too many links requested. Wait a few minutes and try again.".into(),
            ));
        }
        tracing::warn!(%email, %problem, "sign-in link was not sent");
    }

    Ok(Json(json!({
        "data": { "sent": true },
        "meta": { "note": "If that address has an account here, a link is on its way." }
    })))
}

async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let client = authed_client(&state, &headers).await?;
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
    let client = authed_client(&state, &headers).await?;
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

    let client = authed_client(&state, &headers).await?;
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

    let client = authed_client(&state, &headers).await?;
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
    let client = authed_client(&state, &headers).await?;

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
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("publish_flow", Some(json!({ "p_flow_id": id, "p_graph": payload })))
        .await
        .map_err(|error| publish_error(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "flows", "action": "publish" }) }))
}

#[derive(serde::Deserialize)]
struct SkillToolsRequest {
    tool_ids: Vec<String>,
}

/// The tools a skill grants.
///
/// This link is the boundary the whole system leans on: `compose_agent_tools`
/// walks agent → skills → tools, and a tool that is not reachable that way is
/// one the model is never declared. Until now it could only be edited in SQL.
async fn list_skill_tools(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<Value>>>, ApiError> {
    let org = org_id(&headers)?.to_string();
    let client = authed_client(&state, &headers).await?;

    let rows = client
        .database()
        .from("skill_tools")
        .select("id,tool_id,sort_order")
        .eq("org_id", &org)
        .eq("skill_id", &id)
        .order("sort_order", supabase::types::OrderDirection::Ascending)
        .execute::<Value>()
        .await
        .map_err(denied_or_upstream)?;

    Ok(Json(ApiResponse { data: rows, meta: json!({ "resource": "skills", "skill": id }) }))
}

/// Replace the set of tools a skill grants.
///
/// The whole set rather than add and remove, because that is what the screen
/// knows: a list of checkboxes has a final state, not a history of clicks.
///
/// One RPC rather than a delete and an insert. Those cannot share a transaction
/// through PostgREST, and the first save from the console proved what that
/// costs — the delete landed, the insert did not, and the skill was left
/// granting nothing.
async fn set_skill_tools(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<SkillToolsRequest>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    org_id(&headers)?;
    let client = authed_client(&state, &headers).await?;

    let data: Value = client
        .database()
        .rpc(
            "set_skill_tools",
            Some(json!({ "p_skill_id": id, "p_tool_ids": body.tool_ids })),
        )
        .await
        .map_err(denied_or_upstream)?;

    Ok(Json(ApiResponse { data, meta: json!({ "resource": "skills", "action": "set-tools" }) }))
}

#[derive(serde::Deserialize)]
struct AgentSkillsRequest {
    skill_ids: Vec<String>,
}

/// The skills an agent has.
///
/// The last link in the chain, and the one that decides everything upstream:
/// `compose_agent_prompt` and `compose_agent_tools` both start here, so an agent
/// with no skills is told nothing and declared nothing.
async fn list_agent_skills(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<Value>>>, ApiError> {
    let org = org_id(&headers)?.to_string();
    let client = authed_client(&state, &headers).await?;

    let rows = client
        .database()
        .from("agent_skills")
        .select("id,skill_id,sort_order")
        .eq("org_id", &org)
        .eq("agent_id", &id)
        .order("sort_order", supabase::types::OrderDirection::Ascending)
        .execute::<Value>()
        .await
        .map_err(denied_or_upstream)?;

    Ok(Json(ApiResponse { data: rows, meta: json!({ "resource": "agents", "agent": id }) }))
}

async fn set_agent_skills(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<AgentSkillsRequest>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    org_id(&headers)?;
    let client = authed_client(&state, &headers).await?;

    let data: Value = client
        .database()
        .rpc(
            "set_agent_skills",
            Some(json!({ "p_agent_id": id, "p_skill_ids": body.skill_ids })),
        )
        .await
        .map_err(denied_or_upstream)?;

    Ok(Json(ApiResponse { data, meta: json!({ "resource": "agents", "action": "set-skills" }) }))
}

#[derive(serde::Deserialize)]
struct NumberBindingRequest {
    trigger_event: String,
    /// Absent or null unbinds this event.
    #[serde(default)]
    flow_id: Option<String>,
}

/// Which flow answers which event on a number.
///
/// A call is the durable thing and flows are handlers bound to events on it, so
/// a number has one binding per event rather than one flow. `resolve_for_event`
/// reads exactly this.
async fn list_number_flows(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<Value>>>, ApiError> {
    let org = org_id(&headers)?.to_string();
    let client = authed_client(&state, &headers).await?;

    let rows = client
        .database()
        .from("number_flows")
        .select("id,trigger_event,flow_id")
        .eq("org_id", &org)
        .eq("phone_number_id", &id)
        .execute::<Value>()
        .await
        .map_err(denied_or_upstream)?;

    Ok(Json(ApiResponse { data: rows, meta: json!({ "resource": "phone-numbers", "number": id }) }))
}

async fn set_number_flow(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<NumberBindingRequest>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    org_id(&headers)?;
    let client = authed_client(&state, &headers).await?;

    let data: Value = client
        .database()
        .rpc(
            "set_number_flow",
            Some(json!({
                "p_phone_number_id": id,
                "p_trigger_event": body.trigger_event,
                "p_flow_id": body.flow_id,
            })),
        )
        .await
        .map_err(denied_or_upstream)?;

    Ok(Json(ApiResponse { data, meta: json!({ "resource": "phone-numbers", "action": "bind" }) }))
}

/// What happened the last times this tool ran on a call.
///
/// Its own endpoint because the generic list takes a limit and nothing else, and
/// a filter passed to it is dropped in silence — which is how `vokoo logs` first
/// shipped showing every tool's events under one tool's name.
///
/// Only real calls appear. A test run writes nothing: it has no call to belong
/// to, and putting it in the same timeline as a caller's steps would make the
/// trace a record of two different things.
async fn list_tool_runs(
    State(state): State<AppState>,
    Query(query): Query<ToolRunQuery>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<Value>>>, ApiError> {
    let org = org_id(&headers)?.to_string();
    let client = authed_client(&state, &headers).await?;

    let mut request = client
        .database()
        .from("call_events")
        .select("id,call_id,implementation,outcome,duration_ms,detail,created_at")
        .eq("org_id", &org);

    // Named, the runs of one tool. Unnamed, every tool's — which is the run
    // history for the workspace, and the reason this is not nested under a tool.
    request = match query.tool.as_deref().filter(|name| !name.is_empty()) {
        Some(name) => request.eq("implementation", &format!("tool.{name}")),
        None => request.like("implementation", "tool.%"),
    };

    let rows = request
        .order("created_at", supabase::types::OrderDirection::Descending)
        .limit(query.limit.unwrap_or(100).clamp(1, 500))
        .execute::<Value>()
        .await
        .map_err(denied_or_upstream)?;

    Ok(Json(ApiResponse { data: rows, meta: json!({ "resource": "tool-runs", "tool": query.tool }) }))
}

#[derive(serde::Deserialize)]
struct ToolRunQuery {
    tool: Option<String>,
    limit: Option<u32>,
}

/// Every version of one tool, newest first.
///
/// Its own endpoint rather than a filter on the generic list: that handler takes
/// a limit and nothing else, and a filter passed to it is dropped in silence.
/// `code` is left out — it is the stripped copy the executor runs, and a reader
/// wants the source they wrote.
async fn list_tool_versions(
    State(state): State<AppState>,
    Path(name): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<Value>>>, ApiError> {
    let org = org_id(&headers)?.to_string();
    let client = authed_client(&state, &headers).await?;

    let tools = client
        .database()
        .from("tools")
        .select("id")
        .eq("org_id", &org)
        .eq("name", &name)
        .limit(1)
        .execute::<Value>()
        .await
        .map_err(denied_or_upstream)?;

    let tool_id = tools
        .first()
        .and_then(|row| row.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::NotFound(format!("no tool named {name} in this workspace")))?
        .to_string();

    let rows = client
        .database()
        .from("tool_versions")
        .select("version,checksum,source,snapshot,created_at")
        .eq("tool_id", &tool_id)
        .order("version", supabase::types::OrderDirection::Descending)
        .execute::<Value>()
        .await
        .map_err(denied_or_upstream)?;

    Ok(Json(ApiResponse { data: rows, meta: json!({ "resource": "functions", "tool": name }) }))
}

#[derive(serde::Deserialize)]
struct RunFunctionRequest {
    #[serde(default)]
    args: Value,
    /// Which version to run. Absent means the live one; a past call is
    /// reproduced by naming the version it pinned.
    #[serde(default)]
    version: Option<i64>,
}

/// Run one tool and report what it did.
///
/// The version is read here, through row-level security as the caller, and the
/// code is sent to the executor. The executor holds no database client on
/// purpose: every function isolate on this deployment carries the service role
/// key and cannot drop it, so the way to bound what running a tool can reach is
/// to give that function nothing worth reaching.
async fn run_function(
    State(state): State<AppState>,
    Path(name): Path<String>,
    headers: HeaderMap,
    Json(body): Json<RunFunctionRequest>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let org = org_id(&headers)?.to_string();
    let client = authed_client(&state, &headers).await?;

    let tools = client
        .database()
        .from("tools")
        .select("id,name,current_version,schema")
        .eq("org_id", &org)
        .eq("name", &name)
        .limit(1)
        .execute::<Value>()
        .await
        .map_err(denied_or_upstream)?;

    let tool = tools
        .first()
        .ok_or_else(|| ApiError::NotFound(format!("no tool named {name} in this workspace")))?;
    let tool_id = tool.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
    let wanted = body
        .version
        .or_else(|| tool.get("current_version").and_then(Value::as_i64))
        .unwrap_or(0);

    if wanted == 0 {
        return Err(ApiError::BadRequest(format!(
            "{name} has no pushed version — it was made in the console rather than with the SDK"
        )));
    }

    let versions = client
        .database()
        .from("tool_versions")
        .select("version,code,snapshot")
        .eq("tool_id", &tool_id)
        .eq("version", &wanted.to_string())
        .limit(1)
        .execute::<Value>()
        .await
        .map_err(denied_or_upstream)?;

    let version = versions
        .first()
        .ok_or_else(|| ApiError::NotFound(format!("{name} has no version {wanted}")))?;
    let code = version.get("code").and_then(Value::as_str).unwrap_or_default();
    if code.is_empty() {
        return Err(ApiError::BadRequest(format!(
            "{name} version {wanted} was pushed before the executor existed — push again"
        )));
    }
    let timeout = version
        .get("snapshot")
        .and_then(|s| s.get("timeoutSeconds"))
        .and_then(Value::as_i64)
        .unwrap_or(10);

    let http = reqwest::Client::builder()
        // Above the executor's own budget, so the answer comes from the
        // executor — which knows whether the tool timed out or threw — rather
        // than from us giving up first.
        .timeout(std::time::Duration::from_secs((timeout as u64).saturating_add(15)))
        .build()
        .map_err(|error| ApiError::upstream(error.to_string()))?;

    let reply = http
        .post(format!("{}/functions/v1/run", state.config.supabase_url))
        .header("Authorization", format!("Bearer {}", state.config.run_secret))
        .json(&json!({
            "name": name,
            "version": wanted,
            "code": code,
            "args": body.args,
            "timeoutSeconds": timeout,
            // No call, so no variables and no secrets. `vokoo run` is a tool on
            // its own, which is what makes it a test rather than a rehearsal.
            "ctx": { "callId": null, "orgId": org, "variables": {}, "secrets": {} },
        }))
        .send()
        .await
        .map_err(|error| ApiError::upstream(format!("the executor did not answer: {error}")))?;

    let mut data: Value = reply
        .json()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    if let Some(object) = data.as_object_mut() {
        object.insert("version".into(), json!(wanted));
    }

    Ok(Json(ApiResponse { data, meta: json!({ "resource": "functions", "action": "run", "tool": name }) }))
}

#[derive(serde::Deserialize)]
struct PushFunctionsRequest {
    #[serde(default)]
    functions: Vec<Value>,
    /// Named schemas from the same push. Optional, so a CLI that predates them
    /// keeps working and a project with only tools sends nothing.
    #[serde(default)]
    schemas: Vec<Value>,
}

/// Receive a push from the SDK.
///
/// The work is one transaction over `tools` and `tool_versions`, so it belongs
/// in `push_functions` rather than here: a push that created three tools and
/// failed on the fourth would otherwise leave a workspace half-updated, and the
/// CLI has no way to know which half.
///
/// This runs as the caller — the API key's machine user — so row-level security
/// decides what may be written and there is no second copy of the organisation
/// rule in this process.
async fn push_functions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PushFunctionsRequest>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let org = org_id(&headers)?.to_string();

    if body.functions.is_empty() && body.schemas.is_empty() {
        return Err(ApiError::BadRequest("nothing in this push".into()));
    }

    // Checked with the same care and for the same reason as the functions
    // below: the message is for somebody holding a terminal.
    for (index, entry) in body.schemas.iter().enumerate() {
        for field in ["id", "name"] {
            if entry.get(field).and_then(Value::as_str).filter(|v| !v.is_empty()).is_none() {
                return Err(ApiError::BadRequest(format!(
                    "schema {index} is missing {field} — push with a current vokoo CLI"
                )));
            }
        }
        if entry.get("schema").filter(|value| value.is_object()).is_none() {
            return Err(ApiError::BadRequest(format!(
                "schema {index} has no compiled schema — push with a current vokoo CLI"
            )));
        }
    }

    // Checked here rather than in SQL because the message is for somebody
    // holding a terminal, and plpgsql has no idea which entry it is reading.
    for (index, entry) in body.functions.iter().enumerate() {
        for field in ["id", "name", "checksum", "source"] {
            if entry.get(field).and_then(Value::as_str).filter(|v| !v.is_empty()).is_none() {
                return Err(ApiError::BadRequest(format!(
                    "function {index} is missing {field} — push with a current vokoo CLI"
                )));
            }
        }
    }

    let client = authed_client(&state, &headers).await?;

    // Two calls rather than one, because they are two transactions over
    // different tables. A schema push that succeeds beside a tool push that
    // fails leaves a schema nothing yet points at, which is harmless — whereas
    // folding them into one function would put a tool's code path and a
    // declaration's in the same rollback for no benefit.
    let mut data = json!({});
    if !body.functions.is_empty() {
        data["functions"] = client
            .database()
            .rpc(
                "push_functions",
                Some(json!({ "p_org_id": &org, "p_functions": body.functions })),
            )
            .await
            .map_err(push_conflict_or_denied)?;
    }
    if !body.schemas.is_empty() {
        data["schemas"] = client
            .database()
            .rpc(
                "push_schemas",
                Some(json!({ "p_org_id": &org, "p_schemas": body.schemas })),
            )
            .await
            .map_err(push_conflict_or_denied)?;
    }

    // The tool result stays at the top level, so a CLI that predates schemas
    // reads `created`/`updated` where it always did.
    if let Some(functions) = data.get("functions").cloned() {
        if let Some(object) = functions.as_object() {
            for (key, value) in object {
                data[key] = value.clone();
            }
        }
    }

    Ok(Json(ApiResponse { data, meta: json!({ "resource": "functions", "action": "push" }) }))
}

/// A push that collides with a tool this caller cannot see.
///
/// An id identifies one tool everywhere, so an id already used by another
/// organisation is invisible under row-level security and reaches the primary
/// key instead. Reported as a conflict naming the cause, because the alternative
/// — a duplicate key error — sends the reader to look for a bug in their own
/// database.
fn push_conflict_or_denied<E: std::fmt::Display>(error: E) -> ApiError {
    let text = error.to_string();
    if text.contains("23505") || text.contains("duplicate key") {
        if text.contains("tools_org_id_name_key") {
            return ApiError::Conflict(
                "a different tool in this workspace already has that name — the model calls a tool by name, so it has to be unique".into(),
            );
        }
        return ApiError::Conflict(
            "one of these ids already belongs to a different workspace — give the tool its own id".into(),
        );
    }
    denied_or_upstream(text)
}

#[derive(serde::Deserialize)]
struct MintKeyRequest {
    name: String,
    #[serde(default)]
    expires_at: Option<String>,
}

/// Mint an API key for this organisation.
///
/// The secret is returned exactly once, in this response, and is not
/// recoverable: only its SHA-256 and its visible prefix are stored. Losing it
/// means minting another.
///
/// Writing to `api_keys` requires `is_org_admin` (migration 0032), so this
/// refuses for a member without that role — and refuses for a request that
/// authenticated with an API key, since a key's machine user is a `developer`.
/// A leaked key must not be able to issue its own replacement.
async fn mint_api_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<MintKeyRequest>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let org = org_id(&headers)?.to_string();
    let client = authed_client(&state, &headers).await?;

    let principal: Value = client
        .database()
        .rpc("machine_user_for_org", Some(json!({ "p_org_id": &org })))
        .await
        // The function refuses a caller who is not an admin of this
        // organisation, before it writes anything. That refusal is the caller's
        // answer, not a database fault.
        .map_err(denied_or_upstream)?;
    let principal = principal
        .as_str()
        .map(str::to_owned)
        .or_else(|| principal.as_array().and_then(|r| r.first()).and_then(Value::as_str).map(str::to_owned))
        .ok_or_else(|| ApiError::upstream("could not resolve the machine user for this organisation"))?;

    let minted = mint_key();
    let mut row = json!({
        "org_id":   &org,
        "user_id":  principal,
        "name":     body.name,
        "prefix":   minted.prefix,
        "key_hash": minted.hash,
    });
    if let Some(expires) = body.expires_at.filter(|value| !value.trim().is_empty()) {
        row["expires_at"] = Value::String(expires);
    }

    let mut created = client
        .database()
        .insert("api_keys")
        .values(row)
        .map_err(|error| ApiError::BadRequest(error.to_string()))?
        // The hash is deliberately not returned. It is not the secret, but it
        // is the only stored thing a stolen backup could check a guess against.
        .returning("id,org_id,name,prefix,scopes,expires_at,created_at")
        .execute::<Value>()
        .await
        .map_err(denied_or_upstream)?;
    let created = created
        .pop()
        .ok_or_else(|| ApiError::upstream("Supabase returned no inserted key"))?;

    Ok(Json(ApiResponse {
        // `key` appears here and never again. The console must say so where it
        // is shown, because the reader has one chance to copy it.
        data: json!({ "key": minted.secret, "created": created }),
        meta: json!({ "resource": "api-keys", "action": "mint", "shown_once": true }),
    }))
}

async fn restore_flow_version(
    State(state): State<AppState>,
    Path((id, version)): Path<(String, i32)>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    org_id(&headers)?;
    let client = authed_client(&state, &headers).await?;
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
    let client = authed_client(&state, &headers).await?;
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
    let client = authed_client(&state, &headers).await?;
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
    let client = authed_client(&state, &headers).await?;
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
        // `display_name` too: it is the only place a person's actual name
        // lives. Without it the console derives one from the email, and
        // `hello@…` becomes a user called "Hello".
        .select("role,display_name,org_id,organizations(id,name,slug,plan)")
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
            // What this member is called *in this organisation*. A person can
            // be "Priya" in one and "Dr Nair" in another, so it travels with
            // the membership rather than with the account.
            merged.insert(
                "member_name".into(),
                row.get("display_name").cloned().unwrap_or(Value::Null),
            );
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
    let client = authed_client(&state, &headers).await?;
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
    let client = authed_client(&state, &headers).await?;

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

/// Does this key actually work?
///
/// Tested at the moment it is typed, against what was typed — never against a
/// stored one. `resolve_vendor_secret` is `service_role` only (migration 0046)
/// and this process holds no service key by design, so it *cannot* read a
/// stored secret. That is the property worth keeping: the only thing that ever
/// decrypts a key is the media bridge, when it places a call.
///
/// Typing is also when a wrong key is worth catching. A key that authenticates
/// here and fails later has been rotated at the provider, which no amount of
/// checking at rest would have predicted.
///
/// One cheap, read-only request per vendor — a listing endpoint in every case.
/// Nothing is created and nothing is charged. Vendors whose probe is not known
/// return `supported: false` rather than a test that always passes, which would
/// be worse than no test at all.
/// Would this engine work, and what does each provider currently offer?
///
/// Both are the bridge's to answer: they need a provider key, and after
/// migration 0046 `resolve_vendor_secret` is `service_role` only — this process
/// holds no service key by design and cannot read one.
///
/// So this gates on the caller's organisation, which the bridge has no way to
/// check, and forwards with a shared secret. The two halves each do the part
/// only they can.
async fn call_bridge(
    state: &AppState,
    headers: &HeaderMap,
    path: &str,
    body: Value,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let _ = org_id(headers)?;
    let _ = authed_client(state, headers).await?;

    let (base, token) = (
        std::env::var("BRIDGE_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".into()),
        std::env::var("BRIDGE_INTERNAL_TOKEN").unwrap_or_default(),
    );
    if token.is_empty() {
        return Err(ApiError::Configuration(
            "BRIDGE_INTERNAL_TOKEN is not set, so the bridge cannot be asked".into(),
        ));
    }

    let client = reqwest::Client::builder()
        // Pre-flight opens real provider connections and waits on them, so this
        // is deliberately longer than an ordinary API call.
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| ApiError::Upstream(error.to_string()))?;

    let response = client
        .post(format!("{base}{path}"))
        .header("x-vokoo-internal", token)
        .json(&body)
        .send()
        .await
        .map_err(|error| ApiError::Upstream(format!("could not reach the bridge: {error}")))?;

    let status = response.status();
    let data: Value = response.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(ApiError::Upstream(format!("the bridge answered {status}")));
    }
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "engines" }) }))
}

/// The zone a business day is measured in.
///
/// The organisation's own, when somebody has set one; otherwise the viewer's
/// browser, which is what the console sends. A business has one working day, so
/// the column wins — without it two people in different places see different
/// numbers for "today" and both are right.
///
/// Falling back rather than defaulting to UTC: UTC would reset the day at half
/// past five in the morning for an Indian clinic, and a default that wrong is
/// worse than asking the browser.
async fn business_zone(client: &Client, organization: &str, viewer: Option<&str>) -> chrono_tz::Tz {
    let stated = client
        .database()
        .from("organizations")
        .select("timezone")
        .eq("id", organization)
        .execute::<Value>()
        .await
        .ok()
        .and_then(|rows| {
            rows.first()?.get("timezone").and_then(Value::as_str).map(str::to_owned)
        })
        .filter(|zone| !zone.is_empty());

    stated
        .as_deref()
        .and_then(|zone| zone.parse().ok())
        .or_else(|| viewer.and_then(|zone| zone.parse().ok()))
        .unwrap_or(chrono_tz::UTC)
}

/// The dashboard's stream: what is happening now, and what the day has come to.
///
/// Server-Sent Events end to end. The bridge pushes a frame the instant a call
/// starts, gains a human or ends, and whenever Asterisk says somebody went on or
/// off duty; this process gates that on the caller's organisation, adds the
/// day's totals — which only it can count, because it is the one holding a
/// session that RLS will accept — and forwards.
///
/// **Nothing here is on a timer.** The day's figures are recomputed when a
/// bridge frame arrives, which is exactly when they can have changed: a call
/// ending is both the reason the live count moved and the reason the day's
/// count moved. So one push carries both, and neither is ever a poll.
///
/// `tz` is the viewer's own timezone, because "today" is a question about the
/// person reading the screen. UTC would reset the day at half past five in the
/// morning for an Indian clinic, which is not what anybody means by today, and
/// there is no `organizations.timezone` to consult — worth adding the day two
/// people in different places need to agree on the number.
async fn dashboard_stream(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<axum::response::Response, ApiError> {
    use axum::response::sse::{Event, KeepAlive, Sse};
    use futures_util::StreamExt as _;

    let organization = org_id(&headers)?.to_owned();
    let client = authed_client(&state, &headers).await?;
    // Resolved once when the stream opens rather than per frame: a timezone
    // does not change between two calls ending, and re-reading it on every
    // push would be a query per event per viewer.
    let zone = business_zone(&client, &organization, query.get("tz").map(String::as_str)).await;

    let (base, token) = (
        std::env::var("BRIDGE_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".into()),
        std::env::var("BRIDGE_INTERNAL_TOKEN").unwrap_or_default(),
    );
    if token.is_empty() {
        return Err(ApiError::Configuration(
            "BRIDGE_INTERNAL_TOKEN is not set, so the bridge cannot be asked".into(),
        ));
    }

    // No timeout. Every other call to the bridge is a request and an answer;
    // this one is a subscription that should last as long as the screen is
    // open, and a 30-second timeout would tear it down every 30 seconds.
    let upstream = reqwest::Client::new()
        .get(format!("{base}/events/live?org_id={organization}"))
        .header("x-vokoo-internal", token)
        .send()
        .await
        .map_err(|error| ApiError::Upstream(format!("could not reach the bridge: {error}")))?;
    if !upstream.status().is_success() {
        return Err(ApiError::Upstream(format!("the bridge answered {}", upstream.status())));
    }

    let stream = upstream
        .bytes_stream()
        // Each bridge frame is `data: {…}\n\n`. Reassembling arbitrary chunk
        // boundaries would be a second SSE parser; the bridge writes one frame
        // per write and the hop is loopback, so a frame arrives whole.
        .filter_map(move |chunk| {
            let client = client.clone();
            let organization = organization.clone();
            async move {
                let text = String::from_utf8(chunk.ok()?.to_vec()).ok()?;
                let payload = text
                    .lines()
                    .find_map(|line| line.strip_prefix("data: "))?;
                let mut value: Value = serde_json::from_str(payload).ok()?;
                if let Some(object) = value.as_object_mut() {
                    object.insert("today".into(), today(&client, &organization, zone).await);
                }
                Some(Ok::<_, std::convert::Infallible>(
                    Event::default().data(value.to_string()),
                ))
            }
        });

    Ok(Sse::new(stream)
        .keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(15)))
        .into_response())
}

/// What the day has come to, counted from the call records.
///
/// From the database rather than from the bridge, which keeps no history: it
/// knows what is happening, not what happened. The reverse also holds, which is
/// why the live half does not come from here — `calls` has three rows still
/// marked `in-progress` from calls that died days ago, so counting those as
/// live would give a figure that only ever grows.
async fn today(client: &Client, organization: &str, zone: chrono_tz::Tz) -> Value {
    let midnight = chrono::Utc::now()
        .with_timezone(&zone)
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .and_then(|naive| naive.and_local_timezone(zone).earliest())
        .map(|local| local.with_timezone(&chrono::Utc))
        .unwrap_or_else(chrono::Utc::now);

    let rows = client
        .database()
        .from("calls")
        .select("duration_seconds,status")
        .eq("org_id", organization)
        .gte("started_at", &midnight.to_rfc3339())
        .execute::<Value>()
        .await
        .unwrap_or_default();

    let seconds: i64 = rows
        .iter()
        .filter_map(|row| row.get("duration_seconds").and_then(Value::as_i64))
        .sum();
    let finished = rows
        .iter()
        .filter(|row| row.get("status").and_then(Value::as_str) == Some("ended"))
        .count();

    json!({
        "answered": rows.len(),
        // Only the finished ones have a length, so the average is over those.
        // Dividing by every call would fold a call still in progress in as
        // zero and quietly drag the number down.
        "finished": finished,
        "seconds":  seconds,
        "timezone": zone.name(),
    })
}

/// What the line has been doing, bucketed for a chart.
///
/// The other half of the dashboard. The stream says what is happening; this says
/// what has been happening, which is a different question and belongs in a shape
/// you can see a trend in rather than a number.
///
/// Aggregated here rather than in SQL. A view over `calls` would need
/// `security_invoker = true` or it runs as its owner and hands every
/// organisation's calls to any signed-in user — the fault migration 0056 already
/// found here once, and it announces itself nowhere. Counting a few hundred rows
/// in this process cannot have that bug at all.
///
/// Both bucketings are in the viewer's timezone, because a day boundary and an
/// hour of the day are both questions about local time: "we are busy at 10am" is
/// meaningless in UTC for a clinic in Bangalore.
async fn dashboard_history(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    use chrono::{Datelike, TimeZone, Timelike};

    let organization = org_id(&headers)?.to_owned();
    let client = authed_client(&state, &headers).await?;
    let zone = business_zone(&client, &organization, query.get("tz").map(String::as_str)).await;
    // Bounded: a landing screen must not become an unbounded query somebody can
    // widen from the address bar.
    let days: i64 = query
        .get("days")
        .and_then(|d| d.parse().ok())
        .unwrap_or(14)
        .clamp(1, 90);

    let today_local = chrono::Utc::now().with_timezone(&zone).date_naive();
    let from = today_local - chrono::Duration::days(days - 1);
    let from_utc = from
        .and_hms_opt(0, 0, 0)
        .and_then(|naive| zone.from_local_datetime(&naive).earliest())
        .map(|local| local.with_timezone(&chrono::Utc))
        .unwrap_or_else(chrono::Utc::now);

    let rows = client
        .database()
        .from("calls")
        .select("started_at,ended_at,duration_seconds,status,direction")
        .eq("org_id", &organization)
        .gte("started_at", &from_utc.to_rfc3339())
        .execute::<Value>()
        .await
        .unwrap_or_default();

    // Every day in the window, including the ones with nothing in them. A chart
    // drawn only from days that had calls draws a straight line through a quiet
    // weekend and says business was steady.
    let mut by_day: Vec<(chrono::NaiveDate, i64, i64, i64)> = (0..days)
        .map(|offset| (from + chrono::Duration::days(offset), 0, 0, 0))
        .collect();
    let mut by_hour = [0i64; 24];
    // Monday..Sunday × 00..23. A flat 24-bar histogram averages Tuesday ten in
    // the morning together with Sunday ten in the morning and reports a busy
    // hour that may exist on no actual day.
    let mut heat = [[0i64; 24]; 7];
    // How long calls run. Four buckets rather than an average, because an
    // average of one twenty-second call and one four-minute call is a two-minute
    // call that never happened.
    let mut durations = [0i64; 4];
    // Every start and end in the window, for the concurrency sweep below.
    let mut edges: Vec<(chrono::DateTime<chrono::Utc>, i64)> = Vec::new();

    for row in &rows {
        let Some(started) = row
            .get("started_at")
            .and_then(Value::as_str)
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        else {
            continue;
        };
        let local = started.with_timezone(&zone);
        let seconds = row.get("duration_seconds").and_then(Value::as_i64).unwrap_or(0);
        let finished = row.get("status").and_then(Value::as_str) == Some("ended");

        by_hour[local.hour() as usize] += 1;
        heat[local.weekday().num_days_from_monday() as usize][local.hour() as usize] += 1;

        if finished {
            durations[match seconds {
                ..=59 => 0,
                60..=179 => 1,
                180..=299 => 2,
                _ => 3,
            }] += 1;
        }

        // An unfinished call contributes nothing to concurrency: its end is
        // unknown, and assuming it is still up would make every crashed call
        // from days ago count against today's peak — the same fault as reading
        // "live now" out of `ended_at is null`.
        let ends = row
            .get("ended_at")
            .and_then(Value::as_str)
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|e| e.with_timezone(&chrono::Utc))
            .or_else(|| {
                (seconds > 0)
                    .then(|| started.with_timezone(&chrono::Utc) + chrono::Duration::seconds(seconds))
            });
        if let Some(ends) = ends {
            edges.push((started.with_timezone(&chrono::Utc), 1));
            edges.push((ends, -1));
        }

        if let Some(bucket) = by_day.iter_mut().find(|(date, ..)| *date == local.date_naive()) {
            bucket.1 += 1;
            bucket.2 += seconds;
            bucket.3 += i64::from(finished);
        }
    }

    // How many calls were up at once, at their worst each day.
    //
    // A sweep over starts and ends rather than a per-minute scan: the answer is
    // only ever a running total that changes at an edge, and a scan would be a
    // choice of resolution that could miss a peak between two samples.
    //
    // Ends sort before starts at the same instant, so one call ending as another
    // begins is not counted as two calls at once.
    edges.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    let mut peaks: std::collections::HashMap<chrono::NaiveDate, i64> =
        std::collections::HashMap::new();
    let mut running = 0i64;
    for (at, delta) in &edges {
        running += delta;
        if *delta > 0 {
            let day = at.with_timezone(&zone).date_naive();
            let peak = peaks.entry(day).or_insert(0);
            *peak = (*peak).max(running);
        }
    }

    let days_out: Vec<Value> = by_day
        .iter()
        .map(|(date, calls, seconds, finished)| {
            json!({
                "date":     date.to_string(),
                "label":    format!("{} {}", date.day(), month(date.month())),
                "calls":    calls,
                "seconds":  seconds,
                "finished": finished,
                // Over the finished ones only. Including a call still in
                // progress folds it in as zero and drags the average down.
                "average":  if *finished > 0 { seconds / finished } else { 0 },
            })
        })
        .collect();

    let hours_out: Vec<Value> = by_hour
        .iter()
        .enumerate()
        .map(|(hour, calls)| json!({ "hour": hour, "calls": calls }))
        .collect();

    // Flat rather than nested: the console draws a grid, and a grid is a list
    // of cells. Nesting would make it unpack an array of arrays to do the same.
    let heat_out: Vec<Value> = heat
        .iter()
        .enumerate()
        .flat_map(|(day, hours)| {
            hours.iter().enumerate().map(move |(hour, calls)| {
                json!({ "day": day, "hour": hour, "calls": calls })
            })
        })
        .collect();

    let duration_labels = ["Under 1m", "1–3m", "3–5m", "Over 5m"];
    let durations_out: Vec<Value> = durations
        .iter()
        .enumerate()
        .map(|(i, calls)| json!({ "label": duration_labels[i], "calls": calls }))
        .collect();

    let concurrency_out: Vec<Value> = by_day
        .iter()
        .map(|(date, ..)| {
            json!({
                "label": format!("{} {}", date.day(), month(date.month())),
                "peak":  peaks.get(date).copied().unwrap_or(0),
            })
        })
        .collect();

    Ok(Json(ApiResponse {
        data: json!({
            "days":        days_out,
            "hours":       hours_out,
            "heatmap":     heat_out,
            "durations":   durations_out,
            "concurrency": concurrency_out,
            // The carrier's own limit, so the console does not carry a number
            // that would silently disagree with the platform if it changed.
            // Three concurrent calls per extension; a fourth caller gets SIP
            // 486 and the bridge never sees them.
            "capacity":    3,
            "total":       rows.len(),
            "timezone":    zone.name(),
        }),
        meta: json!({ "resource": "dashboard", "days": days }),
    }))
}

fn month(m: u32) -> &'static str {
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        [(m as usize).saturating_sub(1).min(11)]
}

/// Put a supervisor on a live call: listen, whisper, or barge.
///
/// **This half decides whether; the bridge decides how.** Listening to a
/// colleague's live call is surveillance, so three things happen here that the
/// bridge cannot do — it is behind a shared secret and would monitor anything
/// asked of it.
///
/// 1. **The caller's role.** Only an owner or an admin of the organisation.
/// 2. **The supervisor's own extension**, looked up from their auth user rather
///    than taken from the request. Accepting an endpoint from the browser would
///    let anyone ring anyone: the request would name the person to connect, and
///    the only thing stopping it would be that the console does not offer it.
/// 3. **A record.** Who listened to which call and when, in `call_events`,
///    written before the request is forwarded — a monitoring session that
///    happened and was not recorded is worse than one that was refused.
#[derive(serde::Deserialize)]
struct MonitorBody {
    /// `listen`, `whisper` or `barge`.
    mode: String,
    /// What to say, when whispering to an AI agent.
    note: Option<String>,
}

async fn monitor_call(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<MonitorBody>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    if !matches!(body.mode.as_str(), "listen" | "whisper" | "barge") {
        return Err(ApiError::BadRequest(format!("unknown mode '{}'", body.mode)));
    }

    let organization = org_id(&headers)?.to_owned();
    let client = authed_client(&state, &headers).await?;
    let user = client
        .current_user()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?
        .ok_or_else(|| ApiError::unauthorized("no current user"))?;
    let user_id = user.id.to_string();

    // 1. Role. RLS would let any member read the call; monitoring one live is a
    // different act, and the table cannot express that.
    // `execute` and take the first, not `single_execute`. PostgREST answers a
    // zero-row single-object request with PGRST116 rather than an empty result,
    // so `single_execute` turns "this person is not a member" into a 502 about
    // a database error. Both lookups here can legitimately match nothing.
    let role = client
        .database()
        .from("memberships")
        .select("role")
        .eq("user_id", &user_id)
        .eq("org_id", &organization)
        .execute::<Value>()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?
        .first()
        .and_then(|row| row.get("role").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_default();
    if !matches!(role.as_str(), "owner" | "admin") {
        return Err(ApiError::Forbidden(
            "listening to a live call is limited to owners and admins".into(),
        ));
    }

    // 2. Their own extension. Never one named by the request.
    let endpoint = client
        .database()
        .from("agent_extensions")
        .select("endpoint")
        .eq("user_id", &user_id)
        .eq("org_id", &organization)
        .eq("status", "active")
        .execute::<Value>()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?
        .first()
        .and_then(|row| row.get("endpoint").and_then(Value::as_str).map(str::to_owned));

    // Whispering to an AI is text and rings nobody, so it is the one mode that
    // works without the supervisor having an extension of their own.
    if endpoint.is_none() && !(body.mode == "whisper" && body.note.is_some()) {
        return Err(ApiError::BadRequest(
            "you need an extension of your own to hear a call — add yourself under Manage → Team"
                .into(),
        ));
    }

    // 3. The record, before the act. A monitoring session that happened and was
    // not written down is worse than one that was refused.
    // Written against the table's real columns, not invented ones: `call_events`
    // has no `kind`, and a row that fails to insert is an audit trail that does
    // not exist. `sequence` is not null and has no default — a monitoring event
    // has no place in the flow's own numbering, so it is 0 and the trigger event
    // says what it actually is.
    if let Ok(insert) = client.database().insert("call_events").values(json!({
        "call_id":       id,
        "org_id":        organization,
        "sequence":      0,
        "trigger_event": "supervisor",
        "node_name":     body.mode,
        "implementation": "monitor",
        "outcome":       body.mode,
        "detail":   {
            "by":       user_id,
            "endpoint": endpoint,
            // The words themselves. What was whispered to an agent is exactly
            // what an audit of a whisper is for.
            "note":     body.note,
        },
    })) {
        // A failed write is logged, not fatal. Refusing to connect a supervisor
        // because an audit row would not insert turns a record-keeping problem
        // into a call nobody could listen to; the warning is what gets chased.
        if let Err(error) = insert.returning("id").execute::<Value>().await {
            warn!("monitor on {id} was not recorded: {error}");
        }
    }

    call_bridge(
        &state,
        &headers,
        "/call/monitor",
        json!({
            "call_id":  id,
            "mode":     body.mode,
            "endpoint": endpoint,
            "note":     body.note,
        }),
    )
    .await
}

/// Add a member, and optionally give them an extension.
///
/// **One action, because they are one person.** A membership was previously a
/// fact about an *account* — `user_id` was `not null` — so nobody could be added
/// before they had signed in, and the "Invite Member" button did nothing because
/// there was no row shape for the state it wanted to create.
///
/// The extension is the point for most of them. A receptionist needs a number
/// and the desktop app; their job never touches the console, so requiring an
/// auth account first was requiring a thing they will never use. `membership_id`
/// carries the link, and `user_id` fills itself in from `claim_membership()`
/// the day they do sign in.
///
/// The SIP password is generated here and returned **once**. It cannot be
/// hashed — digest authentication needs the plaintext to compute a response —
/// so it is a credential rather than a field, and no route returns it again.
#[derive(serde::Deserialize)]
struct AddMemberBody {
    /// What to call them. Shown to a caller when they are brought onto a call.
    name: String,
    /// Where they will sign in, when they do. Optional: somebody who only ever
    /// answers the phone may never need one.
    email: Option<String>,
    role: String,
    /// Three to six digits, or nothing if they do not take calls.
    extension: Option<String>,
}

async fn add_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AddMemberBody>,
) -> Result<(StatusCode, Json<ApiResponse<Value>>), ApiError> {
    let organization = org_id(&headers)?.to_owned();
    let client = authed_client(&state, &headers).await?;

    if body.name.trim().is_empty() {
        return Err(ApiError::BadRequest("a member needs a name".into()));
    }
    if !matches!(body.role.as_str(), "admin" | "developer" | "viewer" | "agent") {
        // `owner` is deliberately absent. There is one, it is whoever created
        // the workspace, and handing it out from an add form is not a thing to
        // discover you have done.
        return Err(ApiError::BadRequest(format!("'{}' is not a role", body.role)));
    }

    let mut membership = client
        .database()
        .insert("memberships")
        .values(json!({
            "org_id":        organization,
            "role":          body.role,
            "display_name":  body.name.trim(),
            "invited_email": body.email.as_deref().map(str::trim).filter(|e| !e.is_empty()),
        }))
        .map_err(|error| ApiError::BadRequest(error.to_string()))?
        .returning("id,role,display_name,invited_email")
        .execute::<Value>()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    let person = membership
        .pop()
        .ok_or_else(|| ApiError::upstream("the membership was not created"))?;
    let membership_id = person.get("id").and_then(Value::as_str).unwrap_or_default().to_owned();

    // An address means they will sign in, so invite them. Reported beside the
    // member rather than failing the request: they have been added whether or
    // not the mail server answered, and a receptionist who never signs in is a
    // legitimate member with no invitation at all.
    let invited = match body.email.as_deref().map(str::trim).filter(|e| !e.is_empty()) {
        None => json!({ "sent": false, "reason": "no address, so nothing to send" }),
        Some(email) => match send_sign_in_link(email, None, true).await {
            Ok(()) => json!({ "sent": true, "to": email }),
            Err(problem) => {
                warn!("member added but the invitation failed: {problem}");
                json!({ "sent": false, "reason": problem })
            }
        },
    };

    let Some(extension) = body.extension.as_deref().map(str::trim).filter(|e| !e.is_empty())
    else {
        return Ok((StatusCode::CREATED, Json(ApiResponse {
            data: json!({ "person": person, "invitation": invited }),
            meta: json!({ "resource": "members" }),
        })));
    };

    let password = sip_password();
    let mut rows = client
        .database()
        .insert("agent_extensions")
        .values(json!({
            "org_id":        organization,
            "membership_id": membership_id,
            "display_name":  body.name.trim(),
            "extension":     extension,
            "sip_password":  password,
            "status":        "active",
        }))
        .map_err(|error| ApiError::BadRequest(error.to_string()))?
        // `endpoint` is derived by the database from the org's slug, so it is
        // read back rather than composed here: the caller must be shown the
        // name Asterisk will actually know.
        .returning("id,extension,endpoint")
        .execute::<Value>()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;

    let Some(row) = rows.pop() else {
        // The member exists; only the extension failed. Said plainly rather
        // than rolled back, because deleting somebody just created
        // is a worse surprise than telling them to add the number again.
        return Err(ApiError::upstream(
            "the member was added but the extension was not — that number may already be taken",
        ));
    };

    Ok((StatusCode::CREATED, Json(ApiResponse {
        data: json!({
            "person": person,
            "extension": row,
            "sip_password": password,
            "invitation": invited,
        }),
        meta: json!({ "resource": "members" }),
    })))
}

/// A SIP password, from the OS's own randomness.
///
/// Generated server-side for this route so the browser is not the source of a
/// credential it then posts back — and with the same alphabet the console uses,
/// which excludes characters that break a `key=value` line or read ambiguously
/// when somebody copies them by hand.
fn sip_password() -> String {
    use rand::Rng;
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();
    (0..24).map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char).collect()
}

/// Set your own name in this workspace.
///
/// Through `set_my_display_name` rather than a PATCH on `memberships`: that
/// table is admin-writable, and the tempting fix — an RLS policy letting a
/// member update their own row — cannot work, because **a policy cannot
/// restrict a column**. It would let anybody set their own role to `owner`
/// through a name field. The function writes one column, and the column list is
/// the constraint.
#[derive(serde::Deserialize)]
struct ProfileBody {
    name: String,
}

async fn set_my_name(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ProfileBody>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let organization = org_id(&headers)?.to_owned();
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc(
            "set_my_display_name",
            Some(json!({ "p_org": organization, "p_name": body.name })),
        )
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "me" }) }))
}

/// Send somebody a link that signs them in.
///
/// **Through GoTrue's own `/otp`, with the anon key.** Creating a user or
/// sending an admin invite needs `service_role`, and this process deliberately
/// holds none — a process with that key can read every table in every
/// organisation. `/otp` is a public endpoint by design: it takes an address and
/// emails a single-use link, and it is the same mechanism a person uses to sign
/// themselves in.
///
/// Which is why the invitation *is* the email rather than a password handed
/// over. The membership already exists carrying their address, so
/// `claim_membership()` attaches them the moment they follow it.
///
/// Failure is reported and never fatal to the caller. Somebody who has been
/// added to a workspace has been added whether or not the mail server was
/// reachable at that second, and rolling back a person because an email bounced
/// would be the wrong half to undo.
///
/// ## `create_user` is the caller's authority, not a convenience
///
/// An invitation is sent by a member of the workspace, who is entitled to bring
/// somebody in — so it creates the account. The self-service route below is
/// **unauthenticated**, because asking somebody to sign in before they can be
/// sent a way to sign in is a circle; with `create_user: true` it would be an
/// open endpoint that fills `auth.users` with any address a stranger types.
/// False there means the route only ever mails an account that already exists.
async fn send_sign_in_link(
    email: &str,
    origin: Option<&str>,
    create_user: bool,
) -> Result<(), String> {
    let (base, anon) = (
        std::env::var("SUPABASE_URL").unwrap_or_else(|_| "http://127.0.0.1:8000".into()),
        std::env::var("SUPABASE_ANON_KEY").unwrap_or_default(),
    );
    if anon.is_empty() {
        return Err("SUPABASE_ANON_KEY is not set, so no invitation can be sent".into());
    }

    let mut body = json!({ "email": email, "create_user": create_user });
    let mut redirect: Option<String> = None;

    // Where the link lands, when the caller named somewhere.
    //
    // Without this every link goes to `SITE_URL`, which is one host — so an
    // operator asking the platform portal for a link is sent to the console,
    // whose origin cannot read the session the portal would store.
    //
    // **Checked against `CORS_ORIGIN` before it is passed on.** A redirect
    // taken from a request is an open redirect, and on a magic link that is
    // the whole account: ask for a link to somebody else's address, point it
    // at a host you control, and the token arrives in your own fragment.
    // GoTrue enforces its own `GOTRUE_URI_ALLOW_LIST` as well — this is the
    // near guard, and neither is trusted to be the only one.
    // **An invitation has no browser origin, and still needs a destination.**
    //
    // Without one GoTrue falls back to `SITE_URL`, which lands the tokens in
    // the fragment of the site root rather than at the callback — and the root
    // is the sign-in screen. Measured: `location: https://console.sarvathra.ai#access_token=…`.
    //
    // `CONSOLE_URL` is where a person invited to a workspace belongs, which is
    // never the operator portal, so this is not the caller's origin even when
    // there is one to borrow.
    let fallback = std::env::var("CONSOLE_URL").ok();
    let origin = origin.or(fallback.as_deref());

    if let Some(origin) = origin {
        let permitted = std::env::var("CORS_ORIGIN").unwrap_or_default();
        let known = permitted
            .split(',')
            .map(str::trim)
            .any(|allowed| !allowed.is_empty() && allowed == origin);
        if !known {
            return Err(format!("{origin} is not a host this installation serves"));
        }
        // **A query parameter, not a body field.**
        //
        // Both `options.email_redirect_to` and a top-level `email_redirect_to`
        // were sent here, on the assumption that one of them would be read.
        // Neither is: GoTrue takes `redirect_to` from the query string on
        // `/otp`, which is where supabase-js puts it, and silently ignores the
        // body.
        //
        // So every link this system has ever sent fell back to `SITE_URL` —
        // the console root — with the tokens in a fragment nothing read. That
        // is the whole of "the link just takes me back to the login page",
        // and it cost several wrong fixes before anybody looked at where the
        // parameter goes.
        redirect = Some(format!("{origin}/auth/callback"));
    }

    let mut request = reqwest::Client::new()
        .post(format!("{}/auth/v1/otp", base.trim_end_matches('/')))
        .header("apikey", &anon)
        .header("Content-Type", "application/json");

    if let Some(to) = &redirect {
        request = request.query(&[("redirect_to", to.as_str())]);
    }

    let response = request
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("could not reach the mail path: {error}"))?;

    let status = response.status();
    if status.is_success() {
        return Ok(());
    }

    // **A refusal to send is worth distinguishing.** GoTrue rate-limits these,
    // and answering "a link is on its way" when it sent nothing is the failure
    // that looks exactly like a broken link.
    if status.as_u16() == 429 {
        return Err("rate_limited".into());
    }
    Err(format!(
        "the invitation was refused: {} {}",
        status,
        response.text().await.unwrap_or_default()
    ))
}

/* ---------------------------------------------------------------- operator */

/// Routes for whoever runs the platform, as distinct from whoever uses it.
///
/// **None of these take `x-org-id`.** An operator belongs to no tenant — every
/// table gates on `is_org_member`, so RLS shows them nothing — which is exactly
/// why the work happens inside `security definer` functions guarded by
/// `is_platform_admin()`. Requiring an organisation header here would be
/// pretending they act from inside one.
///
/// The guard lives in the database rather than here, deliberately: a check in
/// this process protects this process, and the functions are reachable through
/// PostgREST by anything holding a token. Putting it on the first line of each
/// function body is what makes it true for every caller.
async fn operator_tenants(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("operator_tenants", None)
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "tenants" }) }))
}

/// Whether the caller runs the platform.
///
/// So the console can decide whether to offer the operator navigation at all.
/// Hiding it is a courtesy, not the control — every route above refuses on its
/// own, and a menu item is not a permission.
async fn operator_me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("is_platform_admin", None)
        .await
        .unwrap_or(Value::Bool(false));
    Ok(Json(ApiResponse {
        data: json!({ "operator": data == Value::Bool(true) }),
        meta: json!({ "resource": "operator" }),
    }))
}

#[derive(serde::Deserialize)]
struct TenantBody {
    plan: Option<String>,
    status: Option<String>,
}

async fn operator_set_tenant(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<TenantBody>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    client
        .database()
        .rpc(
            "operator_set_tenant",
            Some(json!({ "p_org": id, "p_plan": body.plan, "p_status": body.status })),
        )
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data: json!({ "ok": true }), meta: json!({ "resource": "tenants" }) }))
}

async fn operator_entitlements(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("operator_entitlements", Some(json!({ "p_org": id })))
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "entitlements" }) }))
}

/// One tenant, in the three shapes its detail screen asks for.
///
/// Three routes rather than one that returns everything: they change at
/// different rates and cost different amounts. Usage is a series over a window
/// the reader chooses; configuration is a single row that only changes when
/// somebody changes it. Bundling them would mean re-reading a month of calls to
/// find out whether recording is on.
/// The engines a workspace may attach to an agent.
///
/// A name and a description, never `config`. See `available_engines` in 0091:
/// what an engine is made of is the platform's, and the model names inside one
/// are the part a customer would shop on.
async fn list_available_engines(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let organization = org_id(&headers)?.to_owned();
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("available_engines", Some(json!({ "p_org": organization })))
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "engines" }) }))
}

/// The price list.
async fn operator_plans(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("operator_plans", None)
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "plans" }) }))
}

async fn operator_set_plan(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(patch): Json<Value>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("operator_set_plan", Some(json!({ "p_plan": id, "p_patch": patch })))
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "plans" }) }))
}

/// Every workspace's current period: allowance, use, and what is owed.
async fn operator_billing_periods(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("operator_billing_periods", None)
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "periods" }) }))
}

/// One workspace's period. Also what a tenant would call to see its own.
async fn tenant_billing_period(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("billing_period_usage", Some(json!({ "p_org": id })))
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "period" }) }))
}

/// Open this month's period, closing whatever preceded it.
///
/// Idempotent, so a retry inside the same month returns the period already
/// open rather than starting a second — which matters because nothing rolls
/// these automatically yet and an operator will press this twice.
async fn operator_open_period(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("open_billing_period", Some(json!({ "p_org": id })))
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "period" }) }))
}

/// What the reader and timezone fields may be set to.
///
/// Served rather than hard-coded in the console, so the dropdown cannot offer
/// something `operator_set_tenant_settings` will refuse — and so the reader
/// list stays the same list `intelligence.rs` works from.
async fn setting_choices(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let readers = client
        .database()
        .rpc("reader_choices", None)
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    let zones = client
        .database()
        .rpc("timezone_choices", None)
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;

    Ok(Json(ApiResponse {
        data: json!({ "readers": readers, "timezones": zones }),
        meta: json!({ "resource": "choices" }),
    }))
}

/// The starter packs, and what each one seeds.
///
/// A pack is what a workspace is built from on the day it signs up: agents and
/// a flow, copied, pointed at a platform engine that is only named. It replaced
/// a flat list of templates, which made one starting point for every customer
/// and was wrong the moment the second customer was not a clinic.
async fn operator_packs(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("operator_packs", None)
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "packs" }) }))
}

/// One engine, whole — config included. The operator composes it.
async fn operator_engine(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("operator_engine", Some(json!({ "p_id": id })))
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "engine" }) }))
}

/// Edit one. The patch is applied column by column in the database, so a key
/// this route has never heard of cannot reach a column.
async fn operator_update_engine(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(patch): Json<Value>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("operator_update_engine", Some(json!({ "p_id": id, "p_patch": patch })))
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "engine" }) }))
}

#[derive(serde::Deserialize)]
struct NewEngineBody {
    name: String,
    mode: String,
}

async fn operator_create_engine(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<NewEngineBody>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc(
            "operator_create_engine",
            Some(json!({ "p_name": body.name, "p_mode": body.mode })),
        )
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "engine" }) }))
}

/// Every engine on the platform, with what it is sold for.
async fn operator_engines(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("operator_engines", None)
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "engines" }) }))
}

#[derive(serde::Deserialize)]
struct EnginePriceBody {
    /// `None` clears the price, which reads as unpriced rather than as free.
    per_minute: Option<f64>,
    per_call: Option<f64>,
    currency: Option<String>,
}

async fn operator_set_engine_price(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<EnginePriceBody>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc(
            "operator_set_engine_price",
            Some(json!({
                "p_engine": id,
                "p_per_minute": body.per_minute,
                "p_per_call": body.per_call,
                "p_currency": body.currency.unwrap_or_else(|| "INR".into()),
            })),
        )
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "engine_price" }) }))
}

/// What each engine has earned, and on how many sessions nobody has priced.
async fn operator_engine_revenue(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("operator_engine_revenue", Some(json!({ "p_days": 30 })))
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "engine_revenue" }) }))
}

/// Settings an operator changes on a customer's behalf.
///
/// The patch is applied column by column in the database, so a key this route
/// has never heard of cannot reach a column — and plan and status are
/// deliberately absent, because they have their own function.
async fn operator_set_tenant_settings(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(patch): Json<Value>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc(
            "operator_set_tenant_settings",
            Some(json!({ "p_org": id, "p_patch": patch })),
        )
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "settings" }) }))
}

#[derive(serde::Deserialize)]
struct EngineAccessBody {
    engine_id: String,
    /// `null` clears the override and returns the tenant to whatever the plan
    /// says — the third state, which is what makes revoking possible without
    /// editing the plan for everybody on it.
    allowed: Option<bool>,
}

async fn operator_set_engine_access(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<EngineAccessBody>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc(
            "operator_set_engine_access",
            Some(json!({ "p_org": id, "p_engine": body.engine_id, "p_allowed": body.allowed })),
        )
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "engine_access" }) }))
}

/// The people in a workspace.
async fn operator_members(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("operator_members", Some(json!({ "p_org": id })))
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "members" }) }))
}

#[derive(serde::Deserialize)]
struct MemberActionBody {
    user_id: Option<String>,
    membership_id: Option<String>,
    password: Option<String>,
    email: Option<String>,
    /// "set_password" | "send_link" | "remove"
    action: String,
}

/// Getting a locked-out customer back in.
///
/// Three actions on one route because they are one job — the operator is on a
/// support call and needs whichever works. Sending a link is preferred and
/// listed first in the UI; a password is for somebody whose mail is the thing
/// that is broken.
async fn operator_member_action(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<MemberActionBody>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;

    let data = match body.action.as_str() {
        "set_password" => {
            let user = body.user_id.ok_or_else(|| ApiError::BadRequest("user_id is required".into()))?;
            let password = body
                .password
                .ok_or_else(|| ApiError::BadRequest("password is required".into()))?;
            client
                .database()
                .rpc(
                    "operator_set_member_password",
                    Some(json!({ "p_org": id, "p_user": user, "p_password": password })),
                )
                .await
                .map_err(|error| ApiError::upstream(error.to_string()))?
        }
        "send_link" => {
            let email = body
                .email
                .ok_or_else(|| ApiError::BadRequest("email is required".into()))?;
            // No origin: an invited member signs in at the console, and the
            // operator is on a different host. `SITE_URL` is the right default
            // here for exactly that reason.
            match send_sign_in_link(&email, None, false).await {
                Ok(()) => json!({ "sent": true }),
                Err(problem) => json!({ "sent": false, "reason": problem }),
            }
        }
        "remove" => {
            let membership = body
                .membership_id
                .ok_or_else(|| ApiError::BadRequest("membership_id is required".into()))?;
            client
                .database()
                .rpc(
                    "operator_remove_member",
                    Some(json!({ "p_org": id, "p_membership": membership })),
                )
                .await
                .map_err(|error| ApiError::upstream(error.to_string()))?
        }
        other => return Err(ApiError::BadRequest(format!("no such action: {other}"))),
    };

    Ok(Json(ApiResponse { data, meta: json!({ "resource": "members" }) }))
}

async fn operator_tenant_usage(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc(
            "operator_tenant_usage",
            Some(json!({ "p_org": id, "p_days": 30 })),
        )
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "usage" }) }))
}

async fn operator_tenant_billing(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc(
            "operator_tenant_billing",
            Some(json!({ "p_org": id, "p_days": 30 })),
        )
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "billing" }) }))
}

async fn operator_tenant_config(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("operator_tenant_config", Some(json!({ "p_org": id })))
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "config" }) }))
}

#[derive(serde::Deserialize)]
struct EntitlementBody {
    kind: String,
    item_id: String,
    /// `null` clears the override and returns the tenant to whatever the plan
    /// says — which is why this is an `Option` rather than a bool.
    allowed: Option<bool>,
}

async fn operator_set_entitlement(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<EntitlementBody>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    client
        .database()
        .rpc(
            "operator_set_entitlement",
            Some(json!({
                "p_org": id,
                "p_kind": body.kind,
                "p_item": body.item_id,
                "p_allowed": body.allowed,
            })),
        )
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data: json!({ "ok": true }), meta: json!({ "resource": "entitlements" }) }))
}

#[derive(serde::Deserialize)]
struct NewTenantBody {
    name: String,
    slug: String,
    owner_email: Option<String>,
    plan: Option<String>,
}

/// Create a workspace, and invite whoever will own it.
///
/// Two things that must not be one: the workspace exists whether or not the
/// email lands, so a mail failure is reported beside the created tenant rather
/// than failing the request. Rolling back a workspace because an invitation
/// bounced would undo the half that worked.
async fn operator_create_tenant(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<NewTenantBody>,
) -> Result<(StatusCode, Json<ApiResponse<Value>>), ApiError> {
    let client = authed_client(&state, &headers).await?;
    let created = client
        .database()
        .rpc(
            "operator_create_tenant",
            Some(json!({
                "p_name": body.name,
                "p_slug": body.slug,
                "p_owner_email": body.owner_email,
                "p_plan": body.plan,
            })),
        )
        .await
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;

    let invited = match body.owner_email.as_deref().map(str::trim).filter(|e| !e.is_empty()) {
        None => json!({ "sent": false, "reason": "no owner address was given" }),
        Some(email) => match send_sign_in_link(email, None, true).await {
            Ok(()) => json!({ "sent": true, "to": email }),
            Err(problem) => {
                warn!("tenant created but the invitation failed: {problem}");
                json!({ "sent": false, "reason": problem })
            }
        },
    };

    Ok((
        StatusCode::CREATED,
        Json(ApiResponse {
            data: json!({ "tenant": created, "invitation": invited }),
            meta: json!({ "resource": "tenants" }),
        }),
    ))
}

/// The keys a tenant's calls run on when it does not bring its own.
///
/// Guarded by `is_platform_admin()` in the database, like every other operator
/// function. **No route returns a key** — the listing carries the last four
/// characters and a date, which is enough to tell two keys apart and useless to
/// anybody who obtains it.
async fn operator_platform_keys(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("operator_platform_keys", None)
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "platform_keys" }) }))
}

#[derive(serde::Deserialize)]
struct PlatformKeyBody {
    secret: String,
    label: Option<String>,
}

async fn operator_set_platform_key(
    State(state): State<AppState>,
    Path(vendor): Path<String>,
    headers: HeaderMap,
    Json(body): Json<PlatformKeyBody>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc(
            "operator_set_platform_key",
            Some(json!({
                "p_vendor": vendor,
                "p_secret": body.secret,
                "p_label": body.label,
            })),
        )
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "platform_keys" }) }))
}

async fn operator_delete_platform_key(
    State(state): State<AppState>,
    Path(vendor): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("operator_delete_platform_key", Some(json!({ "p_vendor": vendor })))
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "platform_keys" }) }))
}

async fn operator_numbers(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("operator_numbers", None)
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "numbers" }) }))
}

#[derive(serde::Deserialize)]
struct NewNumberBody {
    number: String,
    label: Option<String>,
    carrier: Option<String>,
}

async fn operator_add_number(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<NewNumberBody>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc(
            "operator_add_number",
            Some(json!({
                "p_number": body.number,
                "p_label": body.label,
                "p_carrier": body.carrier,
            })),
        )
        .await
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "numbers" }) }))
}

#[derive(serde::Deserialize)]
struct AssignNumberBody {
    /// `null` releases it back to the pool.
    org_id: Option<String>,
}

async fn operator_assign_number(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<AssignNumberBody>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc(
            "operator_assign_number",
            Some(json!({ "p_number_id": id, "p_org": body.org_id })),
        )
        .await
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "numbers" }) }))
}

/// The templates a new workspace is built from.
///
/// Read-only for now, and the screen says so: these are seeded rows, and an
/// editor for them is a different piece of work from being able to see what a
/// tenant will get. Listing them is what stops "what does a new workspace
/// contain" being a question only the database can answer.
async fn operator_templates(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<Value>>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let rows = client
        .database()
        .from("templates")
        .select("id,kind,audience,label,summary,sort_order,is_active")
        .order("kind", supabase::types::OrderDirection::Ascending)
        .execute::<Value>()
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data: rows, meta: json!({ "resource": "templates" }) }))
}

/// Seed a workspace from the templates it is entitled to.
async fn operator_seed(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("seed_workspace", Some(json!({ "p_org": id })))
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse { data, meta: json!({ "resource": "tenants" }) }))
}

async fn preflight_engine(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    call_bridge(&state, &headers, "/engine/preflight", json!({ "engine_id": id })).await
}

/// Walk a flow against a finished call, changing nothing.
///
/// What the node view's Input and Output panes show. Gated here on the caller's
/// organisation and forwarded with the shared secret, like pre-flight — the
/// bridge answers because reading a transcript needs a provider key and it is
/// the only process allowed to hold one.
#[derive(serde::Deserialize)]
struct DryRunBody {
    /// A finished call to run against. Its transcript is the test data.
    ucid: String,
}

async fn dry_run_flow(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<DryRunBody>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    call_bridge(&state, &headers, "/flow/dryrun", json!({ "flow_id": id, "ucid": body.ucid })).await
}

async fn refresh_catalogue(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let organization = org_id(&headers)?.to_owned();
    call_bridge(&state, &headers, "/catalogue/refresh", json!({ "org_id": organization })).await
}

async fn test_credential(
    State(state): State<AppState>,
    Path(vendor): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<TestCredentialRequest>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    // Behind the same gate as everything else: this makes an outbound request
    // on the operator's behalf, so it is not for anonymous callers.
    let _ = org_id(&headers)?;
    let _ = authed_client(&state, &headers).await?;

    let secret = payload.secret.trim().to_owned();
    if secret.is_empty() {
        return Err(ApiError::BadRequest("a key is required".into()));
    }

    let probe = match vendor.as_str() {
        "openai" => Some(("https://api.openai.com/v1/models", "bearer")),
        "gemini" => Some(("https://generativelanguage.googleapis.com/v1beta/models", "goog")),
        "deepgram" => Some(("https://api.deepgram.com/v1/projects", "token")),
        _ => None,
    };

    let Some((url, scheme)) = probe else {
        return Ok(Json(ApiResponse {
            data: json!({ "supported": false }),
            meta: json!({ "resource": "vendors", "action": "test" }),
        }));
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|error| ApiError::Upstream(error.to_string()))?;

    let request = match scheme {
        "bearer" => client.get(url).header("Authorization", format!("Bearer {secret}")),
        "token" => client.get(url).header("Authorization", format!("Token {secret}")),
        // Google takes the key in its own header, not in Authorization.
        _ => client.get(url).header("x-goog-api-key", secret.as_str()),
    };

    let response = match request.send().await {
        Ok(response) => response,
        // A network failure is not a bad key, and saying so would send somebody
        // to rotate one that is fine.
        Err(error) => {
            return Ok(Json(ApiResponse {
                data: json!({
                    "supported": true,
                    "ok": false,
                    "reason": format!("could not reach {vendor}: {error}"),
                }),
                meta: json!({ "resource": "vendors", "action": "test" }),
            }))
        }
    };

    let status = response.status();
    let ok = status.is_success();
    Ok(Json(ApiResponse {
        data: json!({
            "supported": true,
            "ok": ok,
            "status": status.as_u16(),
            "reason": if ok {
                Value::Null
            } else if matches!(status.as_u16(), 401 | 403) {
                json!(format!("{vendor} rejected this key"))
            } else {
                json!(format!("{vendor} answered {status}"))
            },
        }),
        meta: json!({ "resource": "vendors", "action": "test" }),
    }))
}

async fn delete_credential(
    State(state): State<AppState>,
    Path(vendor): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    let organization = org_id(&headers)?.to_owned();
    let client = authed_client(&state, &headers).await?;
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
    let client = authed_client(&state, &headers).await?;
    let row = client
        .database()
        .from("organizations")
        .select("*")
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
    let client = authed_client(&state, &headers).await?;
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
    // An allowlist, not the whole row. `slug` is deliberately absent: it is half
    // of every agent's PJSIP endpoint name, and `set_agent_endpoint()` re-derives
    // those on write — so renaming it would rename every endpoint Asterisk knows
    // and break every registration at once.
    let mut body = Map::new();
    for field in [
        "name",
        "settings",
        // The business's own clock. Everything that says "today" reads this.
        "timezone",
        // Where a failed call goes when no exception flow is bound. Wrong here
        // means a caller hearing silence, which is why it is worth a field
        // rather than a row somebody edits in SQL.
        "escalation_number",
        // How long a call's *content* is kept. Null keeps everything, which is
        // what happens today.
        "retention_days",
        // Who reads the calls afterwards.
        "intelligence_provider",
        "intelligence_model",
        // How the line behaves.
        "max_concurrent_calls",
        // What is kept.
        "record_calls",
        "redact_transcripts",
        // What we are obliged to do. Writable through the API because the
        // column has to be settable eventually; the console renders these
        // read-only until outbound exists to honour them, because a compliance
        // setting that stores and does not enforce is worse than one you cannot
        // change.
        "dnd_scrubbing",
        "calling_window_start",
        "calling_window_end",
        "daily_call_cap",
        "announce_recording",
    ] {
        if let Some(value) = input.get(field) {
            body.insert(field.into(), value.clone());
        }
    }
    if body.is_empty() {
        return Err(ApiError::BadRequest(
            "nothing to update — the slug cannot be changed, because every agent's \
             SIP endpoint is derived from it"
                .into(),
        ));
    }
    let client = authed_client(&state, &headers).await?;
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

/// Everyone in the organisation, with their extension if they have one.
///
/// Through `org_people` rather than a select on `memberships`, for a reason the
/// old version made visible: **an email is not in `memberships`.** It lives in
/// `auth.users`, PostgREST serves only the `public` schema, and the screen was
/// left rendering the first eight characters of a uuid. The function joins the
/// three tables a person is spread across — membership, auth user, extension —
/// and is `security definer` because only a definer can reach the second.
///
/// It also answers the thing that made this worth doing: **an agent is not a
/// second kind of person.** One list, and an extension is a column on it.
async fn list_members(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let organization = org_id(&headers)?.to_owned();
    let client = authed_client(&state, &headers).await?;
    let data = client
        .database()
        .rpc("org_people", Some(json!({ "p_org": organization })))
        .await
        .map_err(|error| ApiError::upstream(error.to_string()))?;
    Ok(Json(ApiResponse {
        data,
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
    let client = authed_client(&state, &headers).await?;
    let limit = query.limit.unwrap_or(50).clamp(1, 100);
    let offset = query.offset.unwrap_or(0);
    let rows = client
        .database()
        .from(resource.table)
        .select(resource.select)
        .eq("org_id", &organization)
        .order(resource.order_by, supabase::types::OrderDirection::Descending)
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
    let client = authed_client(&state, &headers).await?;
    let row = client
        .database()
        .from(resource.table)
        // The resource's own column list, not `*`. A resource narrows its
        // select for a reason — `agent-extensions` leaves out `sip_password`,
        // which SIP needs in plain text and cannot be hashed — and a narrowing
        // that applied to the list and not to the detail would put the thing it
        // was hiding one click away. Every other resource selects `*`, so this
        // changes nothing for them.
        .select(resource.select)
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
    let client = authed_client(&state, &headers).await?;
    let mut rows = client
        .database()
        .insert(resource.table)
        .values(body)
        .map_err(|error| ApiError::BadRequest(error.to_string()))?
        // What is written and what is read back are separate questions: a
        // create may carry `sip_password` up and must not carry it down again.
        .returning(resource.select)
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
    let client = authed_client(&state, &headers).await?;
    let mut rows = client
        .database()
        .update(resource.table)
        .set(body)
        .map_err(|error| ApiError::BadRequest(error.to_string()))?
        .eq("org_id", &organization)
        .eq("id", &id)
        .returning(resource.select)
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
    let client = authed_client(&state, &headers).await?;
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
        .allow_origin(tower_http::cors::AllowOrigin::list(state.config.cors_origins.clone()))
        // PUT was missing, so every preflight for one was rejected and the browser
        // reported it as the API being unreachable — which sends the reader to
        // check the server rather than the method list.
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE, Method::OPTIONS])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE, header::HeaderName::from_static("x-org-id")]);

    Router::new()
        .route("/health", get(health))
        .route("/api/v1/auth/sign-in", post(sign_in))
        .route("/api/v1/auth/refresh", post(refresh_session))
        .route("/api/v1/auth/sign-in-link", post(sign_in_link))
        .route("/api/v1/auth/methods", post(auth_methods))
        .route("/api/v1/me", get(me))
        .route("/api/v1/me/organizations", get(list_my_organizations))
        .route("/api/v1/me/profile", post(set_my_name))
        .route("/api/v1/operator/me", get(operator_me))
        .route("/api/v1/operator/keys", get(operator_platform_keys))
        .route("/api/v1/operator/numbers", get(operator_numbers).post(operator_add_number))
        .route("/api/v1/operator/numbers/{id}", post(operator_assign_number))
        .route("/api/v1/operator/templates", get(operator_templates))
        .route("/api/v1/operator/tenants/{id}/seed", post(operator_seed))
        .route(
            "/api/v1/operator/keys/{vendor}",
            post(operator_set_platform_key).delete(operator_delete_platform_key),
        )
        .route("/api/v1/operator/tenants", get(operator_tenants).post(operator_create_tenant))
        .route("/api/v1/operator/tenants/{id}", post(operator_set_tenant))
        .route(
            "/api/v1/operator/tenants/{id}/entitlements",
            get(operator_entitlements).post(operator_set_entitlement),
        )
        .route("/api/v1/engines", get(list_available_engines))
        .route("/api/v1/settings/choices", get(setting_choices))
        .route("/api/v1/operator/packs", get(operator_packs))
        .route("/api/v1/operator/plans", get(operator_plans))
        .route("/api/v1/operator/plans/{id}", get(operator_plans).patch(operator_set_plan))
        .route("/api/v1/operator/periods", get(operator_billing_periods))
        .route("/api/v1/operator/tenants/{id}/period", get(tenant_billing_period).post(operator_open_period))
        .route("/api/v1/operator/engines", get(operator_engines).post(operator_create_engine))
        .route(
            "/api/v1/operator/engines/{id}",
            get(operator_engine).patch(operator_update_engine),
        )
        .route("/api/v1/operator/engines/revenue", get(operator_engine_revenue))
        .route("/api/v1/operator/engines/{id}/price", post(operator_set_engine_price))
        .route("/api/v1/operator/tenants/{id}/usage", get(operator_tenant_usage))
        .route("/api/v1/operator/tenants/{id}/billing", get(operator_tenant_billing))
        .route(
            "/api/v1/operator/tenants/{id}/config",
            get(operator_tenant_config).patch(operator_set_tenant_settings),
        )
        .route("/api/v1/operator/tenants/{id}/engine-access", post(operator_set_engine_access))
        .route(
            "/api/v1/operator/tenants/{id}/members",
            get(operator_members).post(operator_member_action),
        )
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
        .route("/api/v1/functions", post(push_functions))
        .route("/api/v1/functions/{name}/run", post(run_function))
        .route("/api/v1/functions/{name}/versions", get(list_tool_versions))
        .route("/api/v1/tool-runs", get(list_tool_runs))
        .route("/api/v1/skills/{id}/tools", get(list_skill_tools).put(set_skill_tools))
        .route("/api/v1/agents/{id}/skills", get(list_agent_skills).put(set_agent_skills))
        .route("/api/v1/phone-numbers/{id}/flows", get(list_number_flows).put(set_number_flow))
        .route("/api/v1/api-keys", post(mint_api_key))
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
        .route("/api/v1/settings/vendors/{vendor}/test", post(test_credential))
        // The landing screen's live feed. A GET that never returns, on purpose.
        .route("/api/v1/dashboard/stream", get(dashboard_stream))
        .route("/api/v1/dashboard/history", get(dashboard_history))
        .route("/api/v1/calls/{id}/monitor", post(monitor_call))
        .route("/api/v1/engines/{id}/preflight", post(preflight_engine))
        .route("/api/v1/flows/{id}/dry-run", post(dry_run_flow))
        .route("/api/v1/catalogue/refresh", post(refresh_catalogue))
        .route("/api/v1/settings/members", get(list_members).post(add_member))
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
    axum::serve(listener, app(AppState { config, limiter: Arc::new(RateLimit::new()) }))
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
