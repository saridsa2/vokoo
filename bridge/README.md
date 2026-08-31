# The media bridge

The Rust that holds a call: it answers KooKoo's WebSocket, runs the flow, talks
to the agent, and hands the caller to a person when the agent cannot help.

## Why this is a copy and not a crate

The bridge is built inside [rustvani](https://github.com/Allenmylath/rustvani),
which supplies the pipeline, the transports, the resamplers and the VAD. The
files here are the VoKoo-owned parts of that tree, kept at the paths they occupy
inside it:

```
src/vokoo/                  the flow layer — graph, runner, call control, record, handover
src/services/realtime/      speech-to-speech sessions (Gemini Live, OpenAI Realtime)
src/serializers/kookoo.rs   the KooKoo wire protocol
src/bin/vokoo_bridge.rs     the bridge itself
src/bin/*_check.rs, *_probe.rs, *_bench.rs
                            throwaway tools that answered a question on a real
                            call — the latency bench that found a 7x model
                            difference, the probe that proved a listen-only
                            session emits no audio
rustvani-integration.patch  the handful of edits to rustvani's own files
```

They are here because until now they existed in exactly one place — a working
tree on the VPS, untracked. Losing that box lost the project.

**This directory does not build on its own.** To work on it, copy these paths
into a rustvani checkout, apply `rustvani-integration.patch`, and build there.
That is a real limitation, not a convention: the bridge uses rustvani's
internals, so extracting it into a crate that depends on rustvani is a genuine
refactor rather than a move.

## Deployment

`vokoo-bridge.service` on the VPS, reading `bridge.env` — which is **not** in
this repository and holds the Gemini key, the Supabase service role key and the
model selection. The rest of the configuration lives in the database, so that a
number, a flow or an agent can change without a deploy.

## What a call does

```
KooKoo NewCall     → <stream> XML, the DID carried in x-uui
WebSocket start    → resolve the DID to a published flow
                   → walk the graph to the agent node
                   → Gemini Live, speech to speech
finish_call(...)   → the agent reports an outcome; the flow decides what it means
                   → carrier action: hand over, conference, hang up
socket closes      → KooKoo asks what next; the call is still up
event=Stream       → <dial> the front desk, or say goodbye
event=Dial         → if nobody answered, tell the caller so
```

Every step of that writes to `calls` and `call_events`, so a call is a trace
against the graph rather than a duration and a recording.
