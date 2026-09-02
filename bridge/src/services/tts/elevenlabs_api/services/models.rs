//! Models service providing access to the ElevenLabs models endpoint.
//!
//! | Method | Endpoint | Description |
//! |--------|----------|-------------|
//! | [`list`](ModelsService::list) | `GET /v1/models` | List available models |
//!
//! # Example
//!
//! ```no_run
//! use elevenlabs_sdk::{ClientConfig, ElevenLabsClient};
//!
//! # async fn example() -> elevenlabs_sdk::Result<()> {
//! let config = ClientConfig::builder("your-api-key").build();
//! let client = ElevenLabsClient::new(config)?;
//!
//! let models = client.models().list().await?;
//! println!("Found {} models", models.0.len());
//! # Ok(())
//! # }
//! ```

use super::super::{client::ElevenLabsClient, error::Result, types::GetModelsResponse};

/// Models service providing typed access to model listing endpoints.
///
/// Obtained via [`ElevenLabsClient::models`].
#[derive(Debug)]
pub struct ModelsService<'a> {
    client: &'a ElevenLabsClient,
}

impl<'a> ModelsService<'a> {
    /// Creates a new `ModelsService` bound to the given client.
    pub(crate) const fn new(client: &'a ElevenLabsClient) -> Self {
        Self { client }
    }

    /// Lists all available models.
    ///
    /// Calls `GET /v1/models`.
    ///
    /// # Errors
    ///
    /// Returns an error if the API request fails or the response cannot be
    /// deserialized.
    pub async fn list(&self) -> Result<GetModelsResponse> {
        self.client.get("/v1/models").await
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------


// VENDOR CHANGE: the upstream crate's tests for this module were removed.
// They construct the hpx-based ElevenLabsClient and import `config`/`types`,
// none of which this subset vendors — see docs/vendor-overrides.md.
