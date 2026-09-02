# Vendor files this project edits

Files shipped by somebody else that VoKoo modifies in place. **An upgrade
replaces them and takes the change with it**, silently, so each one is written
down here with what it does and how to tell whether it is still applied.

The pattern is the same one `src/styles/vokoo-brand.css` uses against Untitled
UI's `theme.css`: prefer a file of our own that wins, and where that is not
possible, record the edit.

---

## `supabase/.../functions/main/index.ts` — an empty environment for `run`

**On the VPS:** `/opt/supabase/supabase/docker/volumes/functions/main/index.ts`
**Pristine copy:** `index.ts.vokoo-orig`, beside it
**Marked with:** `// ---- VOKOO OVERRIDE ----`

### What it does

The main service creates a worker per function and hands each one
`{ ...Deno.env.toObject() }` — the whole container environment. On this
deployment that includes:

| | |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | read and write every table in every organisation |
| `SUPABASE_DB_URL` | a direct Postgres connection string, with the password |
| `JWT_SECRET` | mint a token as any user |
| `SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEYS`, `SUPABASE_PUBLISHABLE_KEYS` | |

The `run` function evaluates a handler somebody wrote and pushed with the SDK.
Without this override that handler is handed the list above. This is not a
theory — it was measured before the override was written, with a tool whose
whole body was `Deno.env.toObject()`:

```
visible: 15   canReadServiceKey: true   serviceKeyHead: "eyJhbGciOiJIUz"
```

The function cannot protect itself: `Deno.env.delete` throws `NotSupported` on
this runtime, so a variable that reaches the worker stays there. The only place
it can be withheld is where the worker is created.

The override does two things for the `run` slug, and nothing for any other:

1. **Authenticates the caller** against `VOKOO_RUN_SECRET` before the worker
   exists. This moved out of `run` itself because `run` has no secret left to
   compare against once its environment is empty. Nothing can reach the worker
   another way — this is the main service, so every request arrives through it.
2. **Creates the worker with an empty environment.** Only
   `SUPABASE_FUNCTION_SLUG` is passed; the runtime adds `SB_EXECUTION_ID` of its
   own.

Afterwards, the same probe reports:

```
visible: 2    canReadServiceKey: false
names: ["SB_EXECUTION_ID", "SUPABASE_FUNCTION_SLUG"]
```

Every other function is untouched, which matters: the `tools` dispatcher needs
the service role key and still has it.

### Checking it is still applied

```bash
ssh vokoo 'grep -c "VOKOO OVERRIDE" /opt/supabase/supabase/docker/volumes/functions/main/index.ts'
```

`0` means an upgrade has reverted it and **every pushed tool can read the
database again**. Re-apply from `index.ts.vokoo-orig` plus the block, and
restart: `docker compose restart functions`.

The stronger check is the probe itself — push a tool that returns
`Deno.env.toObject()` and run it. If it can see more than two variables, the
override is gone.

### Why it is not a file of our own

The main service is chosen by the container's command line
(`start --main-service /home/deno/functions/main`) and there is one of it. A
sibling file cannot take precedence the way a later CSS import can.

---

## `supabase/.../docker-compose.yml` — passing `VOKOO_RUN_SECRET`

**On the VPS:** `/opt/supabase/supabase/docker/docker-compose.yml`

The `functions` service lists its environment explicitly, so a variable added to
`.env` does not reach the container. `VOKOO_RUN_SECRET` is declared in that
block. Without it the main service has nothing to authenticate `run` against and
refuses every request — which fails closed, so this one announces itself rather
than going quiet.

## rustvani `src/utils/sentence_splitter.rs` — char-safe cuts

Not our file. Upstream rustvani, edited in place, so **a rustvani upgrade
reverts it.**

Two byte-index slices assumed the cut point was a character boundary. It is,
for English. Every Devanagari character is three bytes, so a byte limit lands
inside one about two times in three — and slicing a `str` there panics. On
1 September a Hindi greeting killed the TTS task mid-call
(`end byte index 150 is not a char boundary; it is inside 'औ'`), the line went
silent and the caller hung up after eight seconds.

