# Defects

Found by driving the running app, not by reading it. Each entry says how it was
observed, so anyone can reproduce it rather than take it on trust — and so a fix
can be checked rather than assumed.

An entry stays here until the check under **Verify** passes.

---

## D1 — The sign-in dialog has no accessible name

**Status:** open
**Found:** 6 September 2026, driving `localhost:3000` in Chrome
**Severity:** accessibility. A screen reader announces an unnamed dialog on the
one screen every user meets first.

React Aria says so itself, three times on every load:

```
A dialog must have a title for accessibility. Either provide an aria-label or
aria-labelledby prop, or render a heading element inside the dialog.

If a Dialog does not contain a <Heading slot="title">, it must have an
aria-label or aria-labelledby attribute for accessibility.
```

The accessibility tree confirms it — the dialog node carries no name:

```
dialog [ref_1]
 heading "Sign in"
 form
  label "Email"
  textbox "you@example.com"
  button "Continue"
```

**Cause.** `standard-dialog.tsx` renders React Aria's `<Dialog>`, and its `title`
prop is optional. `auth-2.tsx` passes no `title`; the sign-in screen renders its
own `<h1>Sign in</h1>` inside `children`. A plain `<h1>` is not a
`<Heading slot="title">`, so React Aria never wires `aria-labelledby`.

The heading is right there on screen. Only the association is missing.

**Fix.** Either give `StandardDialog` an `aria-label` fallback when no `title`
is passed, or have it render its title as `<Heading slot="title">` and have the
sign-in pass one. The second is better: every dialog built on this component
then gets a name by construction rather than by each caller remembering.

**Verify.** Load any page while signed out, read the console. No React Aria
dialog warning, and the accessibility tree shows `dialog "Sign in"`.

---

## D2 — The console sends its bearer token to production over plaintext HTTP

**Status:** open
**Found:** 6 September 2026, while establishing what a local test run touches
**Severity:** the access token is readable in transit; local testing writes to
the live database.

```
.env.local     NEXT_PUBLIC_CONTROLPLANE_API_URL = http://212.38.94.176:8081
api-client.ts  headers.set("authorization", `Bearer ${context.accessToken}`)

curl http://212.38.94.176:8081/health   -> 200
curl https://212.38.94.176:8081/health  -> 000   (no TLS listener)
```

Two problems in one line of configuration.

**The token crosses the network in the clear.** A Supabase access token, sent
on every request, over unencrypted HTTP to a bare IP. Anything between the
laptop and that host can read it — a café network, a corporate proxy, any
intermediate hop. This repo already made the equivalent argument when it
refused to put the token in a query string: *"it is written into every proxy log
between the browser and the server and stays there."* An unencrypted header is
the same exposure with fewer witnesses.

**"Running locally" is the UI only.** The API and the database are production.
Every create, update and delete performed while testing locally mutates live
data. There is no local control plane to point at — `localhost:8081` does not
answer.

That is why the 6 September test run was read-only, and it is a constraint on
every future one until this changes.

**Fix.** Terminate TLS in front of the control plane, the way the console and
the apex already are, and point `NEXT_PUBLIC_CONTROLPLANE_API_URL` at the
hostname rather than the IP. Separately, a local or staging control plane would
remove the second half — testing against production is a different problem from
testing over plaintext, and closing one does not close the other.

**Verify.** `curl https://<control plane host>/health` returns 200, `.env.local`
names it, and the console works unchanged.

---

## Checked and not defects

Recorded so nobody spends time rediscovering them.

**The mark's canvas renders blank in a screenshot.** Chrome runs no
`requestAnimationFrame` in a backgrounded tab, so the WebGL canvas draws
nothing; it appears the instant the tab takes focus. The asset returns 200 and
three.js mounts — its own `THREE.Clock` deprecation warning is the proof. This
has now caused a wrong diagnosis twice in this project, once reported as a
performance crisis that did not exist. **A screenshot of a background tab is not
evidence about anything animated.**

**Escape does not dismiss the sign-in dialog.** Correct, not a bug: there is
nowhere to be dismissed to until somebody signs in.

**All thirteen console routes return 200** — `/`, `/dashboard`, `/patients`,
`/cohorts`, `/enrolments`, `/agents`, `/tools`, `/schemas`, `/calls`, `/runs`,
`/flows`, `/phone-numbers`, `/team`.

## Not yet tested

Everything behind authentication. The 6 September run could reach the sign-in
screen and nothing past it.

`resize_window` reported success but the viewport stayed 1920x848, so the
responsive layouts are **untested rather than passing** — including whether the
sign-in dialog's left half hides correctly below `sm`.
