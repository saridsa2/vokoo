//! Source-bound document compilation into reviewable care-path drafts.
//!
//! Models emit [`CarePathProgram`] values. The lowerer is the only layer that
//! may turn that intermediate representation into platform nodes, and the
//! validator rechecks catalogue, provenance, graph, and clinical invariants
//! before anything reaches the database materializer.

mod harness;
mod lower;
mod model;
mod repository;
mod types;
mod validate;
mod worker;

pub use harness::*;
pub use lower::lower;
pub use model::*;
pub use repository::*;
pub use types::*;
pub use validate::validate_output;
pub use worker::*;
