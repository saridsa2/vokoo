# WhatsApp calling — what is set up, and what is not

Sarvathra answers WhatsApp Business calls with the same AI agent that answers
PSTN. WhatsApp terminates on **our own Asterisk**, on the same VPS as the
bridge, and hands the call to the bridge over AudioSocket on loopback.

    WhatsApp ──TLS/SIP──► Asterisk (this VPS) ──AudioSocket──► vokoo_bridge ──► agent
                                                     127.0.0.1, no network

Asterisk is on **this** box, not the helix one, so nothing crosses a network:
AudioSocket carries unencrypted PCM and putting it on the public internet, or
even a tailnet, is a hop that does not need to exist.

## What Meta requires, from their own documentation

| | |
|---|---|
| Transport | TLS, port **5061**. Meta sends the INVITE **to us**; we never register |
| Certificate | subject must cover the SIP hostname; **no mTLS** — Meta presents no client certificate, so `verify_client` must stay off |
| Auth | digest (407 challenge) for business-initiated calls; username is the business number |
| Audio | **Opus at 48 kHz**, DTLS-SRTP by default, SDES available per number |
| Config | `POST /<PHONE_NUMBER_ID>/settings` |
| Source IPs | the same list as Cloud API webhooks |

**Opus at 48 kHz is the expensive part, and it is worth saying why.** The helix
path was cheap because KooKoo hands over 8 kHz PCM and AudioSocket wants 8 kHz
PCM — a re-frame, no codec. WhatsApp hands over Opus, so Asterisk transcodes
every call, on a 2-CPU box that also runs Postgres and the bridge. Decode
(inbound) is cheap; encode (outbound) is not. This is the first thing to measure
under load.

## Standing, 2 September

Done and verified:

- **Asterisk 22.5.2** from Ubuntu 26.04's own package. It carries
  `codec_opus_open_source`, `res_srtp`, `chan_audiosocket`, `chan_pjsip`,
  `res_ari`/`res_stasis` — everything, with no source build and no Digium blob.
- **IAX2 disabled.** It bound `0.0.0.0:4569` on install for no reason here;
  `noload` in `modules.conf`, verified closed across a restart.
- **`sip.sarvathra.ai` → 212.38.94.176**, an A record on Hostinger.
- **A Let's Encrypt certificate**, issued by the Caddy that already owns 80/443
  and ACME. `/usr/local/sbin/sarvathra-sip-cert` copies it into
  `/etc/asterisk/keys` and reloads TLS only when it changes, on a daily timer —
  Caddy renews every 60 days and Asterisk reads its certificate once at load,
  so without that it serves an expired certificate two months after everything
  looked fine.
- **TLS transport on 5061**, verified from the public internet with Meta's own
  suggested check: `openssl s_client -verify_hostname sip.sarvathra.ai` returns
  **`Verify return code: 0 (ok)`**.
- **The AudioSocket frame codec** in the bridge, 8 tests, taken from helix's
  working implementation rather than from memory.
- **The whole bridge side, proven on a local call.** `[whatsapp] call to
  918040802529 … flow: Vayuveda main line … relay — engine 'Hindi relay
  (Sarvam)'`, then `VAD server: → Speaking (confidence=1.000)` held for 71
  seconds off audio that arrived over AudioSocket. 83-second call, closed
  cleanly. See below for what it took.

The number this is for:

| | |
|---|---|
| number | **+91 63092 48884** (Patient Outreach) |
| phone number id | `1016241471582252` |
| WABA id | `1487866373019161` |
| app | PRM App, `26412203378439563` |

**It is a live number**, one of four on that app alongside three others for a
real healthcare business. Which is why the order below matters.

## How a WhatsApp call reaches an agent

```
Meta  ──TLS 5061──▶  Asterisk [whatsapp]  ──▶  from-whatsapp
                                                 │
                          POST /asterisk/incoming │  uuid, to, from, wacid
                                                 ▼
                                          PendingCalls (the bridge)
                                                 │
                      AudioSocket 127.0.0.1:9092 │  first frame is the uuid
                                                 ▼
                                    the same pipeline a KooKoo call gets
```

**The announcement exists because AudioSocket carries a uuid and nothing else** —
no called number, no caller. So the dialplan says who is calling over HTTP a
line before it connects the socket, and the uuid ties the two together. It is
gated on the same `x-vokoo-internal` token pre-flight uses, set from
`/etc/asterisk/vokoo-secrets.conf` so the dialplan itself can live in the
repository.

| | |
|---|---|
| the codec | `bridge/src/serializers/audiosocket.rs` — frames, and 8 kHz ↔ 16 kHz |
| the wire | `bridge/src/transport/audiosocket/` — the socket, and the clock |
| the registry | `bridge/src/vokoo/asterisk.rs` — uuid → who is calling |
| the dialplan | `bridge/asterisk/extensions.conf` |

