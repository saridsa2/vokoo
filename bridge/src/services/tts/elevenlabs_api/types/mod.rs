//! Shared types used across the ElevenLabs API.
//!
//! Copied from the SDK, trimmed to the modules this tree carries. Types here
//! stay close to the wire format defined by the ElevenLabs OpenAPI spec.
//!
//! VENDOR CHANGE: upstream declares twenty-three modules. Only the four that a
//! voice platform reads are copied — see the parent module for what was left
//! and why.

mod common;
mod models;
mod text_to_speech;
mod voices;

pub use common::*;
pub use models::*;
pub use text_to_speech::*;
pub use voices::*;
