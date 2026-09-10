//! Typed endpoint wrappers, copied from the SDK unchanged.
//!
//! Only the ones a voice platform has a use for. See the parent module.
//!
//!  is deliberately absent: it uses let-chains, which need Rust
//! edition 2024, and rustvani is on 2021. Nothing calls it — there are already
//! four transcribers — so it was dropped rather than rewritten.
//!
//! `text_to_speech` is absent for the same reason: it is REST synthesis, and a
//! call synthesises over the WebSocket handler next door. It was also the only
//! file pulling `futures_core`.

pub mod models;
pub mod voices;
