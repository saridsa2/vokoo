import { Web } from "sip.js";

/**
 * A spike: the question it answers is "can a person on a Mac take a call the AI
 * escalated", not "how should agents authenticate". Real agents will get their
 * SIP credentials from the console after signing in.
 *
 * **The credentials come from `.env.local`, which is gitignored.** They were
 * hard-wired here at first and committed, which puts a working SIP password in
 * the history of a repository with a remote — a spike's convenience is not
 * worth a credential in git, and a password that has been committed is burned
 * whether or not anyone fetched it.
 */
const CONFIG = {
  // Through Caddy on 443, not Asterisk's own TLS port. Asterisk's HTTP server
  // carries the SIP WebSocket *and* ARI on one port, and ARI can originate
  // calls and hang people up — so only /ws is published and 8088 stays on
  // loopback.
  server: import.meta.env.VITE_SIP_SERVER ?? "wss://sip.sarvathra.ai/ws",
  user: import.meta.env.VITE_SIP_USER ?? "sarvathra-4001",
  pass: import.meta.env.VITE_SIP_PASS ?? "",
};
CONFIG.aor = `sip:${CONFIG.user}@${new URL(CONFIG.server).host}`;

const $ = (id) => document.getElementById(id);
const say = (message) => {
  $("log").textContent += `${new Date().toLocaleTimeString()}  ${message}\n`;
  $("log").scrollTop = $("log").scrollHeight;
};
const status = (text, cls) => {
  $("state").textContent = text;
  $("state").className = cls;
};

$("ext").textContent = CONFIG.user;
$("host").textContent = new URL(CONFIG.server).host;

let agent;
// Whether this person is taking calls. Registration is the switch: Asterisk
// only rings an endpoint that has a contact, so going off duty is
// unregistering — not a flag we keep and hope the server agrees with.
let onDuty = false;

async function goOffDuty() {
  $("connect").disabled = true;
  try {
    // The WebSocket is left open. Unregistering is what stops calls arriving,
    // and keeping the connection makes coming back a round trip rather than a
    // handshake — the difference between stepping away and logging out.
    await agent.unregister();
    onDuty = false;
    $("connect").textContent = "Go on duty";
    status("off duty", "down");
    say("off duty — escalations will not ring here");
  } catch (error) {
    say(`could not go off duty: ${error?.message ?? error}`);
  } finally {
    $("connect").disabled = false;
  }
}

$("connect").onclick = async () => {
  if (onDuty) {
    await goOffDuty();
    return;
  }
  // Already connected from an earlier shift: register again rather than
  // building a second user agent, which would leave the first one holding a
  // socket Asterisk still believes in.
  if (agent) {
    $("connect").disabled = true;
    try {
      await agent.register();
    } catch (error) {
      say(`could not go on duty: ${error?.message ?? error}`);
      $("connect").disabled = false;
    }
    return;
  }

  if (!CONFIG.pass) {
    say("no VITE_SIP_PASS — copy .env.example to .env.local and set it");
    status("not configured", "down");
    return;
  }
  $("connect").disabled = true;
  status("connecting", "down");

  try {
    // Asked for before registering, deliberately. macOS shows its permission
    // prompt on the first getUserMedia, and discovering the microphone is
    // blocked *while a caller is waiting* is the worst possible moment — the
    // agent answers to silence and the caller hears nothing.
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
    say("microphone available");

    agent = new Web.SimpleUser(CONFIG.server, {
      aor: CONFIG.aor,
      // The remote stream must land on a real element. Without one the call
      // connects, the browser holds the audio, and nobody hears anything —
      // with no error raised anywhere.
      media: { remote: { audio: $("remote") } },
      userAgentOptions: {
        authorizationUsername: CONFIG.user,
        authorizationPassword: CONFIG.pass,
        displayName: "Sarvathra agent",
        logLevel: "warn",
      },
    });

    agent.delegate = {
      // Never auto-answered. A call that picks itself up is a live microphone
      // in somebody's room, and an agent who has not said "yes" has not
      // consented to being on a call.
      onCallReceived: () => {
        $("call").hidden = false;
        status("ringing", "busy");
        say("incoming call");
      },
      onCallAnswered: () => {
        status("on a call", "busy");
        say("answered — the caller is with you");
      },
      onCallHangup: () => {
        $("call").hidden = true;
        status(onDuty ? "on duty" : "off duty", onDuty ? "up" : "down");
        say("call ended");
      },
      onRegistered: () => {
        onDuty = true;
        $("connect").textContent = "Go off duty";
        $("connect").disabled = false;
        status("on duty", "up");
        say("on duty — escalations will ring here");
      },
      onUnregistered: () => {
        onDuty = false;
        $("connect").textContent = "Go on duty";
        $("connect").disabled = false;
        status("off duty", "down");
      },
      onServerDisconnect: (error) => {
        // The registration is gone with the socket, whatever this app thinks.
        // Saying "on duty" while Asterisk has no contact for you is the one
        // lie that matters here: a caller would be told a person is coming.
        onDuty = false;
        agent = undefined;
        $("connect").textContent = "Go on duty";
        $("connect").disabled = false;
        status("disconnected", "down");
        say(`server disconnected${error ? `: ${error.message}` : ""}`);
      },
    };

    say(`connecting to ${CONFIG.server}`);
    await agent.connect();
    say("websocket open");
    await agent.register();
  } catch (error) {
    status("failed", "down");
    say(`FAILED: ${error?.message ?? error}`);
    $("connect").disabled = false;
  }
};

$("answer").onclick = async () => {
  try {
    await agent.answer();
  } catch (error) {
    say(`could not answer: ${error?.message ?? error}`);
  }
};

$("hangup").onclick = async () => {
  try {
    await agent.hangup();
  } catch (error) {
    say(`could not hang up: ${error?.message ?? error}`);
  }
};
