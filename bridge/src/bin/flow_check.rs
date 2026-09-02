//! Exercises flow resolution and the runner without placing a call.
use rustvani::vokoo::{CallControl, CallHandle, FlowRunner, NodeAction};

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let base = std::env::var("SUPABASE_URL").unwrap_or_default();
    let key = std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap_or_default();
    let did = std::env::args().nth(1).unwrap_or_else(|| "918040802529".into());
    // Keys to press, in order, one per menu the flow reaches:
    //     flow_check 918040802529 2
    // walks past a language menu by pressing 2. Without them the tool stops at
    // the menu and prints where each key would lead.
    let mut presses: std::collections::VecDeque<String> = std::env::args().skip(2).collect();

    let Some(flow) = rustvani::vokoo::graph::resolve_for_did(&base, &key, &did).await else {
        println!("NO FLOW for {did} — the call would go straight to the agent");
        return;
    };
    println!("flow      : {} ({})", flow.name, flow.id);
    println!("answers at: {}", flow.start);

    let control = CallControl::new(
        CallHandle {
            ucid: "dry-run".into(),
            did: did.clone(),
            caller: "919999999999".into(),
            org_id: flow.org_id.clone(),
        },
        base.clone(),
        key.clone(),
        // A dry run queues nothing: it never reaches the IVR webhook that would
        // collect a hand-over. This argument was added to CallControl and never
        // reached here, which is why the tool stopped compiling.
        rustvani::vokoo::Handovers::new(),
    );

    let mut runner = FlowRunner::new(&flow, &control);
    let action = loop {
        let action = runner.advance().await;
        let NodeAction::CollectDigits { node, prompt, language, keys, timeout_seconds, .. } = &action
        else {
            break action;
        };

        println!("-> ASKS FOR A KEY at '{}' ({}s, spoken in {language})", node.name, timeout_seconds);
        println!("   says         : {prompt}");
        for (key, label) in keys {
            let next = flow.next(&node.id, key).unwrap_or("(nothing wired)");
            let target = flow.node(next).map(|n| n.name.as_str()).unwrap_or(next);
            println!("   press {key:<8}-> {label} → {target}");
        }
        {
            let next = flow.next(&node.id, "timeout").unwrap_or("(nothing wired)");
            let target = flow.node(next).map(|n| n.name.as_str()).unwrap_or(next);
            println!("   {:<14}-> {target}", "no key");
        }

        // Nothing left to press: stop here rather than guessing a key, which
        // would report a path the caller never chose.
        let Some(pressed) = presses.pop_front() else {
            return;
        };
        if !keys.iter().any(|(key, _)| key == &pressed) && pressed != "timeout" {
            println!("\n   '{pressed}' is not one of this menu's keys.");
            return;
        }
        println!("\n   [pressing {pressed}]\n");
        let node_id = node.id.clone();
        runner.digits_collected(&node_id, &pressed);
    };

    match action {
        NodeAction::RunAgent { node, agent_id, timeout_seconds } => {
            println!("-> reaches AGENT '{}' agent_id={agent_id} timeout={timeout_seconds}s", node.name);

            // The engine the call would run on, resolved the same way the bridge
            // resolves it. Worth printing here because the alternative is
            // reading it off a live call: an agent that names no published
            // engine falls back to the environment silently, and this is the
            // only place that says so before the phone rings.
            match rustvani::vokoo::engine_for_agent(&base, &key, &agent_id).await {
                Some(engine) => {
                    println!("   engine       : {} [{}]", engine.name, engine.mode);

                    // A relay has no realtime stage, and reading one anyway
                    // reported "NOT IN CATALOGUE" for an engine that was fine.
                    // Each shape is described in its own terms.
                    if engine.mode == "realtime" {
                        let model = engine.get("realtime", "model").unwrap_or("—");
                        let resolved = rustvani::vokoo::graph::model_id(&base, &key, model)
                            .await
                            .unwrap_or_else(|| "NOT IN CATALOGUE".into());
                        println!(
                            "                  {model} -> {resolved} voice={}",
                            engine.get("realtime", "voice").unwrap_or("—")
                        );
                        println!(
                            "   parameters   : temperature={} max_tokens={}",
                            engine
                                .get_f64("realtime", "temperature")
                                .map(|v| v.to_string())
                                .unwrap_or_else(|| "provider default".into()),
                            engine
                                .get_f64("realtime", "max_tokens")
                                .map(|v| (v as u32).to_string())
                                .unwrap_or_else(|| "provider default".into()),
                        );
                    } else {
                        for (stage, label) in
                            [("stt", "listening"), ("llm", "thinking"), ("tts", "speaking")]
                        {
                            println!(
                                "     {label:<11}: {} {}{}",
                                engine.get(stage, "provider").unwrap_or("NOT SET"),
                                engine.get(stage, "model").unwrap_or("—"),
                                engine
                                    .get(stage, "voice")
                                    .map(|v| format!(" as {v}"))
                                    .unwrap_or_default(),
                            );
                        }
                        println!(
                            "   language     : {}",
                            engine.get("stt", "language").unwrap_or("en-IN (default)")
                        );
                    }
                }
                None => println!(
                    "   engine       : none published — falls back to LIVE_MODEL/LIVE_VOICE"
                ),
            }

            for outcome in ["done", "wants_human", "out_of_scope", "gone_quiet"] {
                let mut r = FlowRunner::new(&flow, &control);
                let _ = r.advance().await;
                r.agent_finished(&node.id, outcome);
                // Only report where it would go; do not fire carrier commands.
                let next = flow.next(&node.id, outcome).unwrap_or("(nothing wired)");
                let label = flow.node(next).map(|n| n.name.as_str()).unwrap_or(next);
                println!("   {outcome:<14} -> {label}");
            }
        }
        // Added to NodeAction after this tool was last built. A flow that
        // opens on a monitor node is a real shape the runner reports; the dry
        // run has nothing to listen to, so it says so and stops.
        NodeAction::Monitor { node, .. } => {
            println!("-> opens on MONITOR '{}' — nothing to listen to in a dry run", node.name);
            return;
        }
        // The loop above consumes every menu, so this arm exists only to make
        // the match total.
        NodeAction::CollectDigits { node, .. } => {
            println!("-> menu '{}' escaped the loop above — this is a bug", node.name);
        }
        NodeAction::Finished(reason) => {
            println!("-> the call would END without a conversation: {reason}");
        }
    }
    println!("trail     : {:?}", runner.trail);
}