`floor_char_boundary` now snaps both cuts down to a boundary, and the hard-split
path takes one whole character when the limit floors to zero — otherwise it
drains nothing and spins forever. Four tests cover it; all four fail on the
original.

Check it survived an upgrade with:

```bash
ssh vokoo 'cd /opt/vokoo/rustvani && grep -c floor_char_boundary src/utils/sentence_splitter.rs'
```

## `elevenlabs-sdk` 0.1.0 — vendored subset

`bridge/src/services/tts/elevenlabs_api/` is 4,311 lines copied from the
`elevenlabs-sdk` crate, not a dependency on it. **An upgrade does not reach it;
a re-copy has to reapply the edits below.**

### Why it is vendored rather than depended on

The crate builds on `hpx`, which pulls `boring` (BoringSSL), `tonic` and
`prost`. `boring-sys` fails to build on this server — it needs a C and Go
toolchain — and that is a large tree to carry in the process that answers phone
calls. Verified by trying: `cargo build` failed in `boring-sys`'s build script.

### The upstream tests were removed — and had broken `cargo test` for the repo

`error.rs`, `services/voices.rs` and `services/models.rs` each carried the
crate's own `#[cfg(test)]` module. They construct the `hpx`-based
`ElevenLabsClient` and import `config` and `types` paths this subset does not
vendor, so they cannot compile here — and because a test target is all-or-
nothing, **no test in this project ran between the subset landing on
1 September and its removal the same day.** 365 of them existed.

Removed rather than repaired: repairing them means re-vendoring the parts of
the crate they test, which is the thing taking a subset decided against. A
`VENDOR CHANGE` note sits at the foot of each file. **A re-copy brings them
back and silently kills `cargo test` again** — check with `cargo test --lib`
before believing a green run.

### What was taken

`types/{common,models,text_to_speech,voices}.rs`, `services/{models,voices}.rs`,
`auth.rs`, `config.rs`, `error.rs` — copied. Upstream has 27,217 lines across
twenty-three type modules; dubbing, studio, music, PVC voices, workspace,
agents, history and sound generation have no bearing on a call and were left.

### What was changed — eight edits, each marked in place

Every one carries a `VENDOR CHANGE` or `VENDOR ADDITION` comment, so a diff
against a future release shows what has to be redone.

| File | Change |
|---|---|
| `client.rs` | **Rewritten, not copied.** Upstream is 846 lines on `hpx`; ours is 147 on `reqwest`, providing the same verbs the copied services call. |
| `error.rs` | `Transport(#[from] hpx::Error)` → `Transport(String)`; `InvalidUrl(#[from] url::ParseError)` → `InvalidUrl(String)`; added `Http` and `Decode`, which reqwest reports separately. |
| `auth.rs` | Added `expose()` beside `as_str()` — named for what it does at a call site handing a secret to a header. |
| `services/voices.rs` | Two let-chains rewritten as nested `if let`. Let-chains need Rust edition 2024; rustvani is on 2021. |
| `types/mod.rs` | Declares the four copied modules instead of twenty-three. |
| `services/mod.rs` | Declares the two copied services. |

### What was dropped and why

`services/text_to_speech.rs` — REST synthesis, unused: a call synthesises
through the WebSocket handler in `tts/elevenlabs.rs`. It was also the only file
pulling `futures_core`.

`services/speech_to_text.rs` and `types/speech_to_text.rs` — uses let-chains,
and nothing calls it; there are already four transcribers.

### How to tell whether it is still applied

```bash
ssh vokoo 'grep -rc "VENDOR CHANGE\|VENDOR ADDITION" \
  /opt/vokoo/rustvani/src/services/tts/elevenlabs_api/ --include=*.rs | \
  awk -F: "{n+=\$2} END {print n\" marked edits (expect 8)\"}"'
```

A count below eight means a re-copy dropped an edit, and the crate will not
build against edition 2021 or against `reqwest`.

### The streaming synthesiser is *not* vendored

`bridge/src/services/tts/elevenlabs.rs` is ours, written against the wire
protocol, because it has to be a `FrameHandler` in rustvani's pipeline rather
than a standalone client. It shares nothing with this tree.
