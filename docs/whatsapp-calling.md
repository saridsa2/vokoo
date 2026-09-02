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

The number this is for:

| | |
|---|---|
| number | **+91 63092 48884** (Patient Outreach) |
| phone number id | `1016241471582252` |
| WABA id | `1487866373019161` |
| app | PRM App, `26412203378439563` |

**It is a live number**, one of four on that app alongside three others for a
real healthcare business. Which is why the order below matters.

## What is left, in the order it must happen

1. **A PJSIP endpoint for Meta** — identify by their published IP ranges, digest
   auth, Opus, SRTP.
2. **A dialplan** — `from-whatsapp` into AudioSocket on `127.0.0.1`.
3. **An AudioSocket transport in the bridge**, and flow resolution keyed on the
   WhatsApp number the way `resolve_for_event` keys on a DID.
4. **Prove it with a local call** — originate into the dialplan from Asterisk
   itself, no WhatsApp involved, and hear the agent answer.
5. **Only then** `POST /1016241471582252/settings` to point Meta at us.

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
