# KooKoo / Ozonetel — platform reference

Saved 1 September 2026 from the `kookoo-voicebot` skill.

**Read the first half, ignore the second.** This document is two things bolted
together:

- **The carrier's protocol** — XML verbs, the WebSocket event shapes, the DTMF
  format, the platform limits, and a long table of failures somebody actually
  hit. This is true regardless of what language your bridge is written in, and
  it is the best account of KooKoo we have. Where it and our code disagree,
  check both before believing either — but its DTMF section already agrees with
  `src/serializers/kookoo.rs` line for line, which is the strongest credibility
  signal a document like this can give.

- **A Node.js product's build instructions** — `npm install kookoo-voicebot`,
  Railway, an ElevenLabs dashboard, prompts pasted into a web UI. **That is not
  this project.** VoKoo's bridge is Rust and only Rust (see CLAUDE.md, *Survey
  Before Building*, and the day that rule cost). Do not scaffold from it.

Three things in here are worth acting on and are noted where they appear:

1. **DTMF arrives on the WebSocket during the stream**, nested inside a `media`
   event — and `<collectdtmf>` is a *different* mechanism that collects digits
   *between* streams. Both are usable for language selection and they have
   different consequences. See "Keypad press" and `<collectdtmf>` below.
2. **Three concurrent calls per extension.** A hard platform limit we have never
   hit because we have never had four callers at once.
3. **If your WebSocket errors or closes, the platform terminates the call.** A
   crash in the bridge is not a silent bot — it is a hung-up caller.

Kept verbatim below.

---

# KooKoo Voice Agent Builder

You are building an AI voice agent that handles real phone calls. The user describes what kind of agent they want, and you generate a complete, deployable Node.js application using the `kookoo-voicebot` SDK.

## What to build

Based on their description, you will:
1. **Determine the AI provider:**
   - If `--multilingual` (or just `--openai`), use OpenAI Multilingual — single `gpt-realtime-2` session with native language detection (Option C below)
   - If `--openai-en`, use OpenAI Realtime in English-only mode (Option A below) — same model but locked to English. Pick this only when you're certain every caller speaks English and want the simplest prompt.
   - If `--elevenlabs`, use ElevenLabs Conversational AI (Option B)
   - If `--translate`, use the OpenAI Translate Bridge (Option D, EXPERIMENTAL)
   - If the user named a provider in prose ("using OpenAI", "with ElevenLabs", "translate live"), use that — but if they say "OpenAI" without qualification, prefer **multilingual** since it works for English too
   - **Default = `--multilingual`.** It works for callers speaking ANY supported language (including English), no dashboard, lowest latency.
2. Scaffold a complete Node.js project
3. Install `kookoo-voicebot` from npm
4. Write `index.js` with the appropriate provider config and hooks
5. If ElevenLabs: write the agent system prompt to paste in ElevenLabs dashboard
6. If OpenAI: write the system prompt directly in code (`instructions` field)
7. If OpenAI Translate Bridge: write an English-only receptionist prompt; the translate sessions are language-agnostic. NOTE: translate-bridge is not yet a built-in `provider` on the SDK.
8. Create deployment files (Procfile, nixpacks.toml, .env.example, .gitignore)
9. Tell them exactly how to deploy and get a working phone number

---

## Step-by-step: Build the voice agent

### 1. Scaffold the project

```bash
mkdir <agent-name> && cd <agent-name>
npm init -y
npm install kookoo-voicebot
```

### 2. Create index.js

The SDK supports two providers (OpenAI, ElevenLabs) plus an advanced translate-bridge pattern that's implemented in user code (not yet as an SDK provider).

**Pick by use case:**
- **Default — Option C: OpenAI Multilingual.** One `gpt-realtime-2` session, audio in / audio out, the model auto-detects the caller's language and replies in same. ~500–1000 ms latency. Works for English too.
- **Option A: OpenAI Realtime (English-only).** Same model as multilingual, but instructions lock it to English.
- **Option B: ElevenLabs.** Higher voice quality, voice cloning available, prompt edited in dashboard.
- **Option D: OpenAI Translate Bridge.** EXPERIMENTAL — `gpt-realtime-translate` is currently unreliable as of May 2026.

#### Option A: OpenAI Realtime API — English-only (system prompt in code, no dashboard needed)

> **Not the default anymore.** For new projects, use **Option C: OpenAI Multilingual**.

```js
const { KooKooVoiceBot, xml } = require('kookoo-voicebot');

const bot = new KooKooVoiceBot(
  {
    sipNumber: process.env.SIP_NUMBER,
    provider: 'openai',
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-realtime-2',         // released May 2026; supersedes gpt-4o-realtime-preview
      reasoningEffort: 'low',           // minimal | low | medium | high | xhigh — default low
      voice: 'nova',                    // alloy, echo, fable, onyx, nova, shimmer
      instructions: `<WRITE THE SYSTEM PROMPT HERE BASED ON USER'S USE CASE>`,
      tools: [
        // Add function calling tools if the agent needs to take actions
      ],
    },
  },
  {
    // Add hooks based on the use case...
  }
);

