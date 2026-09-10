//! ElevenLabs, vendored from `elevenlabs-sdk` 0.1.0 with the transport replaced.
//!
//! **This is vendor code. See `docs/vendor-overrides.md`.**
//!
//! Copied verbatim: `types/`, `services/`, `auth.rs`, `config.rs`, `error.rs`.
//! Replaced entirely: `client.rs` — upstream builds on `hpx`, which pulls
//! BoringSSL, tonic and prost and will not compile here without a C and Go
//! toolchain. Ours is 147 lines of `reqwest` providing the same verbs.
//!
//! Not copied: dubbing, studio, music, PVC voices, workspace, agents, history,
//! sound generation and the conversation WebSocket — about 20,000 lines with no
//! bearing on answering a phone call. They can be brought over the same way if
//! a reason appears.
//!
//! Every edit to a copied file is marked `VENDOR CHANGE` or `VENDOR ADDITION`,
//! so a diff against a future release shows what has to be reapplied.
//!
//! The streaming synthesiser a call uses is *not* here: it is
//! `super::elevenlabs.rs`, written against the wire protocol directly, because
//! it has to be a `FrameHandler` in rustvani's pipeline rather than a
//! standalone client.

pub mod auth;
pub mod client;
pub mod config;
pub mod error;
pub mod services;
pub mod types;

pub use client::ElevenLabsClient;
pub use config::ClientConfig;
pub use error::{ElevenLabsError, Result};
