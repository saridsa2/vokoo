//! Asking providers what they actually offer.
//!
//! The engine catalogue was seeded by hand from the crate's own defaults, and on
//! 1 September that put Sarvam's `bulbul:v2` in front of somebody months after
//! Sarvam retired it. The call connected, transcribed, thought — and the caller
//! heard nothing, because the only step nobody had asked about was the one that
//! failed.
//!
//! CLAUDE.md already had the rule: *ask the provider which models exist rather
//! than guessing*. This is that rule for engines.
//!
//! It is not a replacement for pre-flight, and neither replaces the other:
//!
//! * discovery keeps the **list** honest, so a retired model is never offered —
//!   but only for providers that publish one. Sarvam publishes nothing, which is
//!   exactly the provider that broke.
//! * pre-flight proves **this configuration** works by opening the connections a
//!   call opens, for every provider, published list or not.
//!
//! Runs in the bridge because it needs a provider key, and after migration 0046
//! the bridge is the only process that may read one.

use serde_json::{json, Value};

/// What a refresh found, per stage row.
#[derive(Debug, serde::Serialize)]
pub struct Discovered {
    /// The `catalogue_engine_stages` row, e.g. `tts:elevenlabs`.
    pub id: String,
    pub models: usize,
    pub voices: usize,
    pub error: Option<String>,
}

/// Refresh every stage row whose provider publishes a catalogue.
///
/// A provider that publishes nothing is skipped rather than emptied: an empty
/// list would remove every option from the console, which is a worse failure
/// than a stale one.
pub async fn refresh(base: &str, key: &str, org_id: &str) -> Vec<Discovered> {
    let mut found = Vec::new();

    for (row, vendor) in [
        ("llm:openai", "openai"),
        ("realtime:openai", "openai"),
        ("realtime:gemini", "gemini"),
        ("stt:deepgram", "deepgram"),
        ("tts:deepgram", "deepgram"),
        ("tts:elevenlabs", "elevenlabs"),
    ] {
        let Some(secret) = super::graph::vendor_secret(base, key, org_id, vendor).await else {
            // Not connected. Not an error — most organisations use a handful of
            // providers and leave the rest alone.
            continue;
        };

        match fetch(row, &secret).await {
            Ok((models, voices)) => {
                // Providers list one row per language variant — Deepgram
                // returned 443 entries for 41 models. A select with 443 rows is
                // not a list somebody chooses from.
                let models = dedupe(models);
                let voices = dedupe(voices);
                // A realtime stage keeps its models somewhere else.
                //
                // The composer's realtime node reads `catalogue_models`, and
                // `build_realtime` resolves an id through the same table — so
                // writing them onto the stage row, the way every other stage
                // does, produced a list nothing read. `realtime:gemini` has
                // been carrying five such entries while the console offered the
                // two rows in `catalogue_models`, and the two could disagree
                // indefinitely without anyone noticing.
                let error = if row.starts_with("realtime:") {
                    write_models(base, key, vendor, &models).await.err()
                } else {
                    write_back(base, key, row, &models, &voices).await.err()
                };
                found.push(Discovered {
                    id: row.into(),
                    models: models.len(),
                    voices: voices.len(),
                    error,
                });
            }
            Err(problem) => found.push(Discovered {
                id: row.into(),
                models: 0,
                voices: 0,
                error: Some(problem),
            }),
        }
    }

    found
}

