//! The HTTP client the vendored services call.
//!
//! This is the one file that is *not* a copy. Upstream's `client.rs` is 846
//! lines built on `hpx`, which pulls BoringSSL, tonic and prost — a tree that
//! will not build on this server without a C and Go toolchain, and one this
//! binary has no other reason to carry.
//!
//! So the transport is `reqwest`, already a dependency, and this file provides
//! exactly the verbs the vendored services call. Everything above it — the
//! types, the services — is upstream's, unchanged.
//!
//! See `docs/vendor-overrides.md`.

use bytes::Bytes;
use serde::{de::DeserializeOwned, Serialize};

use super::auth::ApiKey;
use super::config::ClientConfig;
use super::error::{ElevenLabsError as Error, Result};

/// Talks to the ElevenLabs REST API.
#[derive(Debug, Clone)]
pub struct ElevenLabsClient {
    http: reqwest::Client,
    base_url: String,
    api_key: ApiKey,
}

impl ElevenLabsClient {
    pub fn new(config: ClientConfig) -> Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(config.timeout)
            .build()
            .map_err(|error| Error::Http(error.to_string()))?;
        Ok(Self { http, base_url: config.base_url, api_key: config.api_key })
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        // The key travels in ElevenLabs' own header, not in `Authorization`.
        self.http
            .request(method, format!("{}{path}", self.base_url))
            .header("xi-api-key", self.api_key.expose())
    }

    /// Turn a non-2xx into an error carrying the body.
    ///
    /// The body is where the useful part is — "Speaker 'priya' is not
    /// compatible with model bulbul:v2" is the sort of sentence that saves an
    /// afternoon, and a bare status code is not.
    async fn checked(response: reqwest::Response) -> Result<reqwest::Response> {
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        let body = response.text().await.unwrap_or_default();
        Err(Error::Api {
            status: status.as_u16(),
            message: body.clone(),
            body: Some(body),
        })
    }

    pub(crate) async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let response = self
            .request(reqwest::Method::GET, path)
            .send()
            .await
            .map_err(|error| Error::Http(error.to_string()))?;
        Self::checked(response)
            .await?
            .json()
            .await
            .map_err(|error| Error::Decode(error.to_string()))
    }

    pub(crate) async fn get_bytes(&self, path: &str) -> Result<Bytes> {
        let response = self
            .request(reqwest::Method::GET, path)
            .send()
            .await
            .map_err(|error| Error::Http(error.to_string()))?;
        Self::checked(response)
            .await?
            .bytes()
            .await
            .map_err(|error| Error::Http(error.to_string()))
    }

    pub(crate) async fn post<T: DeserializeOwned, B: Serialize + Sync>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let response = self
            .request(reqwest::Method::POST, path)
            .json(body)
            .send()
            .await
            .map_err(|error| Error::Http(error.to_string()))?;
        Self::checked(response)
            .await?
            .json()
            .await
            .map_err(|error| Error::Decode(error.to_string()))
    }

    pub(crate) async fn post_bytes<B: Serialize + Sync>(&self, path: &str, body: &B) -> Result<Bytes> {
        let response = self
            .request(reqwest::Method::POST, path)
            .json(body)
            .send()
            .await
            .map_err(|error| Error::Http(error.to_string()))?;
        Self::checked(response)
            .await?
            .bytes()
            .await
            .map_err(|error| Error::Http(error.to_string()))
    }

    pub(crate) async fn delete(&self, path: &str) -> Result<()> {
        let response = self
            .request(reqwest::Method::DELETE, path)
            .send()
            .await
            .map_err(|error| Error::Http(error.to_string()))?;
        Self::checked(response).await.map(|_| ())
    }

    pub(crate) async fn delete_json<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let response = self
            .request(reqwest::Method::DELETE, path)
            .send()
            .await
            .map_err(|error| Error::Http(error.to_string()))?;
        Self::checked(response)
            .await?
            .json()
            .await
            .map_err(|error| Error::Decode(error.to_string()))
    }

    /// A body somebody else already framed. The vendored services build their
    /// own multipart bytes, so this only has to carry them.
    pub(crate) async fn post_multipart<T: DeserializeOwned>(
        &self,
        path: &str,
        body: Vec<u8>,
        content_type: &str,
    ) -> Result<T> {
        let response = self
            .request(reqwest::Method::POST, path)
            .header(reqwest::header::CONTENT_TYPE, content_type)
            .body(body)
            .send()
            .await
            .map_err(|error| Error::Http(error.to_string()))?;
        Self::checked(response)
            .await?
            .json()
            .await
            .map_err(|error| Error::Decode(error.to_string()))
    }

    /// The typed services.
    pub fn models(&self) -> super::services::models::ModelsService<'_> {
        super::services::models::ModelsService::new(self)
    }

    pub fn voices(&self) -> super::services::voices::VoicesService<'_> {
        super::services::voices::VoicesService::new(self)
    }
}
