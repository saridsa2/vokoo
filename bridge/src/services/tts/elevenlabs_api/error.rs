//! Error types for the ElevenLabs SDK.
//!
//! Provides [`ElevenLabsError`] as the primary error enum for all SDK
//! operations, along with a convenient [`Result`] type alias.

/// A convenient `Result` type alias that defaults to [`ElevenLabsError`].
pub type Result<T> = std::result::Result<T, ElevenLabsError>;

/// All possible errors returned by the ElevenLabs SDK.
///
/// Each variant carries enough context to produce a meaningful
/// [`Display`](std::fmt::Display) message and, where applicable, structured
/// data that callers can use for programmatic error handling (e.g. retry-after
/// headers, HTTP status codes).
#[derive(Debug, thiserror::Error)]
pub enum ElevenLabsError {
    /// The API returned an error response.
    #[error("API error (HTTP {status}): {message}")]
    Api {
        /// HTTP status code from the API.
        status: u16,
        /// Human-readable error message from the API.
        message: String,
        /// Optional raw response body for further inspection.
        body: Option<String>,
    },

    /// Authentication failed (invalid or missing API key).
    #[error("Authentication failed: {0}")]
    Auth(String),

    /// The request was rate-limited by the API.
    #[error("Rate limited (retry after {retry_after:?}s)")]
    RateLimited {
        /// Optional number of seconds to wait before retrying.
        retry_after: Option<u64>,
    },

    /// The request timed out before a response was received.
    #[error("Request timeout")]
    Timeout,

    /// An error occurred at the HTTP transport layer.
    #[error("Transport error: {0}")]
    /// VENDOR CHANGE: was `#[from] hpx::Error`. The transport is reqwest here,
    /// and reqwest's error is not `hpx`'s, so this carries the message instead
    /// of the type. Nothing upstream matches on the inner value.
    Transport(String),

    /// Failed to deserialize a JSON response body.
    #[error("Deserialization error: {0}")]
    Deserialization(#[from] serde_json::Error),
    /// VENDOR ADDITION: reqwest reports transport and decode failures separately.
    #[error("http error: {0}")]
    Http(String),
    #[error("could not decode the response: {0}")]
    Decode(String),

    /// A caller-provided input failed validation.
    #[error("Invalid input: {0}")]
    Validation(String),

    /// A URL could not be parsed.
    ///
    /// VENDOR CHANGE: was `#[from] url::ParseError`. `url` is not a dependency
    /// here — upstream got it through `hpx` — and our client builds URLs by
    /// formatting rather than parsing, so nothing constructs this any more. Kept
    /// as a variant so the enum's shape still matches upstream.
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),

    /// WebSocket communication error.
    #[error("WebSocket error: {0}")]
    WebSocket(String),
}


// VENDOR CHANGE: the upstream crate's tests for this module were removed.
// They construct the hpx-based ElevenLabsClient and import `config`/`types`,
// none of which this subset vendors — see docs/vendor-overrides.md.
