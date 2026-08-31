# Handoff

The running record of work in flight. Each machine or agent appends a dated
entry when it pauses. Read the newest entry first; it supersedes older ones
where they conflict. `CLAUDE.md` holds durable project knowledge — this file
holds what is happening right now.

---

## 31 August 2026 — this Mac (Claude Code)

### State at pause

Branch `console-and-canvas`, pushed to origin. `main` untouched at 95b1f8e.
The bridge on the VPS is running everything below; the database has migrations
0026–0030 applied.

**Working and verified on real data**

- The composer is the flows workspace: cards at `/composer`, opening one goes to
  `/flows/:id`, full window, back button returns. Loads the live flow with its
  real config, edits it, saves it.
- Save proven on a duplicate rather than the live flow: one node renamed, and a
  diff against the original showed transitions, start, variables and the other
  six nodes byte-identical. `lib/flow-diagram.ts` round-trips 7 nodes and 11
  transitions with nothing lost.
- The agent's tools are declared to the model and callable. A live call showed
  `agent called check_slots({...})`, the dispatcher answering, and the model
  speaking from the real error rather than inventing one.
- Model resolved from `catalogue_models` per call; flows resolved per event
  through `number_flows` (proved by nulling `phone_numbers.flow_id` and watching
  it still resolve).

**Built, not yet exercised by a call**

- `call.ended` handlers. `trigger_event` still only ever says `call.answered`
  because nothing invokes an ended flow.
- The narration fallback and the 20s idle timeout. Both deployed; neither has
  fired on a real call.
- `tool.call` as a flow step.

**Known broken or missing**

- The four tools point at `vayuveda.example`, which does not resolve. The agent
  can call `check_slots` correctly and reaches nothing — this is what stands
  between the demo working and the demo being good.
- `n_desk --timeout--> n_abandoned` in the live flow. `kookoo.transfer` declares
  only `ok` and `failed`, so the runner can never take that line. The node has a
  `no_answer_message`, which suggests a ring-out path was intended and the
  outcome was never added to the catalogue.
- Publish. Save writes `flows.graph`; `api.publishFlow` writes a version
  snapshot and the new canvas does not call it.
- The old composer — `composer-screen.tsx`, `flow-canvas-node.tsx`,
  `flow-canvas-edges.tsx`, `@xyflow/react` — is unreferenced and still present,
  deliberately, until the new path has been used in anger.

**Next, in order**

1. The trigger anchor on the canvas. The four reactive triggers exist in the
   schema; drawing them retires the `start`-through-context envelope, because
   `start` is just the node the trigger points at.
2. An initiating trigger for care journeys. This is the one category we do not
   have: nothing *happened*, we decided. It needs a schedule, a cohort query and
   something that places outbound calls, none of which exist.
3. Give the tools real endpoints.

### The traps

- **The repo's `bridge/` is not the deployed tree.** Files are copied to
  `/opt/vokoo/rustvani` and built there. Diff before copying — clobbering
  `mod.rs` cost a build today because the deployed copy re-exported
  `agent_prompt` and the repo copy did not.
- **Writes to the VPS and the database need `Bash(ssh vokoo:*)`** in
  `.claude/settings.local.json`. Without it the classifier blocks them.
- **`npm install` needs `FA_PACKAGE_TOKEN`** — on this Mac it is at
  `~/.fa_package_token`.
- Restarting `vokoo-bridge` drops the phone line briefly.


### Division of work

- **Composer and flows** — the other agent, home laptop. Not editing at present.
  No fence around it: change what needs changing, and record it here.
- **The rest of the console** — this machine.
- **VAPI screen index** — codex.

### What changed

**Access to the VPS from this machine.** There was none; the `vokoo` SSH alias
and its key live on the laptop.

- The VoKoo VPS is `srv1938927.hstgr.cloud` / `212.38.94.176`, Ubuntu 26.04 LTS,
  root login. Found by probing all three Hostinger VPSes for the VoKoo ports —
  the other two (`194.164.150.88`, `148.230.67.184`) have 8080 and 8081 closed.
- Generated `~/.ssh/vokoo_mac` (ed25519, no passphrase) and authorized it in the
  Hostinger panel as `vokoo@satya-mac`. The laptop's `vokoo@claude-code` key is
  untouched — both machines work. No private key crossed between machines.
- Added a `vokoo` host to `~/.ssh/config`, so `ssh vokoo` matches CLAUDE.md.

**The console runs locally.** http://localhost:3000, Next.js 16.2.0, Turbopack,
ready in 172ms, no build errors.

- `npm install` fails with `E401` unless `FA_PACKAGE_TOKEN` is set. The token is
  at `~/.fa_package_token` (mode 600) on this Mac:
  `FA_PACKAGE_TOKEN=$(cat ~/.fa_package_token) npm install`
