//! Connects to Gemini Live with the agent's configured model and asks it to
//! speak, so a bad model id is found here rather than by a caller.
use rustvani::services::realtime::{RealtimeEvent, RealtimeSession};
use rustvani::services::realtime::gemini::{GeminiLiveConfig, GeminiLiveSession};

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn")).init();
    let model = std::env::var("LIVE_MODEL").unwrap_or_default();
    let voice = std::env::var("LIVE_VOICE").ok();
    println!("model: {model}\nvoice: {voice:?}");

    let mut session = match GeminiLiveSession::connect(GeminiLiveConfig {
        api_key: std::env::var("LLM_API_KEY").unwrap_or_default(),
        model,
        voice,
        instructions: "You are a clinic receptionist. One short sentence.".into(),
        functions: Vec::new(),
        // The rest from `Default`, so a field added to the config later does
        // not break this binary — and with it every test in the crate, since a
        // test target is all-or-nothing. That is exactly how `cargo test` went
        // dead once already; this is the second time, on a different file.
        ..Default::default()
    })
    .await
    {
        Ok(s) => { println!("connect: OK"); s }
        Err(e) => { println!("connect: FAILED — {e}"); return; }
    };

    let _ = session.send_text("Greet the caller in one short sentence.").await;
    let Some(mut events) = session.take_events() else { return };

    let mut audio = 0usize;
    let mut said = String::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(25);
    loop {
        let Ok(Some(ev)) = tokio::time::timeout_at(deadline, events.recv()).await else { break };
        match ev {
            RealtimeEvent::Audio(b) => audio += b.len(),
            RealtimeEvent::AgentText(t) => said.push_str(&t),
            RealtimeEvent::Error(e) => println!("error: {e}"),
            RealtimeEvent::Closed(r) => { println!("closed: {r}"); break }
            _ => {}
        }
        if audio > 0 && !said.is_empty() { break }
    }
    println!("audio : {} bytes ({:.2}s at 24kHz)", audio, audio as f64 / 2.0 / 24000.0);
    println!("said  : {said}");
}
