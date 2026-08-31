//! Does a listen-only session actually stay silent, and what does it report?
//!
//! After a transfer the agent stops talking and starts transcribing, so the
//! human-to-human part of the call still reaches the record. Two things have to
//! be true for that to be safe, and neither is worth assuming: the session must
//! emit transcripts of what it hears, and it must emit no audio at all.
//!
//! Real speech is needed to test it, so the live model supplies it: this asks
//! the conversational model to say a sentence, captures its audio, resamples
//! 24 kHz down to the 16 kHz the input side wants, and feeds that in. No fixture
//! files, and the audio is speech rather than a tone.
//!
//!   cargo run --release --bin transcribe_probe -- <listener-model>

use rustvani::services::realtime::gemini::{GeminiLiveConfig, GeminiLiveSession};
use rustvani::services::realtime::{RealtimeEvent, RealtimeSession};
use rustvani::audio_process::resamplers::{ResamplerQuality, StreamResampler};

/// The realtime module keeps its own copies of these private; a probe is not a
/// reason to widen their visibility.
fn pcm_to_f32(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
        .collect()
}

fn f32_to_pcm(samples: &[f32]) -> Vec<u8> {
    samples
        .iter()
        .flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes())
        .collect()
}
use std::time::Duration;

const LINE: &str = "Say exactly this and nothing else: \
Good morning, I would like to see Doctor Rao about my knee on Thursday.";

async fn speech() -> Result<Vec<u8>, String> {
    let mut session = GeminiLiveSession::connect(GeminiLiveConfig {
        api_key: std::env::var("LLM_API_KEY").unwrap(),
        model: "models/gemini-3.1-flash-live-preview".to_string(),
        voice: Some("Aoede".to_string()),
        instructions: "Repeat the user's sentence verbatim.".to_string(),
        ..Default::default()
    })
    .await?;
    let mut events = session.take_events().ok_or("events taken")?;
    session.send_text(LINE).await?;

    let mut pcm24 = Vec::new();
    loop {
        match tokio::time::timeout(Duration::from_secs(20), events.recv()).await {
            Ok(Some(RealtimeEvent::Audio(b))) => pcm24.extend_from_slice(&b),
            Ok(Some(RealtimeEvent::TurnComplete)) if !pcm24.is_empty() => break,
            Ok(Some(RealtimeEvent::Closed(e))) => return Err(format!("closed: {e}")),
            Ok(Some(_)) => continue,
            Ok(None) => break,
            Err(_) => break,
        }
    }
    session.close().await;
    if pcm24.is_empty() {
        return Err("no audio produced".into());
    }

    let mut down = StreamResampler::new(24_000, 16_000, ResamplerQuality::Medium);
    Ok(f32_to_pcm(&down.process(&pcm_to_f32(&pcm24))))
}

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn")).init();
    let key = std::env::var("LLM_API_KEY").expect("LLM_API_KEY not set");
    let model = std::env::args().nth(1).unwrap_or_else(|| "models/gemini-3.5-transcribe-live".into());

    let pcm16 = match speech().await {
        Ok(p) => p,
        Err(e) => return eprintln!("could not synthesise test speech: {e}"),
    };
    println!("spoke {:.1}s of 16 kHz audio\nlistening with {model}\n", pcm16.len() as f64 / 32_000.0);

    let mut session = match GeminiLiveSession::connect(GeminiLiveConfig {
        api_key: key,
        model,
        voice: None,
        instructions: String::new(),
        transcribe_only: true,
        ..Default::default()
    })
    .await
    {
        Ok(s) => s,
        Err(e) => return eprintln!("connect failed: {e}"),
    };
    let mut events = session.take_events().expect("events taken");

    // Real time, not a dump: a listener fed a whole utterance at once is not
    // being tested the way a call would use it.
    tokio::spawn(async move {
        for chunk in pcm16.chunks(640) {
            if session.send_audio(chunk).await.is_err() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        tokio::time::sleep(Duration::from_secs(12)).await;
        session.close().await;
    });

    let mut audio_bytes = 0usize;
    while let Ok(Some(event)) = tokio::time::timeout(Duration::from_secs(25), events.recv()).await {
        match event {
            RealtimeEvent::Audio(b) => audio_bytes += b.len(),
            RealtimeEvent::UserText(t) => println!("  heard    {t:?}"),
            RealtimeEvent::UserTextInterim(t) => println!("  interim  {t:?}"),
            RealtimeEvent::AgentText(t) => println!("  said     {t:?}"),
            RealtimeEvent::Closed(e) => {
                println!("  closed   {e}");
                break;
            }
            RealtimeEvent::Error(e) => println!("  error    {e}"),
            other => println!("  event    {other:?}"),
        }
    }

    println!(
        "\naudio emitted by the listener: {audio_bytes} bytes{}",
        if audio_bytes == 0 { "  (silent, as required)" } else { "  <-- WOULD TALK OVER THE CALL" }
    );
}
