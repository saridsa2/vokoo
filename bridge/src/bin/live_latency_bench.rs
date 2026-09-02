//! How long does a Live model take to start speaking?
//!
//! The bridge measures turn latency on a real call, but a phone call mixes the
//! model's latency with the carrier's, the resamplers' and the pump's — so a
//! bad number there says "slow" without saying *where*. This connects with the
//! same `GeminiLiveSession` the bridge uses, sends one text turn, and times the
//! first audio byte back. Nothing else is in the path, so the difference
//! between two models here is the model.
//!
//! Text in rather than audio in: it removes the recogniser as a variable and
//! leaves generation plus speech synthesis, which is the part that differs
//! between a native-audio model and a half-cascade one.
//!
//!   cargo run --release --bin live_latency_bench -- <trials> <model>...

use rustvani::services::realtime::gemini::{GeminiLiveConfig, GeminiLiveSession};
use rustvani::services::realtime::{RealtimeEvent, RealtimeSession};
use std::time::{Duration, Instant};

const PROMPT: &str = "Hello, I need to book an appointment for tomorrow morning.";

const INSTRUCTIONS: &str = "You are the receptionist at Vayuveda clinic in Bangalore. \
Answer the caller in one short sentence.";

/// Give up rather than hang: a model that has not spoken in fifteen seconds has
/// answered the question we were asking.
const PATIENCE: Duration = Duration::from_secs(15);

async fn once(api_key: &str, model: &str) -> Result<(f64, f64), String> {
    let t_connect = Instant::now();
    let mut session = GeminiLiveSession::connect(GeminiLiveConfig {
        api_key: api_key.to_string(),
        model: model.to_string(),
        voice: Some("Aoede".to_string()),
        instructions: INSTRUCTIONS.to_string(),
        functions: Vec::new(),
        ..Default::default()
    })
    .await?;
    let connect_ms = t_connect.elapsed().as_secs_f64() * 1000.0;

    let mut events = session.take_events().ok_or("event stream already taken")?;

    let t_turn = Instant::now();
    session.send_text(PROMPT).await?;

    let first_audio = loop {
        match tokio::time::timeout(PATIENCE, events.recv()).await {
            Err(_) => break Err("no audio within 15s".to_string()),
            Ok(None) => break Err("stream closed before any audio".to_string()),
            Ok(Some(RealtimeEvent::Audio(pcm))) if !pcm.is_empty() => {
                break Ok(t_turn.elapsed().as_secs_f64() * 1000.0);
            }
            Ok(Some(RealtimeEvent::Error(e))) => break Err(e),
            Ok(Some(RealtimeEvent::Closed(e))) => break Err(format!("closed: {e}")),
            Ok(Some(_)) => continue,
        }
    };

    session.close().await;
    first_audio.map(|ms| (connect_ms, ms))
}

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn")).init();

    let api_key = std::env::var("LLM_API_KEY").expect("LLM_API_KEY not set");
    let mut args = std::env::args().skip(1);
    let trials: usize = args.next().and_then(|a| a.parse().ok()).unwrap_or(3);
    let models: Vec<String> = args.collect();
    if models.is_empty() {
        eprintln!("usage: live_latency_bench <trials> <model>...");
        std::process::exit(2);
    }

    println!("{PROMPT:?}  x{trials} per model\n");
    println!("{:<52} {:>9} {:>9} {:>9} {:>9}", "model", "connect", "min", "median", "max");

    for model in &models {
        let mut connects = Vec::new();
        let mut firsts = Vec::new();
        let mut failure = None;

        for _ in 0..trials {
            match once(&api_key, model).await {
                Ok((c, f)) => {
                    connects.push(c);
                    firsts.push(f);
                }
                Err(e) => {
                    failure = Some(e);
                    break;
                }
            }
            // A burst of back-to-back sessions gets throttled, which would
            // show up as latency that is ours rather than the model's.
            tokio::time::sleep(Duration::from_secs(2)).await;
        }

        if firsts.is_empty() {
            println!("{model:<52}   {}", failure.unwrap_or_else(|| "no result".into()));
            continue;
        }

        firsts.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median = firsts[firsts.len() / 2];
        let connect = connects.iter().sum::<f64>() / connects.len() as f64;
        println!(
            "{model:<52} {connect:>8.0}ms {:>8.0}ms {median:>8.0}ms {:>8.0}ms{}",
            firsts[0],
            firsts[firsts.len() - 1],
            failure.map(|e| format!("  (then: {e})")).unwrap_or_default()
        );
    }
}
