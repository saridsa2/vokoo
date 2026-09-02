//! Persisting what a call consumed.
//!
//! rustvani already counts. `BillingCollector`, `SessionBilling` and its drain
//! task exist upstream, the provider handlers are instrumented, and
//! `db-postgres` is in the default features — the whole subsystem was compiled
//! into every binary this project has ever shipped and received `None` at every
//! call site, because nothing ever handed it a collector. This supplies the one
//! piece it was missing: somewhere to write.
//!
//! **Not `PostgresBillingStorage`**, which is upstream and would do this
//! perfectly well, because it needs a `tokio_postgres::Client` and the database
//! is inside Docker with no port published to the host. Exposing one would be a
//! `docker-compose.yml` edit — a vendor override an upgrade reverts silently,
//! and a second way into the database for a process that already has a
//! perfectly good one. Everything else the bridge reads and writes goes over
//! PostgREST with the service key; so does this.
//!
//! The contract that matters is idempotence. `checkpoint` writes an **absolute**
//! snapshot of monotonic totals, so a retry overwrites rather than adds, and
//! appends events keyed by an id the drain task assigns, so a retried
//! checkpoint cannot double-charge. Both are expressed here as upserts.

use std::collections::HashMap;

use async_trait::async_trait;
use serde_json::{json, Value};
use uuid::Uuid;

use rustvani_billing_types::*;

/// Re-exported so this file reads as one thing rather than a list of paths.
mod rustvani_billing_types {
    pub use crate::billing::events::{BillingEvent, SessionSummary, TranscriptEntry};
    pub use crate::billing::storage::BillingStorage;
    pub use crate::error::{PipecatError, Result};
}

pub struct PostgrestBillingStorage {
    base: String,
    key: String,
    client: reqwest::Client,
    /// Written onto the session row so a cost can be attributed to an
    /// organisation, an agent and — the question this was built for — an
    /// engine. The upstream summary carries a metadata map for exactly this,
    /// but only the caller knows what belongs in it.
    metadata: HashMap<String, String>,
}

impl PostgrestBillingStorage {
    pub fn new(base: impl Into<String>, key: impl Into<String>, metadata: HashMap<String, String>) -> Self {
        Self {
            base: base.into(),
            key: key.into(),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .unwrap_or_default(),
            metadata,
        }
    }

    async fn upsert(&self, table: &str, on_conflict: &str, rows: Value) -> Result<()> {
        let response = self
            .client
            .post(format!("{}/rest/v1/{table}", self.base))
            .query(&[("on_conflict", on_conflict)])
            .header("apikey", &self.key)
            .header("Authorization", format!("Bearer {}", self.key))
            .header("Content-Type", "application/json")
            // merge-duplicates is what makes a retried checkpoint safe: the
            // same snapshot lands on the same row instead of beside it.
            .header("Prefer", "resolution=merge-duplicates,return=minimal")
            .json(&rows)
            .send()
            .await
            .map_err(|e| PipecatError::pipeline(format!("billing write to {table}: {e}")))?;

        if response.status().is_success() {
            Ok(())
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(PipecatError::pipeline(format!("billing write to {table} answered {status}: {body}")))
        }
    }

    /// The session row, as an absolute snapshot.
    fn session_row(&self, summary: &SessionSummary, status: &str, transcripts: &[TranscriptEntry]) -> Value {
        let mut metadata = self.metadata.clone();
        // Anything the pipeline learned about the session wins over what the
        // caller guessed at the start.
        metadata.extend(summary.metadata.clone());

        json!({
            "session_id":         summary.session_id,
            "started_at":         summary.started_at,
            "ended_at":           summary.ended_at,
            "duration_secs":      summary.duration_secs,
            "finish_reason":      summary.finish_reason,
            "llm_input_tokens":   summary.llm_input_tokens,
            "llm_output_tokens":  summary.llm_output_tokens,
            "llm_calls":          summary.llm_calls,
            "tts_chars":          summary.tts_chars,
            "tts_calls":          summary.tts_calls,
            "stt_audio_ms":       summary.stt_audio_ms,
            "stt_calls":          summary.stt_calls,
            "metadata":           metadata,
            "transcript_json":    transcripts,
            "status":             status,
            "last_checkpoint_at": chrono::Utc::now(),
            "updated_at":         chrono::Utc::now(),
        })
    }
}

