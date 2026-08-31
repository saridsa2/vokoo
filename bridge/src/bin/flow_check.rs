//! Exercises flow resolution and the runner without placing a call.
use rustvani::vokoo::{CallControl, CallHandle, FlowRunner, NodeAction};

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let base = std::env::var("SUPABASE_URL").unwrap_or_default();
    let key = std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap_or_default();
    let did = std::env::args().nth(1).unwrap_or_else(|| "918040802529".into());

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
    match runner.advance().await {
        NodeAction::RunAgent { node, agent_id, timeout_seconds } => {
            println!("-> reaches AGENT '{}' agent_id={agent_id} timeout={timeout_seconds}s", node.name);
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
        NodeAction::Finished(reason) => {
            println!("-> the call would END without a conversation: {reason}");
        }
    }
    println!("trail     : {:?}", runner.trail);
}
