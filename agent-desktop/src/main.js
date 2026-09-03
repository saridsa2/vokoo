import { Web } from "sip.js";

/**
 * A spike. The credentials are hard-wired because the question this answers is
 * "can a person on a Mac take a call the AI escalated", not "how should agents
 * authenticate". Real agents will get their SIP credentials from the console
 * after signing in; this file is the throwaway that proves the leg swap works.
 */
const CONFIG = {
  // Through Caddy on 443, not Asterisk's own TLS port. Asterisk's HTTP server
  // carries the SIP WebSocket *and* ARI on one port, and ARI can originate
  // calls and hang people up — so only /ws is published and 8088 stays on
  // loopback.
  server: "wss://sip.sarvathra.ai/ws",
  aor: "sip:sarvathra-4001@sip.sarvathra.ai",
  user: "sarvathra-4001",
  pass: "16zpbjnxo6XCLAN8PxkzK9",
};

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

$("connect").onclick = async () => {
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
        status("on duty", "up");
        say("call ended");
      },
      onRegistered: () => {
        status("on duty", "up");
        say("registered — escalations will ring here");
      },
      onUnregistered: () => status("off duty", "down"),
      onServerDisconnect: (error) => {
        status("disconnected", "down");
        say(`server disconnected${error ? `: ${error.message}` : ""}`);
        $("connect").disabled = false;
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