bot.start();
```

**Pricing (May 2026):** `gpt-realtime-2` is $32 / 1M audio-input tokens, $64 / 1M audio-output tokens. Default `reasoningEffort: 'low'` for receptionist flows; bump to `'high'` / `'xhigh'` only when complex reasoning is required.

##### Verified gpt-realtime-2 session.update payload (May 2026)

If you bypass the npm SDK and talk to OpenAI directly via WebSocket, this is the
exact session.update payload the API accepts. Each field below was confirmed
through live `invalid_request_error` responses — the schema is strict.

```json
{
  "type": "session.update",
  "session": {
    "type": "realtime",                                  // REQUIRED
    "model": "gpt-realtime-2",                            // optional, falls back to URL ?model=
    "instructions": "...",
    "output_modalities": ["audio"],                       // NOT "modalities" — that's the legacy field
    "audio": {
      "input": {
        "format": { "type": "audio/pcm", "rate": 24000 },
        "turn_detection": { "type": "semantic_vad" }      // turn_detection nests UNDER audio.input
      },
      "output": {
        "format": { "type": "audio/pcm", "rate": 24000 }, // rate is REQUIRED on output
        "voice": "alloy"
      }
    }
  }
}
```

Common rejections (each verified via API error):

| Mistake | API response |
|---------|--------------|
| `session.modalities: ["audio"]` | `Unknown parameter: 'session.modalities'` (renamed to `output_modalities`) |
| `session.turn_detection: { ... }` | `Unknown parameter: 'session.turn_detection'` (must nest under `audio.input`) |
| Omitting `session.type` | `Missing required parameter: 'session.type'` |
| Omitting `audio.output.format.rate` | `Missing required parameter: 'session.audio.output.format.rate'` |
| `session.reasoning_effort` at root | rejected — config on this is still in flux as of May 2026 |

#### Option B: ElevenLabs (agent configured in ElevenLabs dashboard)

```js
const { KooKooVoiceBot, xml } = require('kookoo-voicebot');

const bot = new KooKooVoiceBot(
  {
    sipNumber: process.env.SIP_NUMBER,
    provider: 'elevenlabs',
    elevenlabs: {
      agentId: process.env.ELEVENLABS_AGENT_ID,
      apiKey: process.env.ELEVENLABS_API_KEY,
    },
  },
  { /* hooks */ }
);

bot.start();
```

**OpenAI advantages:** System prompt lives in code (no separate dashboard), function calling built-in, gpt-realtime-2 reasoning (GPT-5-class), tunable `reasoningEffort`, faster to first working call.
**ElevenLabs advantages:** Better voice quality/cloning, agent configured via UI, no code changes for prompt updates, better for non-technical prompt owners.

**OpenAI voice options:** `alloy` (neutral), `echo` (male), `fable` (British), `onyx` (deep male), `nova` (female), `shimmer` (soft female).

#### Option C: OpenAI Multilingual (single gpt-realtime-2 session) — DEFAULT for new projects

When callers may speak any language and the AI should reply in **the caller's same language**. Uses `gpt-realtime-2` alone with audio-in / audio-out and an instruction to "detect the language from the first utterance and reply in that same language." `gpt-realtime` and `gpt-realtime-2` are both natively multilingual — no translation hop is needed.

```
Caller (lang X, 8 kHz)
   ↓ resample 8→24 kHz
gpt-realtime-2 (audio in / audio out, multilingual)
   ↓ resample 24→8 kHz
Caller hears reply in lang X
```

**Why this is the default for non-English calls:**
- **One** OpenAI session per call (vs three for the translate-bridge pattern).
- **~500–1000 ms** turn latency (vs ~1.5–2 s with translation hops).
- **No separate translation step.**
- Production-proven.

**System prompt template:**

```
You are a phone receptionist. Detect the language the caller is speaking from
their first utterance, then continue the entire conversation in THAT SAME
language. If they switch language mid-call, follow them. Default to English
if uncertain. Possibilities include English, Hindi, Telugu, Tamil, Kannada,
Malayalam, Marathi, Bengali, Gujarati, Spanish, French, Arabic.
Keep replies short (1-3 sentences). Speak naturally; no markdown or lists.
```

#### Option D: OpenAI Translate Bridge (multilingual receptionist, 70+ languages)

Three OpenAI sessions stitched per call:

```
Caller (lang X) → gpt-realtime-translate (→ English transcript)
                                                ↓
                                       gpt-realtime-2 (English in / English audio out)
                                                ↓
                                  gpt-realtime-translate (English audio → lang X audio) → Caller
