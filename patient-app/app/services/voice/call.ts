/**
 * A call with the agent, and the seam the real transport will slot into.
 *
 * **The decision this file encodes.** Audio travels in the app over WebRTC to
 * `vokoo_bridge`, not out through the carrier to the patient's dialler. That is
 * a real build on both ends and none of it is done yet:
 *
 * - the bridge has `src/transport/vaniwebrtc/` — signalling, Opus, its own
 *   `vaniwebrtc_server` binary — but the feature is **opt-in and absent from the
 *   default list**, so it is not in the binary answering the phone today;
 * - the app needs `react-native-webrtc`, which is a config plugin and a native
 *   rebuild.
 *
 * So this is the surface, with a mock behind it. The interface below is shaped
 * to what the real transport actually needs, taken from `signaling.rs` rather
 * than imagined: SDP offer/answer plus trickled ICE over one WebSocket, in the
 * browser's own `RTCSessionDescription` / `RTCIceCandidate` JSON shape —
 *
 *     { type: "offer",  sdp }              client → server
 *     { type: "answer", sdp }              server → client
 *     { type: "ice",    candidate, sdpMid, sdpMLineIndex }
 *     { type: "bye" }
 *
 * — which means the swap is this one file plus a native dependency, and no
 * screen changes. That is the whole reason the screen talks to an interface it
 * cannot see the inside of.
 */

/**
 * Where a call is.
 *
 * `escalating` is its own state rather than a flag on `connected`, because the
 * screen has to say something different while a person is being fetched and the
 * agent has gone quiet. A caller left looking at an unchanged screen assumes the
 * call has dropped — which is the failure the escalation exists to prevent.
 */
export type CallState =
  "idle" | "connecting" | "connected" | "escalating" | "with-human" | "ended" | "failed"

/** One turn, as it is spoken. */
export type Utterance = {
  id: string
  from: "you" | "agent" | "human"
  /** Named, because a patient must always be able to tell a person from software. */
  speaker: string
  text: string
  /** Still being spoken — rendered lighter and not yet part of the record. */
  partial?: boolean
}

export type CallSnapshot = {
  state: CallState
  /** Seconds since the call connected. Zero until it does. */
  seconds: number
  transcript: Utterance[]
  muted: boolean
  /** Set when `state` is `failed`, in words a patient can act on. */
  error?: string
  /** Who is on the other end right now. */
  speaking: string
}

export interface VoiceCall {
  /** Opens the socket, negotiates, and starts sending audio. */
  start(): void
  /** Ends the call and releases the microphone. Safe to call twice. */
  hangUp(): void
  setMuted(muted: boolean): void
  /**
   * Asks for a person. The bridge already does this on the phone path — the
   * agent stays on the call muted, taking notes, which is why the transcript
   * does not restart when the human arrives.
   */
  requestHuman(): void
  /** Called on every change. The screen re-renders from the snapshot. */
  subscribe(listener: (snapshot: CallSnapshot) => void): () => void
}

/**
 * A scripted stand-in.
 *
 * It plays a real care-path conversation — the six-week bloods, the one open
 * request on the Today screen — so the screen can be judged on what a call
 * actually looks like rather than on lorem. It reaches no network and asks for
 * no microphone permission.
 *
 * **The timings are deliberate, not arbitrary.** A turn arriving instantly is
 * the tell that makes a mocked conversation feel fake, and it also hides the
 * one thing this screen has to get right: what the patient looks at during the
 * seconds when nobody is speaking.
 */
export function createMockCall(): VoiceCall {
  let snapshot: CallSnapshot = {
    state: "idle",
    seconds: 0,
    transcript: [],
    muted: false,
    speaking: "Sarv",
  }

  const listeners = new Set<(s: CallSnapshot) => void>()
  const timers: ReturnType<typeof setTimeout>[] = []
  let ticker: ReturnType<typeof setInterval> | undefined

  const emit = (patch: Partial<CallSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
    listeners.forEach((l) => l(snapshot))
  }

  const say = (at: number, u: Omit<Utterance, "id">) =>
    timers.push(
      setTimeout(() => {
        emit({
          transcript: [...snapshot.transcript, { ...u, id: `u-${snapshot.transcript.length}` }],
        })
      }, at),
    )

  const stop = () => {
    timers.forEach(clearTimeout)
    timers.length = 0
    if (ticker) clearInterval(ticker)
    ticker = undefined
  }

  return {
    start() {
      emit({ state: "connecting", transcript: [], seconds: 0 })

      timers.push(
        setTimeout(() => {
          emit({ state: "connected" })
          ticker = setInterval(() => emit({ seconds: snapshot.seconds + 1 }), 1000)
        }, 1400),
      )

      say(2200, {
        from: "agent",
        speaker: "Sarv",
        text: "Namaste Sunita. I am calling from the transplant unit about your six-week bloods.",
      })
      say(6000, {
        from: "agent",
        speaker: "Sarv",
        text: "Have you been able to get to a lab yet?",
      })
      say(9000, { from: "you", speaker: "You", text: "Not yet, I was going to go on Friday." })
      say(11500, {
        from: "agent",
        speaker: "Sarv",
        text: "Friday is fine — that is still inside the window. Remember it has to be before your morning dose, not after.",
      })
      say(17000, {
        from: "agent",
        speaker: "Sarv",
        text: "Send a photo of the report through the app when you have it and Dr Rao will see it the same day.",
      })
    },

    hangUp() {
      stop()
      emit({ state: "ended" })
    },

    setMuted(muted) {
      emit({ muted })
    },

    requestHuman() {
      emit({ state: "escalating", speaking: "Finding someone" })
      timers.push(
        setTimeout(() => {
          emit({ state: "with-human", speaking: "Sister Lakshmi" })
        }, 2600),
      )
      say(3200, {
        from: "human",
        speaker: "Sister Lakshmi",
        text: "Hello Sunita, it's Lakshmi. What can I help with?",
      })
    },

    subscribe(listener) {
      listeners.add(listener)
      listener(snapshot)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) stop()
      }
    },
  }
}