/// One provider's catalogue, as `[{id,label}]` pairs.
async fn fetch(row: &str, secret: &str) -> Result<(Vec<Value>, Vec<Value>), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    match row {
        "llm:openai" => {
            let body = get_json(&client, "https://api.openai.com/v1/models", &[("Authorization", &format!("Bearer {secret}"))]).await?;
            // Chat models only. The list also carries embeddings, moderation and
            // image models, none of which can hold a conversation.
            let models = body["data"]
                .as_array()
                .map(|rows| {
                    rows.iter()
                        .filter_map(|row| row["id"].as_str())
                        .filter(|id| id.starts_with("gpt-") && !id.contains("realtime") && !id.contains("audio"))
                        .map(|id| json!({ "id": id, "label": id }))
                        .collect()
                })
                .unwrap_or_default();
            Ok((models, Vec::new()))
        }

        "realtime:openai" => {
            let body = get_json(&client, "https://api.openai.com/v1/models", &[("Authorization", &format!("Bearer {secret}"))]).await?;
            // The complement of the `llm:openai` filter, which excludes these
            // on purpose. Asked for rather than typed: the docs name
            // `gpt-realtime-2.1` and others without publishing a full list, and
            // a hand-typed list is what put a retired Sarvam model in front of
            // a caller.
            let models = body["data"]
                .as_array()
                .map(|rows| {
                    rows.iter()
                        .filter_map(|row| row["id"].as_str())
                        .filter(|id| id.contains("realtime"))
                        // Translation and transcription are realtime models
                        // that do not hold a conversation, so an engine cannot
                        // be built on one. `whisper` is the third: OpenAI names
                        // its realtime transcriber `gpt-realtime-whisper`, and
                        // it matched "realtime" and passed the first two filters
                        // straight into the model dropdown.
                        .filter(|id| {
                            ["translate", "transcribe", "whisper"]
                                .iter()
                                .all(|word| !id.contains(word))
                        })
                        .map(|id| json!({ "id": id, "label": id }))
                        .collect()
                })
                .unwrap_or_default();
            // OpenAI publishes no voices endpoint, so this reports none and
            // leaves whatever is stored alone — `write_back` refuses an empty
            // list for exactly that reason.
            Ok((models, Vec::new()))
        }

        "realtime:gemini" => {
            let body = get_json(&client, "https://generativelanguage.googleapis.com/v1beta/models", &[("x-goog-api-key", secret)]).await?;
            // The rule CLAUDE.md already wrote down: filter on the method that
            // makes a model usable for a live call.
            let models = body["models"]
                .as_array()
                .map(|rows| {
                    rows.iter()
                        .filter(|row| {
                            row["supportedGenerationMethods"]
                                .as_array()
                                .map(|methods| methods.iter().any(|m| m.as_str() == Some("bidiGenerateContent")))
                                .unwrap_or(false)
                        })
                        .filter_map(|row| row["name"].as_str())
                        // Same exclusion as the OpenAI arm: Gemini declares
                        // `bidiGenerateContent` on its live *transcriber* too,
                        // and a transcriber cannot answer a caller.
                        .filter(|name| {
                            ["transcribe", "translate"].iter().all(|word| !name.contains(word))
                        })
                        .map(|name| {
                            // `models/gemini-…` is the provider's id; the
                            // catalogue keys on the bare name. **Both** are
                            // carried: writing the bare name back as the
                            // provider id broke a working engine, because
                            // `bidiGenerateContent` is not served under it.
                            let id = name.strip_prefix("models/").unwrap_or(name);
                            json!({ "id": id, "label": id, "provider_model_id": name })
                        })
                        .collect()
                })
                .unwrap_or_default();
            Ok((models, Vec::new()))
        }

        "stt:deepgram" | "tts:deepgram" => {
            let body = get_json(&client, "https://api.deepgram.com/v1/models", &[("Authorization", &format!("Token {secret}"))]).await?;
            let key = if row.starts_with("stt") { "stt" } else { "tts" };
            let entries = body[key]
                .as_array()
                .map(|rows| {
                    rows.iter()
                        .filter_map(|row| {
                            let name = row["canonical_name"].as_str().or_else(|| row["name"].as_str())?;
                            Some(json!({ "id": name, "label": row["name"].as_str().unwrap_or(name) }))
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            // Deepgram's voices *are* its TTS models — one name selects both.
            if key == "tts" { Ok((Vec::new(), entries)) } else { Ok((entries, Vec::new())) }
        }

        "tts:elevenlabs" => {
            let models = get_json(&client, "https://api.elevenlabs.io/v1/models", &[("xi-api-key", secret)]).await?;
            let models = models
                .as_array()
                .map(|rows| {
                    rows.iter()
                        .filter(|row| row["can_do_text_to_speech"].as_bool().unwrap_or(false))
                        .filter_map(|row| {
                            let id = row["model_id"].as_str()?;
                            Some(json!({ "id": id, "label": row["name"].as_str().unwrap_or(id) }))
                        })
                        .collect()
                })
                .unwrap_or_default();

            let voices = get_json(&client, "https://api.elevenlabs.io/v1/voices", &[("xi-api-key", secret)]).await?;
            let voices = voices["voices"]
                .as_array()
                .map(|rows| {
                    rows.iter()
                        .filter_map(|row| {
                            // The id, not the name: names are not unique and the
                            // streaming URL takes the id.
                            let id = row["voice_id"].as_str()?;
                            Some(json!({ "id": id, "label": row["name"].as_str().unwrap_or(id) }))
                        })
                        .collect()
                })
                .unwrap_or_default();

            Ok((models, voices))
        }

        other => Err(format!("no catalogue endpoint is known for {other}")),
    }
}

async fn get_json(client: &reqwest::Client, url: &str, headers: &[(&str, &str)]) -> Result<Value, String> {
    let mut request = client.get(url);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let response = request.send().await.map_err(|e| format!("could not reach {url}: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{url} answered {status}"));
    }
    response.json().await.map_err(|e| format!("{url} returned something that is not JSON: {e}"))
}

/// Upsert realtime models into `catalogue_models`, which is the table the
/// composer offers and the builder resolves through.
///
/// `provider_model_id` is what goes on the wire and `id` is what an engine
/// stores. Discovery learns them as the same string, and they stay separable so
/// a vendor renaming a model remains one `UPDATE` rather than a re-publish of
/// every engine naming it.
async fn write_models(base: &str, key: &str, provider: &str, models: &[Value]) -> Result<(), String> {
    if models.is_empty() {
        return Err("the provider returned no realtime models — the stored list is kept".into());
    }

    let rows: Vec<Value> = models
        .iter()
        .filter_map(|entry| {
            let id = entry["id"].as_str()?;
            Some(json!({
                "id": id,
                "provider_id": provider,
                "label": entry["label"].as_str().unwrap_or(id),
                // The provider's own id when it differs from the friendly
                // one, which for Gemini it does. Defaulting to `id` here is
                // what overwrote `models/gemini-3.1-flash-live-preview` with
                // the bare name and took the engine down.
                "provider_model_id": entry["provider_model_id"].as_str().unwrap_or(id),
                // `summary` and `tagline` are required and are somebody's
                // words about a model, which discovery has none of. Saying so
                // is better than inventing a description or writing an empty
                // string that reads as a considered blank.
                "summary": format!("Discovered from the provider on {}. No description has been written for it.", chrono::Utc::now().format("%-d %B %Y")),
                "tagline": "Discovered",
                "is_active": true,
            }))
        })
        .collect();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(format!("{base}/rest/v1/catalogue_models"))
        .query(&[("on_conflict", "id")])
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/json")
        .header("Prefer", "resolution=merge-duplicates,return=minimal")
        .json(&Value::Array(rows))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("could not store realtime models: {}", response.status()))
    }
}