```

**Translate-bridge advantages:** Caller hears their own language naturally; AI reasoning still benefits from gpt-realtime-2; works across 70+ source languages.
**Trade-offs:** ~3× the OpenAI cost per call (3 concurrent sessions), ~1.5–2s perceived first-turn latency, no built-in barge-in, no first-greeting in auto-detect mode.

**OpenAI tools format** (for function calling):
```js
tools: [
  {
    type: 'function',
    name: 'transfer_call',
    description: 'Transfer the caller to a department',
    parameters: {
      type: 'object',
      properties: {
        department: { type: 'string', enum: ['sales', 'support', 'billing'] },
      },
      required: ['department'],
    },
  },
]
```

### Available hooks

| Hook | When it fires | Return value |
|------|--------------|-------------|
| `onCallStart({ucid, did, metadata})` | Call connects | void |
| `onCallEnd({ucid})` | Call disconnects | void |
| `onTranscript({ucid, role, text, isFinal})` | User or agent speaks | void |
| `onToolCall({ucid, name, params, id})` | ElevenLabs tool invoked | result object |
| `onInterrupt({ucid})` | User barges in | void |
| `onPostStream({ucid, params})` | AI stream ends, call still active | KooKoo XML string |
| `getInitData({ucid, did})` | Before ElevenLabs connects | data object |
| `onError({ucid, error})` | Error occurs | void |
| `onCDR(data)` | KooKoo CDR callback | void |

### XML helpers for onPostStream

```js
const { xml } = require('kookoo-voicebot');
xml.playAndHangup('Goodbye!');              // play TTS then hang up
xml.playAndHangup('धन्यवाद!', 'hi-IN');     // Hindi TTS
xml.transfer('9001');                        // dial an extension
xml.ccTransfer('general', 'sales', 30);      // contact center queue transfer
xml.hangup();                                // just hang up
```

### 3. Create .env.example

**For OpenAI (default):**
```
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
SIP_NUMBER=524431
PORT=3000
```

**For ElevenLabs:**
```
ELEVENLABS_AGENT_ID=agent_xxxxxxxxxxxx
ELEVENLABS_API_KEY=sk_xxxxxxxxxxxx
SIP_NUMBER=524431
PORT=3000
```

**For OpenAI Translate Bridge (multilingual):**
```
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
CALLER_LANGUAGE=                # empty = auto-detect; or set ISO code: es, hi, te, ar, fr, ...
MODE=translate                  # only if you gate the bridge behind a mode flag in your app
SIP_NUMBER=524431
PORT=3000
```

### 4. Create deployment files

**Procfile:**
```
web: node index.js
```

**nixpacks.toml:**
```toml
[phases.setup]
nixPkgs = ["nodejs_20"]
[start]
cmd = "node index.js"
```

**.gitignore:**
```
node_modules/
.env
*.log
```

### 5. Set up the AI provider

#### If using OpenAI (default)

No dashboard needed. Write the system prompt directly in the `instructions` field in code.

**Voice options:** `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`.

**Model selection:** Default to `gpt-realtime-2` (May 2026). Use `reasoningEffort: 'low'` (default) for receptionists.

#### If using ElevenLabs

1. Go to **elevenlabs.io** > **Conversational AI** > **Create Agent**
2. Pick a voice (for Indian voice: choose an Indian-accented voice, or use voice cloning)
3. Paste the system prompt into **Agent > Prompt**
4. Set the **First message**
5. If tools are needed, add them under **Tools** tab
6. Copy the **Agent ID** from the URL bar (format: `agent_xxxxxxxxxxxx`)
7. **IMPORTANT:** The Agent ID is the long string in the URL, NOT the agent display name

#### For both providers

The `<playtext>` XML tags should use `lang="en-IN"` for Indian English or `lang="hi-IN"` for Hindi.

### 6. Deploy and get the application URL

1. **Push to GitHub**
2. **Deploy on Railway** — set the provider env vars plus `SIP_NUMBER`
3. **The application URL is:** `https://your-app.up.railway.app/kookoo`
4. **Paste this URL in KooKoo portal** — sign up at kookoo.in or ozonetel.com, get a number, set the IVR/Application URL

---

## KooKoo Platform Documentation (Source of Truth)

Use this documentation for ALL telephony decisions. Do NOT guess — use these exact formats.

### IVR XML Tags

All IVR responses MUST be wrapped in `<response>` tags:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<response>
    <!-- tags here -->