/// One ledger row. Returns `None` for events that record no billable quantity —
/// the session lifecycle and transcript turns, which are carried on the session
/// row rather than duplicated per event.
///
/// **Every row carries every column**, with `null` where a unit does not apply.
/// Not tidiness: PostgREST rejects a bulk insert whose objects do not share one
/// key set, with a 400 and no indication which row disagreed. A transcription
/// event and a synthesis event naturally have different fields, so shaping them
/// separately meant a checkpoint failed the moment a call used more than one
/// kind of provider — which is every call. Found by sending the three real
/// shapes at PostgREST before a call did.
fn event_row(event_id: Uuid, event: &BillingEvent) -> Option<Value> {
    let (session_id, event_type, provider, model, voice, input, output, estimated, chars, audio_ms, at) =
        match event {
            BillingEvent::LlmUsage { session_id, provider, model, input_tokens, output_tokens, estimated, occurred_at } => (
                session_id, "llm", provider.clone(), Some(model.clone()), None,
                Some(*input_tokens), Some(*output_tokens), Some(*estimated), None, None, occurred_at,
            ),
            BillingEvent::TtsUsage { session_id, provider, voice, char_count, occurred_at } => (
                session_id, "tts", provider.clone(), None, Some(voice.clone()),
                None, None, None, Some(*char_count), None, occurred_at,
            ),
            BillingEvent::SttUsage { session_id, provider, audio_duration_ms, occurred_at } => (
                session_id, "stt", provider.clone(), None, None,
                None, None, None, None, Some(*audio_duration_ms), occurred_at,
            ),
            BillingEvent::SessionStart { .. } | BillingEvent::SessionEnd { .. } | BillingEvent::Transcript(_) => {
                return None
            }
        };

    Some(json!({
        "event_id":          event_id,
        "session_id":        session_id,
        "event_type":        event_type,
        "provider":          provider,
        "model":             model,
        "voice":             voice,
        "input_tokens":      input,
        "output_tokens":     output,
        "estimated":         estimated,
        "char_count":        chars,
        "audio_duration_ms": audio_ms,
        "occurred_at":       at,
    }))
}

#[async_trait]
impl BillingStorage for PostgrestBillingStorage {
    async fn checkpoint(
        &self,
        summary: &SessionSummary,
        new_events: &[(Uuid, BillingEvent)],
        transcripts: &[TranscriptEntry],
    ) -> Result<()> {
        // The session first: an event references it, and a ledger row landing
        // before its session would be rejected by the foreign key.
        self.upsert(
            "billing_sessions",
            "session_id",
            json!([self.session_row(summary, "active", transcripts)]),
        )
        .await?;

        let rows: Vec<Value> = new_events.iter().filter_map(|(id, e)| event_row(*id, e)).collect();
        if !rows.is_empty() {
            self.upsert("billing_events", "event_id", Value::Array(rows)).await?;
        }
        Ok(())
    }

    async fn finalize_session(&self, summary: &SessionSummary, transcripts: &[TranscriptEntry]) -> Result<()> {
        self.upsert(
            "billing_sessions",
            "session_id",
            json!([self.session_row(summary, "complete", transcripts)]),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn only_billable_events_reach_the_ledger() {
        let session = Uuid::new_v4();
        // A lifecycle event carries no quantity; writing one would put a row in
        // the ledger that every pricing view then has to exclude.
        assert!(event_row(
            Uuid::new_v4(),
            &BillingEvent::SessionEnd {
                session_id: session,
                ended_at: Utc::now(),
                finish_reason: "end".into()
            }
        )
        .is_none());

        assert!(event_row(
            Uuid::new_v4(),
            &BillingEvent::TtsUsage {
                session_id: session,
                provider: "sarvam".into(),
                voice: "priya".into(),
                char_count: 41,
                occurred_at: Utc::now(),
            }
        )
        .is_some());
    }

    #[test]
    fn every_event_shape_writes_the_same_columns() {
        // PostgREST refuses a bulk insert whose objects disagree on keys, with
        // a 400 that names nothing. A call uses transcription, thinking and
        // synthesis, so all three shapes go up in one request every time.
        let session = Uuid::new_v4();
        let rows: Vec<Value> = [
            BillingEvent::LlmUsage {
                session_id: session, provider: "openai".into(), model: "gpt-4.1-mini".into(),
                input_tokens: 10, output_tokens: 2, estimated: false, occurred_at: Utc::now(),
            },
            BillingEvent::TtsUsage {
                session_id: session, provider: "sarvam".into(), voice: "priya".into(),
                char_count: 41, occurred_at: Utc::now(),
            },
            BillingEvent::SttUsage {
                session_id: session, provider: "sarvam".into(),
                audio_duration_ms: 640.0, occurred_at: Utc::now(),
            },
        ]
        .iter()
        .filter_map(|e| event_row(Uuid::new_v4(), e))
        .collect();

        assert_eq!(rows.len(), 3);
        let keys = |row: &Value| {
            let mut k: Vec<String> = row.as_object().unwrap().keys().cloned().collect();
            k.sort();
            k
        };
        let first = keys(&rows[0]);
        for row in &rows[1..] {
            assert_eq!(keys(row), first, "every event shape must write the same columns");
        }
    }

    #[test]
    fn an_llm_row_keeps_both_token_counts_apart() {
        // They are priced at different rates, so a row that added them
        // together would be unpriceable.
        let row = event_row(
            Uuid::new_v4(),
            &BillingEvent::LlmUsage {
                session_id: Uuid::new_v4(),
                provider: "openai".into(),
                model: "gpt-4.1-mini".into(),
                input_tokens: 2352,
                output_tokens: 120,
                estimated: false,
                occurred_at: Utc::now(),
            },
        )
        .expect("llm usage is billable");
        assert_eq!(row["input_tokens"], 2352);
        assert_eq!(row["output_tokens"], 120);
        assert_eq!(row["event_type"], "llm");
    }
}