/// Write a discovered list back, leaving an empty one alone.
///
/// An empty result is far more likely to be a changed response shape than a
/// provider that genuinely offers nothing, and writing it would empty the
/// console's lists on the strength of a guess.
async fn write_back(base: &str, key: &str, row: &str, models: &[Value], voices: &[Value]) -> Result<(), String> {
    let mut patch = serde_json::Map::new();
    if !models.is_empty() {
        patch.insert("models".into(), Value::Array(models.to_vec()));
    }
    if !voices.is_empty() {
        patch.insert("voices".into(), Value::Array(voices.to_vec()));
    }
    if patch.is_empty() {
        return Err("the provider returned nothing usable — the stored list is kept".into());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .patch(format!("{base}/rest/v1/catalogue_engine_stages?id=eq.{row}"))
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/json")
        .json(&Value::Object(patch))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("could not store the list: {}", response.status()))
    }
}

/// One entry per id, first occurrence kept.
///
/// Order is the provider's, which is usually newest or recommended first, so
/// keeping the first occurrence keeps that intent.
fn dedupe(entries: Vec<Value>) -> Vec<Value> {
    let mut seen = std::collections::HashSet::new();
    entries
        .into_iter()
        .filter(|entry| {
            entry["id"].as_str().map(|id| seen.insert(id.to_owned())).unwrap_or(false)
        })
        .collect()
}

/* ------------------------------------------------------------------ Schedule */

/// Refresh every organisation's lists, on a timer, for as long as the bridge
/// runs.
///
/// In-process rather than a cron job, an edge function or a systemd timer, for
/// one reason: this needs to decrypt provider keys, and since migration 0046
/// exactly one process is allowed to. Anything else scheduling this work would
/// either need that permission — giving back the narrowing that migration
/// bought — or would just be calling this endpoint anyway, which is a hop that
/// adds a component and a shared secret and no capability.
///
/// Idempotent, so a second bridge running the same schedule is harmless: both
/// write the same list, and a provider that answers with nothing is skipped
/// rather than emptied.
pub fn schedule(base: String, key: String, every: std::time::Duration) {
    if base.is_empty() || key.is_empty() {
        log::warn!("[discovery] no database configured — the catalogue will not refresh");
        return;
    }

    tokio::spawn(async move {
        // Not at t=0. A bridge restarting during an incident should answer the
        // phone before it talks to five vendors.
        tokio::time::sleep(std::time::Duration::from_secs(90)).await;

        loop {
            match organisations(&base, &key).await {
                Ok(orgs) if orgs.is_empty() => {
                    log::debug!("[discovery] no organisations to refresh");
                }
                Ok(orgs) => {
                    for org in orgs {
                        let found = refresh(&base, &key, &org).await;
                        let failed: Vec<_> =
                            found.iter().filter_map(|row| row.error.as_ref().map(|e| format!("{}: {e}", row.id))).collect();
                        if failed.is_empty() {
                            log::info!("[discovery] refreshed {} stage(s) for {org}", found.len());
                        } else {
                            // Named, not swallowed: a provider that has started
                            // refusing is worth knowing about before somebody
                            // publishes an engine on a list that stopped
                            // updating months ago.
                            log::warn!("[discovery] {org} — {}", failed.join("; "));
                        }
                    }
                }
                Err(problem) => log::warn!("[discovery] could not list organisations: {problem}"),
            }

            tokio::time::sleep(every).await;
        }
    });
}

async fn organisations(base: &str, key: &str) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(format!("{base}/rest/v1/organizations?select=id"))
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let rows: Vec<Value> = response.json().await.map_err(|e| e.to_string())?;
    Ok(rows.iter().filter_map(|row| row["id"].as_str().map(str::to_owned)).collect())
}