</response>
```

#### `<playtext>` — Text-to-speech

```xml
<playtext lang="en-IN" speed="3" quality="best" type="ggl">Hello, how can I help?</playtext>
```

| Attribute | Values | Default |
|-----------|--------|---------|
| `lang` | `en-IN`, `hi-IN`, `te-IN`, `ta-IN`, `ml-IN`, `kn-IN`, `mr-IN`, `gu-IN`, `bn-IN` | `en-IN` |
| `speed` | `1` (slow) to `5` (fast) | `3` |
| `quality` | `best`, `high`, `medium`, `low` | `best` |
| `type` | `ggl` (Google), `polly` (AWS Polly) | `ggl` |

#### `<dial>` — Dial another number

```xml
<dial transfer_allowed_by_caller="true" callback_onanswered="https://..." moh="default" record="true">9123456789</dial>
```

#### `<stream>` — Bidirectional WebSocket audio stream

```xml
<stream is_sip="true" url="wss://yourserver.com/ws" x-uui="{json_data}">SIP_NUMBER</stream>
```

| Attribute | Description |
|-----------|-------------|
| `is_sip` | Always `"true"` |
| `url` | Your WebSocket server URL (ws:// or wss://) |
| `x-uui` | **Custom JSON string** carrying the call's metadata into the WS handler |

Content inside the tag = **SIP registration number**.

##### x-uui is the ONLY channel to pass NewCall params into the WS handler

KooKoo's WebSocket `start` event natively contains ONLY:
`ucid`, `did`, `call_id`, `x_account`, `media`, plus whatever you put in `x-uui`.

It does NOT include `operator`, `circle`, `cid_e164`, `cid_countryname`, `cid_type`, `request_time`, etc. by default. **If your WS handler needs any of those, your IVR webhook MUST take all the NewCall query/body params and JSON-encode them into `x-uui` on the `<stream>` tag.** Otherwise that data is gone forever once the WS opens.

**Required pattern in the NewCall handler:**

```js
router.all('/', (req, res) => {
  const params = { ...req.query, ...req.body };
  if (params.event === 'NewCall') {
    // Serialise EVERY NewCall param into x-uui — escape single quotes
    // because we wrap the attribute value in single quotes.
    const uui = JSON.stringify(params).replace(/'/g, '&apos;');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<response>
    <start-record/>
    <stream is_sip="true" url="${wsUrl}/ws" x-uui='${uui}'>${sipNumber}</stream>
</response>`;
    res.set('Content-Type', 'text/xml');
    return res.send(xml);
  }
});
```

**Data flow end-to-end:**

```
Caller dials KooKoo number
  ↓
KooKoo IVR webhook  GET /kookoo?event=NewCall&sid=…&cid=…&operator=…&circle=…&…
  ↓ (your IVR handler reads req.query)
Returns <stream x-uui='{"event":"NewCall","sid":"…","cid":"…","operator":"…",…}'>
  ↓ (KooKoo bridges SIP, opens WebSocket)
WebSocket "start" event
  ├── ucid       (KooKoo-generated)
  ├── did        (your KooKoo number)
  ├── call_id    (caller's phone number, same as cid)
  └── x_headers  ← JSON STRING of whatever you put in x-uui
                   (KooKoo renames the attribute from "x-uui" to "x_headers"
                    and encodes it as a string, NOT a parsed object)
```

**Common mistakes that lose call data:**

- Hardcoding `x-uui="{}"` in the XML — the WS handler then sees nothing beyond `ucid`/`did`/`call_id`.
- Forgetting to escape `'` inside the JSON when the XML attribute is single-quoted (XML parsers will silently truncate).
- Treating `x_headers` as a parsed object — it's a JSON string, you MUST `JSON.parse` it.
- Reading `msg['x-uui']` on the WebSocket — KooKoo renamed it to `x_headers`.

#### `<collectdtmf>` — Collect keypad input

```xml
<collectdtmf l="1" t="5000">https://yourdomain.com/handle-input</collectdtmf>
```

> **VoKoo note.** This is the *between-streams* mechanism: KooKoo plays a prompt,
> collects `l` digits (or times out after `t` ms), and POSTs them back to the URL
> — which for us is the control plane, not the bridge. The flow can then branch
> on the digit and only *then* return `<stream>` for the chosen agent. That
> matters for language selection: each engine connects with its language already
> decided, and nothing has to reconnect mid-call. Contrast with the in-stream
> DTMF event below, which is the right answer for a PIN *during* a conversation.

#### `<cctransfer>` — Transfer to contact center queue

```xml
<cctransfer record="" moh="default" uui="sales" timeout="30" ringType="ring">general</cctransfer>
```

#### `<gotourl>` — Transfer to another IVR

```xml
<gotourl clean_params="false">https://other-ivr.com/handler</gotourl>
```

#### `<hangup/>` — End the call

#### `<start-record/>` — Start recording

### IVR Webhook: NewCall Event

KooKoo hits `/kookoo` with `event=NewCall` in TWO different scenarios. Your code must handle both:

**A) Real call** — includes rich caller data:

```
GET /kookoo?event=NewCall&sid=21275806501458167&cid=919704665032&called_number=918065740671&operator=Airtel&circle=ANDHRA+PRADESH&cid_type=MOBILE&cid_countryname=India&cid_country=91&cid_e164=%2B919704665032&request_time=2026-04-10+13%3A05%3A02
```

**B) "Test Application URL" ping (KooKoo portal probe)** — only `event` is set:

```
GET /kookoo?event=NewCall
```

→ Full body: `{"event":"NewCall"}` and that's it. **No `sid`, no `cid`, no `called_number`.**

This is the response when an admin clicks "Test" on the IVR URL setting — KooKoo verifies the URL responds with valid XML but never opens a SIP stream, never sends a `start` event, and your WebSocket handler will NOT run. **Do not treat a Test ping as a real call.**

```js
const isTestPing = !params.sid && !params.cid;
```

**Distinguishing tests from real calls in logs:**

| Symptom | Meaning |
|---------|---------|
| `event=NewCall sid= cid=` followed by no `[WS] New connection` line | Test Application URL ping. Real call did not happen. |
| `event=NewCall sid=2127... cid=919...` followed by `[WS] New connection` | Real call connected to your WebSocket. |
| Real call params logged but no following `[WS] New connection` | KooKoo couldn't open the WebSocket — check `wss://` URL is publicly reachable and the certificate is valid. |

| Parameter | Description | Example |
|-----------|-------------|---------|
| `event` | Always `NewCall` for inbound | `NewCall` |
| `sid` | Session/Call ID (same as UCID) | `21275806501458167` |
| `cid` | Caller's phone number | `919704665032` |
| `cid_e164` | Caller number in E.164 format | `+919704665032` |
| `called_number` | Your KooKoo phone number | `918065740671` |
| `operator` | Caller's telecom operator | `Airtel` |
| `circle` | Caller's telecom circle/region | `ANDHRA PRADESH` |
| `cid_type` | Call type | `MOBILE` or `LANDLINE` |
| `cid_countryname` | Caller's country | `India` |
| `cid_country` | Country code | `91` |
| `request_time` | Call arrival time | `2026-04-10 13:05:02` |

### Bidirectional Audio Streaming (WebSocket)

#### WebSocket Events (ACTUAL FORMAT — verified from live calls)

**Connection open (`start`):**

```json
{
  "event": "start",
  "type": "text",
  "ucid": "21275806501458167",
  "did": "918065740671",
  "call_id": "919704665032",
  "x_account": "serv_del",
  "x_headers": "{\"cid_countryname\":\"India\",\"operator\":\"Airtel\",\"sid\":\"21275806501458167\",\"cid\":\"919704665032\",...}",
  "media": {"encoding": "PCMU", "sampleRate": 8000, "channels": 1, "bitsPerSample": 16, "payloadType": 0}
}
```

| Field | What it is |
|-------|-----------|
| `ucid` | Unique Call ID |
| `did` | Called number (YOUR KooKoo number), NOT the caller |
| `call_id` | **CALLER's phone number** — use this to identify who is calling |
| `x_headers` | JSON STRING with ALL NewCall params (must be parsed) |
| `media` | Audio format metadata |

**Audio data (`media`):**
```json
{
  "event": "media",
  "type": "media",
  "ucid": "21275806501458167",
  "data": {
    "samples": [8, 8, 8, ...],
    "bitsPerSample": 16,
    "sampleRate": 8000,
    "channelCount": 1,
    "numberOfFrames": 80,
    "type": "data"
  }
}
```

**Keypad press (`media` + `type: "dtmf"`):**
```json
{"event": "media", "type": "dtmf", "ucid": "21275806501458167", "signal": "5"}
```

`signal` is `0`-`9`, `*` or `#`. Detected via RFC 2833/4733 or SIP INFO, and the
platform already de-duplicates the repeated end-packets, so each tone arrives
exactly once.

**This is NOT the same as `<collectdtmf>`.** That XML verb collects digits
between streams. This event arrives *on the WebSocket, during* the stream — it
is what you want for a PIN or account number mid-conversation, and it is the
correct answer to "the caller's digits keep being misheard", because 8 kHz
speech cannot reliably distinguish spoken digits.

Note the guard: match on `event === 'media' && msg.type === 'dtmf'`. Code that
checks only `event === 'media' && msg.type === 'media'` drops these silently.

> **VoKoo note.** `src/serializers/kookoo.rs` already implements exactly this,
> including the guard and the nesting, and has a test for it
> (`dtmf_nested_in_media_event_is_caught`). It becomes `InputDTMFFrame` carrying
> a `KeypadEntry` — and as of 1 September nothing in the pipeline consumes that
> frame. The plumbing is done; the consumer is not.

**Call end (`stop`):**
```json
{"event": "stop", "type": "text", "ucid": "xxxxx", "did": "xxxxx", "cause": 433}
```

`cause` is `433` on a normal caller hang-up and is absent on SIP failure or
rejection — the only way to tell "they hung up" from "the call failed".

#### Audio Format

| Property | Value |
|----------|-------|
| Encoding | PCM Linear |
| Bit Depth | 16-bit (int16) |
| Sample Rate | 8000 Hz |
| Channels | 1 (mono) |
| Frame Size | 80 samples per chunk (10ms) |

**CRITICAL:** The first packet after connection has `sampleRate: 16000` and `numberOfFrames: 160`. This packet MUST be ignored. All subsequent packets use 8000 Hz.

#### Sending Audio Back

Every outgoing media packet MUST include a `seqid`. Two constraints pull in
opposite directions, and both are real:

- **It must be unique per packet.** The media server keeps a dedup window of the
  last 3000 ids (~30 s at 100 packets/sec) and silently drops repeats. One id
  per utterance means every chunk after the first vanishes.
- **It should identify the utterance**, or the `mark` you get on barge-in names
  a 10 ms fragment and tells you nothing useful.

Both are satisfied by prefixing a unique counter with an utterance id:

```js
seqid = `${utteranceId}-${String(chunkIndex).padStart(5, '0')}`   // utt-7-00042
```

A mark then resolves to "the caller interrupted utterance 7 after 420 ms".

```json
{
  "event": "media",
  "type": "media",
  "ucid": "YOUR_UCID",
  "seqid": "utt-7-00042",
  "data": {
    "samples": [1, -3, 5, 2, ...],
    "bitsPerSample": 16,
    "sampleRate": 8000,
    "channelCount": 1,
    "numberOfFrames": 80,
    "type": "data"
  }
}
```

#### Mark Event (barge-in acknowledgment — NOT a playback receipt)

```json
{
  "event": "mark",
  "type": "ack",
  "ucid": "31761560059211253",
  "seqid": "utt-7-00042",
  "timestamp": 1761560089206
}
```

**A `mark` is sent ONLY in answer to your own `clearBuffer`.** It names the last
`seqid` that was playing when the buffer was dropped — i.e. how far the caller
heard before they interrupted you.

**It is NOT a per-packet playback acknowledgment.** Do not build a map of
outstanding packets waiting to be acknowledged: during normal speech no marks
arrive at all, so that map grows for the entire call and "unacknowledged
packets" becomes a number that means nothing. This mistake is easy to make and
costs hours — it looks like a memory leak and a broken platform at the same
time.

#### Commands

Clear audio buffer (for barge-in):
```json
{"command": "clearBuffer", "sessionId": "YOUR_UCID"}
```
`sessionId` and `extension` are optional and default to the session's own
values. Sending `clearBuffer` is what produces the `mark` described above.

Disconnect call:
```json
{"command": "callDisconnect", "causeCode": 200}
```

#### Limits that will bite you

| Limit | Value | What happens |
|-------|-------|--------------|
| Concurrent calls **per extension** | **3** | SIP 486 Busy — your WebSocket never opens, your code never sees the call |
| Queued bot audio per session | 60 s | further packets dropped **silently** |
| seqid dedup window | last 3000 ids | duplicate ids dropped silently |
| Your WebSocket errors or closes | — | the platform **terminates the SIP call** (cause 16) |

The first one ruins classroom demos: invite thirty people to dial and
twenty-seven get a busy tone. The last one means a crash in your code is not a
silent bot — it is a hung-up caller.

### IVR Callback Events

| Event | When | Call Status | Return XML? |
|-------|------|------------|------------|
| `NewCall` | Call answered | Starting | YES — return stream XML |
| `Stream` | Stream/WebSocket ended | **STILL ACTIVE** | YES — transfer, hangup, or more IVR |
| `Dial` | Dialed party (Leg B) disconnected | **STILL ACTIVE** with Leg A | YES |
| `Hangup` + `process=stream` | Caller hung up during stream | Ending | Return 200 OK |
| `Hangup` + `process=dial` | Caller hung up during dial | Ending | Return 200 OK |
| `Hangup` (no process) | Call completely ended | Ended | Return 200 OK |
| `Disconnect` | IVR sent hangup | Ending | Return 200 OK |

**Key insight:** After `event=Stream`, the call is STILL ACTIVE. You can return more XML to transfer, play messages, or hang up.

### Outbound API

```
GET http://in1-cpaas.ozonetel.com/outbound/outbound.php
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `api_key` | Yes | KooKoo API key |
| `phone_no` | Yes | Number to call |
| `url` or `extra_data` | Yes (either) | IVR URL or inline XML |
| `outbound_version` | Yes | Always `2` |
| `caller_id` | No | Caller ID to display |
| `callback_url` | No | URL for final CDR |

### IVR Transfer API

```
POST https://in-ccaas.ozonetel.com/api/v1/CallControl/IVRTransfer
```

Parameters: `ucid`, `did`, `appURL` (URL-encoded), `phoneno`, `api_key`, `cburl` (optional).

### Fetch Call Info API

```
GET https://in1-cpaas.ozonetel.com/restkookoo/index.php/api/Call_data/calldata/ucid/{ucid}/date/{YYYY-MM-DD}/format/json
```

---

## Multilingual Translate Bridge (advanced)

### Models used

| Role | Model | Purpose |
|------|-------|---------|
| Translate-IN | `gpt-realtime-translate` | Caller speech (lang X) → English transcript + auto-detected source language |
| Brain | `gpt-realtime-2` | Reasons in English; emits English audio reply |
| Translate-OUT | `gpt-realtime-translate` | English audio → caller's-language audio |

### Endpoints

```
wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate
wss://api.openai.com/v1/realtime?model=gpt-realtime-2
```

Required headers on every WS: `Authorization: Bearer <OPENAI_API_KEY>`, `OpenAI-Safety-Identifier: <your-app>-<ucid>`

### Audio format

- KooKoo sends/expects: PCM16 **8 kHz**, JSON `{samples:[...], sampleRate:8000}` array, 80 samples / 10 ms.
- OpenAI Realtime + Translate use: PCM16 **24 kHz** base64 inside `input_audio_buffer.append`.
- You MUST resample 8↔24 kHz on both legs.

### Session orchestration

1. On KooKoo `start`: open Translate-IN with `session.audio.output.language = 'en'`; open gpt-realtime-2 with English-only instructions. **Do NOT open Translate-OUT yet** — its target language is unknown.
2. Pipe caller media → 8→24 kHz upsample → Translate-IN `input_audio_buffer.append`.
3. On Translate-IN's `conversation.item.input_audio_transcription.completed`: read `language` → open Translate-OUT with that target. Buffer any gpt-realtime-2 audio that arrives before Translate-OUT is connected.
4. On Translate-IN's translated transcript: send the **English** text to gpt-realtime-2. **Critical**: forward the *translated* transcript, NOT the *source* one.
5. On gpt-realtime-2's audio delta: forward base64 24 kHz chunks to Translate-OUT.
6. On Translate-OUT's audio delta: 24→8 kHz downsample → 80-sample frames → KooKoo media packets (with `seqid`).

### Known trade-offs / pitfalls

- **No greeting first** in auto-detect mode. Set `CALLER_LANGUAGE` explicitly to allow an opening greeting.
- **Latency stacks**: ~1.5–2 s first turn, ~1 s subsequent.
- **Cost ~3×** stock OpenAI per call.
- **Barge-in is not free**: on Translate-IN `input_audio_buffer.speech_started` send `response.cancel` to gpt-realtime-2, drop pending Translate-OUT audio, and emit `{"command":"clearBuffer"}` to KooKoo.
- **Event-name variance**: OpenAI has shipped both `response.audio.delta` and `response.output_audio.delta`. Handle both.

---

## Cascaded mode: ear, brain and mouth as separate services

Speech-to-speech (one model hears, thinks and speaks) is the default and the
right first build. Split it into three only when you need something the single
model cannot give you — a specific voice or accent, a particular reasoning
model, or text at every boundary for logging and evaluation.

```
speech-to-speech   caller -> gpt-realtime-2 -> caller          one socket
cascade            caller -> EAR -> BRAIN -> MOUTH -> caller   three hops
```

Everything below the slots stays identical: the 10ms pump, the barge-in guard,
clearBuffer, mark handling, seqid tagging, retrieval. Only three interfaces
change. If swapping the AI design forces you to touch telephony code, the
seam is in the wrong place.

### What each slot actually costs — measured, not estimated

On a real round trip with a 3.3k-character system prompt and one tool call:

| Stage | Time |
|-------|------|
| Brain — `meta/llama-3.1-8b-instruct` via NVIDIA, incl. tool call | ~3,300 ms |
| Mouth — OpenAI `gpt-4o-mini-tts`, first audio byte | ~2,100 ms |
| **Before the caller hears anything** | **~5,500 ms** |

Against a target of 800 ms. Cascade is roughly 7x over budget before you tune
anything.

### Where a cascade's latency actually goes — measured

| Slot | Time | Whose cost |
|------|------|-----------|
| Ear round trip after commit | 1,364 ms | the provider's |
| Ear silence wait before commit | 800 ms | **yours** — EAR_SILENCE_MS |
| Brain (NVIDIA, llama-3.1-8b) | 4,765 ms | the provider's |
| Mouth first audio (Gemini, streamed) | 1,250 ms | the provider's |
| **Total before the caller hears a word** | **~8.2 s** | |

Two lessons in that table. **Measure every slot before optimising any of them** —
the ear was assumed slow for hours and turned out to be a third of the brain.
And **part of the ear is not the ear**: the silence wait is a number you chose,
and no provider swap will change it.

### The style prompt that cost 7 seconds a turn

The single largest latency win in this whole build was deleting text.

A ~50 word style direction ("warm, unhurried receptionist at a clinic in
Hyderabad, use the rhythm and vowels of Indian English…") was prepended to
**every** TTS utterance:

```
with the long style prompt     first audio in 8267ms
cut to seven words             first audio in 1073ms
```

Nearly 8x, on the greeting. Steering delivery is worth something; paying for it
on every single turn is not.

### Groq and NVIDIA are the same shape, different silicon

```
nvidia   https://integrate.api.nvidia.com/v1   NVIDIA_API_KEY   meta/llama-3.1-8b-instruct
groq     https://api.groq.com/openai/v1        GROQ_API_KEY     llama-3.3-70b-versatile
```

The instructive part is the model sizes: a 70b **exceeded a 30 s timeout** on
NVIDIA, so that path runs an 8b; on Groq a 70b is the ordinary choice, because
the hardware is built for time-to-first-token. Same weights, different silicon,
opposite conclusions about which model is "too big".

### Which variables each mode actually reads

```
MODE=multilingual   OPENAI_VOICE        ← the voice you hear
                    VAD_EAGERNESS       ← turn taking
                    TRANSCRIBE_MODEL    ← caller transcript, logs only
                    MOUTH_* , EAR_* , BRAIN_*      IGNORED

MODE=cascade        EAR_PROVIDER / EAR_MODEL / EAR_SILENCE_MS
                    BRAIN_PROVIDER / NVIDIA_MODEL / BRAIN_MAX_TOKENS
                    MOUTH_PROVIDER      ← picks which mouth
                      openai  -> MOUTH_VOICE, MOUTH_MODEL, MOUTH_INSTRUCTIONS
                      gemini  -> GEMINI_TTS_VOICE, GEMINI_TTS_MODEL, GEMINI_TTS_STYLE
                    OPENAI_VOICE        IGNORED
```

**Voice names do not transfer between providers.**

| Provider | Voices |
|----------|--------|
| OpenAI | alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar |
| Gemini | Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede, Callirrhoe, Autonoe, Enceladus, Iapetus, Umbriel, Algieba, Despina, Erinome, Algenib, Rasalgethi, Laomedeia, Achernar, Alnilam, Schedar, Gacrux, Pulcherrima, Achird, Zubenelgenubi, Vindemiatrix, Sadachbia, Sadaltager, Sulafat |

**The consequence worth stating to anyone choosing a mode:** there is no Indian
voice in speech-to-speech, because the OpenAI catalogue has no accents at all.
An Indian-English voice exists only in the cascade, via Gemini. That, not
latency alone, is the real trade between the two designs.

### Picking providers: what is actually available

- **NVIDIA** — good brain, not an ear or a mouth. On build.nvidia.com every speech model is tagged **Downloadable**: NIM containers for your own GPU, not hosted endpoints an API key can call. The LLMs *are* hosted and OpenAI-compatible at `https://integrate.api.nvidia.com/v1`, and `/v1/models` is public.
- **OpenAI** — good ear and workable mouth, but **no Indian voice exists**. `gpt-4o-mini-tts` accepts an `instructions` field that steers accent, tone and pace — an American voice asked to try, not an Indian voice.
- **Gemini** — the stronger mouth for Indian English. `gemini-2.5-flash-preview-tts` covers 24 locales *including English (India) and Hindi (India)*, 30 voices, and accent steering in natural language. Returns PCM 24kHz mono. Streaming needs a 3.1+ model.

### Ear: the endpoint and the turn boundary

```js
wss://api.openai.com/v1/realtime?intent=transcription   // NOT ?model=
headers: { Authorization: `Bearer ${key}` }             // NO OpenAI-Beta
session: { type: 'transcription',
           audio: { input: { format: {type:'audio/pcm', rate:24000},
                             transcription: { model: 'gpt-realtime-whisper' } } } }
```

**A transcription session does not segment turns for you.** You supply the
endpointing — energy gate plus a silence timer — and commit the buffer yourself.
`onFinal` is the turn boundary: no final, no reply, ever.

Two numbers that matter: OpenAI rejects `input_audio_buffer.commit` below ~100ms
of audio, and a silence threshold under ~600ms will close the turn on the pause
inside a sentence. At 400ms, a 17-second reply came back as the single word
"Yes."

### Mouth: format and barge-in

Ask for `response_format: 'pcm'` — raw 24kHz 16-bit signed little-endian, no
header. Two practical notes: a network chunk can split a 16-bit sample in half,
so carry the odd byte across chunks; and barge-in must abort the HTTP request,
not just stop queueing, or you keep paying for speech nobody will hear.

### The prompt lesson that only appears with a smaller model

A worked example in the system prompt is safe with a large model and dangerous
with a small one. `gpt-realtime-2` treated a sample answer as a pattern;
`llama-3.1-8b` reproduced it **verbatim**, quote marks included, and called the
tool twice without using either result.

Give the shape, never the words:

```
The SHAPE to follow — never the words. Do not reuse this text:
  [direct answer, with the real figure or date from the tool result]
  [one sentence raising the follow-up, tied to what was just asked]
  [one short question offering to act on it]

If your reply could have been written without calling the tool, you have not
answered the caller — you have recited a template.
```

### Retrieval that knows when it does not know

| Verdict | Condition | What the tool returns |
|---------|-----------|----------------------|
| confident | one clear winner | the answer, plus one follow-up action |
| ambiguous | two sections score alike | `needs_clarification` + the candidate topics |
| weak | nothing really matched | ask what about, offer what you can check |
| none | not on the record | say so, name the available topics |

Put the instruction in the tool result, not only in the system prompt — the
model reads its next step from the payload in front of it. And return no
follow-up offer on a miss: pitching after failing to answer reads as evasion.

---

## Debugging Reference

| Symptom | Cause | Fix |
|---------|-------|-----|
| `agent does not exist` | Wrong agent ID | Use the ID from the ElevenLabs URL: `agent_xxxx` |
| `Override not allowed` | Agent config locked | Don't send `conversation_config_override` with `prompt` or `first_message` |
| `MongoDB connection error` | Whitespace in URI | Single line, no line breaks |
| Blank audio / silence | Provider not connected | Check agent ID, API key, logs |
| Stream duration=1 | WebSocket URL wrong | SDK auto-detects from `RAILWAY_PUBLIC_DOMAIN` |
| Caller number shows as the KooKoo number | Using `did` instead of `call_id` | `did` = your KooKoo number. Use `call_id` or `cid` from `x_headers` |
| `x-uui` not found on WebSocket | KooKoo renames it | Parse `message.x_headers` (a JSON string) |
| `event=NewCall` with empty `sid`/`cid` | Portal "Test Application URL" ping | Gate side effects on `sid && cid` being present |
| Real call connects but no `[WS] New connection` | KooKoo can't reach your WebSocket | Verify `wss://`, public reachability, no WAF blocking the upgrade |
| Translate-bridge: caller hears wrong language | Forwarded the *source* transcript | Forward the **translated** (English) transcript |
| Translate-bridge: caller hears nothing | Translate-OUT never opened | Log raw Translate-IN events; set `CALLER_LANGUAGE` as fallback |
| Translate-bridge: chipmunk audio | Wrong sample rate (16 kHz not 24 kHz) | OpenAI Realtime + Translate use 24 kHz |
| Translate-out swallows audio silently | Target language same as source (`en→en`) | Route English audio direct to the caller; the translate model no-ops on same-language pairs |
| `Missing required parameter: 'session.type'` | New schema | Add `type: 'realtime'` inside `session` |
| `Missing required parameter: 'session.audio.output.format.rate'` | Output format needs explicit rate | Set `audio.output.format.rate: 24000` |
| `Unknown parameter: 'session.modalities'` | Field renamed | Use `output_modalities: ["audio"]` |
| `Unknown parameter: 'session.turn_detection'` | Field moved | Nest under `audio.input.turn_detection` |
| Logs say one mode but another handler runs | Older deploy still active | Force a redeploy, verify the `commit` field matches the pushed SHA |
| Bot cuts itself off mid-sentence, then answers again | Two things cancel the reply: your barge-in AND the model's own `interrupt_response` (default `true`), which fires on line noise | Set `interrupt_response: false` and own barge-in yourself. Two cancellers is one too many |
| Bot goes silent after the first exchange | The model's own interrupt landed **mid tool call**, leaving a `function_call` with no result | Same fix. Also post a `function_call_output` for any tool call that never completed |
| Bot answers a question the caller was still asking | Turn detection too eager | `semantic_vad` with `eagerness: 'medium'`. Do NOT use `'low'`: turns commit but the model never takes its own |
| `barge-in — dropped 0 queued chunks` | Cancelling replies the caller never heard | Only treat `speech_started` as barge-in when audio is genuinely going out |
| Bot confidently denies something on the record | A cancel truncated the tool arguments mid-stream, so the lookup ran with `{}` | Never execute a tool call whose arguments failed to parse |
| Clicking or crackle throughout the reply | Audio converted per-delta by a stateless function, zero-padding every delta's tail | Keep leftover samples between deltas; pad once, at the end |
| Gritty rasp, worst on "s" and "f" | Decimating 24k→8k with no low-pass first | Filter to ~3.4 kHz before decimating. A 3-tap average is not a resampler |
| Bot sounds slow and dragging | `setInterval(fn, 10)` fires at 11–16 ms under load | Pace against the wall clock, not one chunk per tick |
| Can't tell whether `speech_started` was the caller or an echo | Only logging the bot's half | Set `audio.input.transcription`. Expect occasional hallucinated phrases on silence |
| Bot answers in a language nobody spoke, and stays there | One wrong language guess on noisy 8 kHz audio, plus a prompt saying "continue in that language" | Default to one language and only switch on confidence. A first-utterance language lock turns one mis-hear into a broken call |
| Cascade brain times out with no error detail | A 70b can take tens of seconds to first token | Use a small fast model for a phone turn |
| Cascade ear returns one word for a long utterance | Silence threshold too short | Raise to ~800ms. Natural pauses inside a sentence run 300-600ms |
| Bot recites a suspiciously perfect answer, and calls the tool twice | A smaller model reproducing the worked example verbatim | Replace the example with a shape template containing no reusable words |
| Replies run 15-20 seconds | max_tokens set for chat, not speech. 300 tokens ≈ 18 seconds of audio | ~120 tokens for a phone turn, and say "one or two sentences" |
| Bot answers a question the caller did not ask | Retrieval returned its best guess with no confidence signal | Score the match; return `needs_clarification` when ambiguous. Asking twice beats guessing once |
| Every caller greeted as the same person | Demo-mode match-all still on | Gate it on an env var and log loudly at boot |
| Record lookup adds latency to every turn | Reading the database inside the tool call | Read the record once at call start, while the phone is still ringing — that time is free |
| Changing the voice variable has no effect | Each mode reads only its own variables | Check which MODE is live. Log a note when a voice variable is set but the active provider does not read it |
| Bot reads its own instructions aloud | A field meant as guidance is being treated as a script | Say so in the prompt. Assume every string you return can end up in the caller's ear |
| Cascade answers the phone and says nothing | Speech-to-speech greets because you ask the model to; a cascade has nothing to say until the caller speaks | Speak a templated greeting when the slots open — routing it through the LLM adds seconds of dead air |
| TTS takes longer than the audio it produces | The model does not stream | Use a streaming-capable TTS and emit each chunk as it lands |
| A bad env var kills the whole server, not one call | An async handler threw; Node exits on an unhandled rejection | Catch around anything called from an async message handler. A misconfiguration should degrade one caller's experience, never the service |
| TTS is slow, and the provider is not to blame | A long style prompt prepended to every utterance | ~50 words of style took first audio from 1073ms to 8267ms |
| Bot refers to the caller in the third person | The record is written *about* the patient | Say in the prompt: you are speaking TO this person. Record text is source material, not phrasing |
| One slot blamed for latency without evidence | Only some slots instrumented | Log a number for every hop before optimising any of them |

---

## How users get started with KooKoo

1. **Sign up** at **ozonetel.com** or **kookoo.in**
2. **Get a phone number** (Indian virtual number)
3. Find the **IVR/Application URL** setting for that number
4. Paste your deployed app URL
5. **Call the number**