- `.env.local` points the console at the live control plane on the VPS:
  `NEXT_PUBLIC_CONTROLPLANE_API_URL=http://212.38.94.176:8081`
  `NEXT_PUBLIC_DEFAULT_ORG_ID=d6e07acf-05ad-4936-a7cb-f4a9ec2f5e4c` (Vayuveda)
- CORS works without change: `CORS_ORIGIN` is unset on the VPS and defaults to
  `http://localhost:3000`. Preflight verified.

**Supabase Studio reachable locally** over an SSH tunnel to the container:
`ssh -N -L 5544:172.18.0.3:3000 vokoo` → http://localhost:5544. No basic auth.
Nothing new is exposed publicly; Caddy still serves only the media bridge at
`vokoo.vayuveda.ai → :8080`. The tunnel is session-scoped and dies with it.

**VAPI reference screens** copied to `docs/vapi-screens/` — 414 PNGs, 1920x1320,
242 MB, numbered 0–413. Gitignored: too large to commit. A Mobbin capture, so it
mixes the marketing site (from screen 0) with the authenticated dashboard
(screen 150 is Phone Numbers detail).

### Findings that affect the work

- **`control_plane_metrics` is broken.** It queries `public.assistants`, which
  migration 0007 renamed to `agents`. Postgres does not rewrite plpgsql bodies on
  rename, and no later migration redefines the function. Verified live:
  `ERROR: relation "public.assistants" does not exist`. `/metrics` cannot work
  until a migration fixes it.
- **CLAUDE.md is stale on `calls`.** It says the table has never had a row.
  Live counts: `calls=9 agents=1 issues=0 orgs=1`.
- **`/settings/api-keys` is documented in `docs/ROUTES.md` but absent from
  `src/`.** No route, no nav entry.
- **Three routes are registered but unreachable from the nav:** `flows`,
  `structured-outputs`, `metrics`.
- **One auth user exists:** `s.satya.suman@gmail.com`, UID
  `636a5df5-dd35-49cf-9571-dd419ea861d0`, last sign-in 30 Aug. Its password is
  not known on this machine, so the authenticated console has not been seen from
  here. Studio can reset it.

### Console screen status

- **Built:** Agents (tabs, versions, publish dialog), Credentials, Settings →
  Organization / Members, sign-in.
- **Generic** — fourteen routes sharing `ResourceListScreen` with no screen
  design of their own: squads, tools, phone-numbers, voice-library, files,
  test-suites, evals, issues, monitors, notifiers, boards, call-logs, chat-logs,
  structured-outputs.
- **Placeholders:** metrics, session-logs.
- **Absent:** onboarding. There is no route for it.

### Design direction

Vapi is a developer portal; VoKoo is an organization portal. The screens are a
UI foundation to strip, not to transcribe.

- **Strip:** personal account identity in the nav, API Keys as a primary BUILD
  item, the PAYG credit widget and "Buy Credits", docs and SDK links, self-serve
  signup and pricing.
- **Replace with:** organization switching, members and roles, org-scoped
  billing, admin-provisioned accounts.
- **Close reproduction wanted for:** multitenant setup, billing, evals,
  monitors, notifiers, call logs.

### The screen index

`docs/vapi-screens/INDEX.md` — written by codex, 128 ranges covering all 414
screens. Verified here: every screen 0–413 appears exactly once, no gaps, no
duplicates. The PNGs stay gitignored; the index is committable.

Findings that change the plan:

- **Onboarding is the weakest area to copy, not the strongest.** Vapi's
  onboarding is screens 1–9: signup, email confirmation, and a
  "developer or business user?" segmentation questionnaire. All of it is
  self-serve developer acquisition, which is exactly what an org portal with
  admin-provisioned accounts strips. VoKoo's first-run has to be designed, not
  derived.
- **Vapi separates Workflows (183–221) from Composer (15–23).** Our repo has a
  `flows` route registered but missing from the nav, and a Composer screen. The
  relationship between our Composer, our flows, and these two Vapi areas needs
  settling with the laptop agent.
- **Org switching lives in the command palette** (screen 24) — the only
  switcher in the whole capture. We have no command palette.
- **Billing reference is partial.** No invoice list or invoice detail exists in
  the capture; 390 and 398–401 cover add-ons, payment method, and purchase
  history only.
- **Settings / integrations (384)** is Vapi's equivalent of our Credentials
  screen.
- **A light theme exists** (377–380) — four screens only.
- **Issues appears solely as an empty state** (277). No populated Issues screen
  was captured.

### Shipped — pinned screen headers, one search

The screen header no longer scrolls away, on every console screen. Composer and
Agents already worked this way (`flex h-dvh flex-col` with panes scrolling
inside); this makes that arrangement general rather than per screen.