`handle_call` takes an `Incoming` now — a KooKoo WebSocket or an Asterisk
TCP stream — and produces an `Arrival` (id, did, caller, channel) that the rest
of the call path reads. Everything after the handshake is one implementation:
the same flow resolution, the same call record, the same engine, the same
billing. A `CallWire` enum carries the three calls that genuinely differ —
`input()`, `output()`, `run()`.

### AudioSocket is a clocked stream, and getting that wrong ends every call

The first version wrote a frame when the pipeline produced one, mirroring the
WebSocket transport. Every test call ended after two seconds with

    app_audiosocket.c: Reached timeout after 2000 ms of no activity

`app_audiosocket` waits on the socket and hangs up if we go quiet — so the
silence between a caller's question and the agent's answer has to be *sent*, not
merely allowed. A 20 ms `tokio::time::interval` now writes one frame every tick,
from a queue if there is speech and 320 zero bytes if there is not. That is the
whole fix, and the test `silence_goes_out_on_the_clock_while_nobody_is_speaking`
is what stops it coming back.

Two smaller things fell out of the same shape:

- **The queue is kept shallow and catches up rather than dropping.** The
  pipeline paces at 20 ms and so does the clock; two nominally equal clocks
  drift. Past 25 frames a tick writes two. Dropping the oldest frame instead
  would cut a word in half.
- **Barge-in is the queue and nothing more.** There is no "stop playing" frame
  on this protocol, so what Asterisk already holds will be heard. Which is the
  argument for the queue being shallow in the first place.

## Testing it without WhatsApp

`[sarvathra-test]` gotos into `from-whatsapp`, so a call placed by Asterisk
itself walks the identical dialplan:

```bash
# The plumbing: announce, uuid, flow, agent.
asterisk -rx "channel originate Local/918040802529@sarvathra-test/n application Wait 20"

# With audio, which is what proves the socket rather than the handshake.
asterisk -rx "channel originate Local/918040802529@sarvathra-test/n application Playback demo-instruct"
```

`Wait` generates no audio, so the Primer correctly reports `no caller audio for
10.0s`. `Playback` is the one to use when the question is whether audio moves.

## What is left, in the order it must happen

1. ~~A PJSIP endpoint for Meta~~ — done, WebRTC-shaped: ICE, DTLS-SRTP, Opus.
2. ~~A dialplan~~ — done.
3. ~~An AudioSocket transport in the bridge~~ — done, and flow resolution keyed
   on the called number exactly as a DID is.
4. ~~Prove it with a local call~~ — done, twice: handshake and audio.
5. **Only then** `POST /1016241471582252/settings` to point Meta at us. **Still
   the next step, and still last.**

**Five is last for a reason.** That number is live: pointing it at an Asterisk
that cannot yet answer would fail every WhatsApp call to a working healthcare
line. Nothing about this is reversible from the caller's side — they just hear
it not work.

## Not verified

- **Whether Meta's terms permit bridging a WhatsApp call to PSTN.** The
  "patch me through to a person" half of this depends on it, and it is a policy
  question, not a technical one.
- **Whether calling is enabled on that number at all.** It is a per-number
  toggle in WhatsApp Manager, separate from messaging.
- **Anything Meta actually sends.** Every test so far has been a Local channel
  originated by Asterisk. Nothing has verified the identify rule matching a real
  `From: <sip:…@wa.meta.vc>`, the DTLS-SRTP handshake, Opus transcoding to
  8 kHz, or that `${EXTEN}` on a real INVITE is the business number in the shape
  `graph::spellings` resolves.
- **The caller's number.** `${CALLERID(num)}` was empty on every test call
  because a Local channel has none. On a real INVITE it is Meta's `From`, and it
  is what a post-call flow puts in a CRM — so it is worth reading out of the
  first real call's log rather than assuming.

## Two gaps, named rather than left to be discovered

- **A keypad menu cannot be asked on a WhatsApp call.** `Vayuveda main line`
  opens with `Choose a language`, and every test call logged *"flow reached menu
  … with the stream already open"* and took the no-keypress branch. On KooKoo a
  menu is asked between streams with `<collectdtmf>`; on this path the socket is
  open from the first line of the dialplan and there is no equivalent. A
  WhatsApp number wanting a menu needs one asked in the dialplan before
  `AudioSocket()`, which is a `Read()` and a branch — not built.
- **`kookoo.*` control nodes will fail on a WhatsApp call.** Transfer, hold and
  disconnect go to KooKoo's REST API with a ucid KooKoo has never heard of, so
  they take the node's `failed` branch. Patching a WhatsApp caller to a real
  number is Asterisk's `Dial()`, which is a different mechanism and is the next
  piece of work after Meta is pointed here.