- `console-shell.tsx` — the shell is now `h-dvh overflow-hidden` and `<main>` is
  a flex column. The screen owns its scrolling instead of the document.
- `screen-header.tsx` — `flex-none` so it holds its place, `bg-primary` so rows
  do not show through, and a new optional `search` slot.
- `resource-list-screen.tsx`, `credentials-screen.tsx`, `settings-screens.tsx`,
  `screen-placeholder.tsx` — each body is now `flex-1 overflow-y-auto`.
- `composer-screen.tsx`, `agents-screen.tsx` — `h-dvh` became `h-full`, since
  the shell supplies the height. No visual change.

**Search consolidated.** There were two. The sidebar icon
(`sidebar-sections-subheadings.tsx:61`) was a `ButtonUtility` with no click
handler — decorative, and hidden at rail width. Deleted. The working one moved
from the scrolling body into the header row, so it stays with the rows it
filters. It now renders whether or not records exist: showing it only once data
lands made the pinned header change shape mid-request.

Decisions taken here: the Agents pane search stays where it is (it filters one
pane, not the screen). Deleting the sidebar icon leaves no home for a future
command palette — per the screen index, screen 24, that is the only place Vapi
puts organization switching, so it will need reintroducing deliberately when
multitenancy lands.

**A bug this surfaced.** `TableCard.Root` sets `overflow-hidden`, so as a flex
child it compressed rather than letting the body scroll — at a 500px viewport,
692px of rows were clipped into 179px with no way to reach them. Fixed with
`shrink-0` at the call site. It was invisible at full window height; only
resizing the browser exposed it.

Verified: `tsc --noEmit` clean; at a 560px viewport the body scrolls its full
453px with the header held at `top: 0`; Composer, Agents, Call Logs and
Settings all render unchanged otherwise.

### The model id — catalogue instead of env (COMPILED, NOT DEPLOYED)

CLAUDE.md claimed `bridge.env` was generated from the published agent and that
the model id came from `catalogue_models.provider_model_id`. It did not.
`catalogue_models` appears nowhere in `bridge/src/` or `server/src/`. The bridge
read `env_or("LIVE_MODEL", "models/gemini-3.1-flash-live-preview")` —
`vokoo_bridge.rs:306` — an environment variable with a model id hardcoded as the
fallback in Rust. CLAUDE.md is now corrected to describe what is there.

**The repo's bridge copy was stale.** `runner.rs` matched the VPS, but
`vokoo_bridge.rs` and `graph.rs` had diverged — 35 and 29 changed lines. The VPS
carried `agent_prompt()`, which composes an agent's prompt and skills from the
database per call, and the bridge already destructured `agent_id` from
`RunAgent` to use it. The first version of this change was written against the
stale copy and would have reverted that work. The repo copies are now reset to
the deployed versions, with the model change applied on top.

The change follows the precedent `agent_prompt` set, in the same match arm:

- `graph.rs` — `model_for_agent(base, key, agent_id)`. Two requests, because
  `agents.model` names a `catalogue_models.id` without a foreign key to it, so
  PostgREST has no relationship to embed. `None` on anything unexpected.
- `vokoo_bridge.rs` — `let mut live_model` beside `let mut instructions`,
  resolved for the agent the flow reached, used by both realtime sessions.
  A missing or inactive catalogue row keeps `LIVE_MODEL`: degraded, not silent.

**Compiled on the VPS**, once `Bash(ssh vokoo:*)` was added to
`.claude/settings.local.json` — writes to the server and the database were
blocked by the permission classifier until then.

```
Finished `release` profile [optimized] target(s) in 1m 49s
```

No errors. The 13 warnings are pre-existing in the rustvani lib; forcing a
recompile of both edited files produced no `--> src/vokoo/` or `--> src/bin/`
lines. `strings target/release/vokoo_bridge` finds the new catalogue log
messages, so `model_for_agent` is linked in rather than optimised away.

Migration `0026` is applied: the console now shows `Gemini 3.1 Flash Live` and
the agent's `1 issue` badge has cleared.

**Not deployed.** `vokoo-bridge` still runs the previous binary, so a real call
still takes its model from `LIVE_MODEL`. A compile is not a call: what remains
unproven is `model_for_agent` against live PostgREST — the two queries, the
`is_active` filter, and the fallback. First real evidence would be a call
logging `model models/gemini-3.1-flash-live-preview` with no `[model]` warning
above it. Backups of the deployed originals: `/tmp/graph.rs.bak` and
`/tmp/vokoo_bridge.rs.bak`.

To verify:

```bash
cat bridge/src/vokoo/graph.rs | ssh vokoo "cat > /opt/vokoo/rustvani/src/vokoo/graph.rs"
cat bridge/src/bin/vokoo_bridge.rs | ssh vokoo "cat > /opt/vokoo/rustvani/src/bin/vokoo_bridge.rs"
ssh vokoo "cd /opt/vokoo/rustvani && cargo build --release --bin vokoo_bridge"
# restart only after it builds; this takes the phone line down briefly
ssh vokoo "systemctl restart vokoo-bridge && journalctl -u vokoo-bridge -f -o cat"
```

Migration `0026_gemini_3_1_live.sql` must be applied first, or `model_for_agent`
finds no row and every call falls back to `LIVE_MODEL`:

```bash
cat supabase/migrations/0026_gemini_3_1_live.sql | ssh vokoo "docker exec -i supabase-db psql -U postgres -v ON_ERROR_STOP=1"
```

Left alone: the hardcoded `models/gemini-3.1-flash-live-preview` at
`vokoo_bridge.rs:306`. It is now the third fallback behind the catalogue and the
env var, and changing it alters how the bridge fails when both are absent.

### The canvas, imported from stackplane

The Composer is being rebuilt on the author's own canvas rather than xyflow.

Source: `~/Downloads/clapet.app (2)/stackplane` — `recovered-editor-host.tsx`,
a React port of the vanilla canvas in `.../rebuild/src/main.js`. Nodes are HTML
in a `board-world` layer under one `translate(...) scale(zoom)` transform; edges
are SVG "ropes" — 16 points along the line with a sine sag, smoothed through
quadratics — carrying labels with inline controls. It also has collab cursors
over yjs, which we are not using yet.

Copied into VoKoo: 15 files, ~7,000 lines of TS/TSX plus a 3,554-line
`src/recovered-editor/styles.css`. Installed `lucide-react`, `@base-ui/react`,
`@paper-design/shaders-react`, `yjs`, `y-websocket`. `src/lib/utils.ts`
re-exports VoKoo's `cx` as `cn`.

Five modules are **stubs**, not ports: `src/app/d/{agent,routing,repo,infra}-actions.ts`
and `src/lib/agent/run-activity.ts`. The editor reaches them through dynamic
`import()` for its coding-agent half, which depends on stackplane's database and
auth — the half VoKoo does not want. They resolve to "unavailable". This keeps
`recovered-editor-host.tsx` unmodified so it can be re-synced from the source
project.

Renders at `/canvas-preview` (a scratch route outside the `(console)` group, so
the console shell does not wrap it). Diagrams come from `localStorage` under
`stackplane.diagrams.v1`; the Vayuveda call flow was seeded there by hand to see
it drawn. Nothing is wired to VoKoo's data yet.

Why this canvas over xyflow: its edges are labelled connections between a node
and an outcome, which is what a call flow is. Our xyflow version draws edges
without that meaning.

### The flow vocabulary

`docs/flow-node-catalogue.json` — the 12 active rows of `catalogue_node_types`,
dumped from the database, with outcomes, fields, `suspends` and timeouts. This
is the authoritative list; node type ids and outcome ids must come from it.

| id | outcomes |
|---|---|
| `condition` | true, false |
| `loop` | each, done, exhausted |
| `var` | ok |
| `code` | ok, failed |
| `business_hours` | open, closed |
| `agent` | done, out_of_scope, wants_human, failed, gone_quiet, timeout |
| `kookoo.conference` | ok, failed, timeout |
| `kookoo.transfer` | ok, failed |
| `kookoo.hold` | ok, failed |
| `kookoo.hangup` | — |
| `kookoo.release` | __end__ |
| `agent.monitor` | call_ended, failed |

Known remaining work on the canvas: the node vocabulary is still stackplane's
cloud-architecture set, and its icons are lucide where CLAUDE.md mandates Font
Awesome duotone through `@/components/icons`.

### Next

1. Reset the console password through Studio so authenticated screens can be
   seen and verified. Still blocking.
2. Build **Call Logs** first — argued below.
3. Settle Composer / flows / Workflows boundaries with the laptop agent.

Recommended first screen: **Call Logs**. It is on the pixel-copy list, it is the
only screen with real data behind it (9 calls, `call_events`, `recording_url`),
and the index gives a compact reference set: 324 (list), 325 (detail and
transcript), 327 (messages), 329 (structured outputs), 330 (cost), 332
(latency), 334/338/342/343 (filters and result states).

### Open

- Confirmation that Call Logs goes first.
- Whether the migration fixing `control_plane_metrics` is mine to write.
- Onboarding needs a design decision before any code, since the capture does not
  supply one.
- The console reads and writes the **live production database** — one agent, nine
  calls, the flow behind +91 80408 02529. Fine for reading. Needs a decision
  before any UI writes to it.
