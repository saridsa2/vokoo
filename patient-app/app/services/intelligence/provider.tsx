import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type FC,
  type PropsWithChildren,
} from "react"
import { QWEN3_1_7B_QUANTIZED, useLLM } from "react-native-executorch"

import { load, save } from "@/utils/storage"

import { cardFor, systemPrompt, TOOLS, type Card } from "./chat"
import { useIntelligence } from "./index"

/**
 * One model, for the whole app.
 *
 * ## Why this is a provider and not a hook
 *
 * It was a hook, and every screen that called it got **its own** `useLLM`
 * session. The setup screen loaded the weights; the chat screen then mounted,
 * created a second session, and sat there with `isReady` false — so Sarv
 * answered "I cannot answer on this phone yet" to a patient who had just
 * watched the thing finish setting up.
 *
 * A gigabyte of weights is not something to hold two of. Mounted once, above
 * the navigator, so setup and chat and anything after them are looking at the
 * same session.
 *
 * ## The two locks are still two locks
 *
 * `capability.ts` answers *can this phone*. The stored flag answers *did anyone
 * agree to the download*. Either saying no keeps `preventLoad` true and nothing
 * is fetched.
 */
export const INTELLIGENCE_ENABLED_KEY = "intelligence.enabled"

export type ModelState =
  /** The gate has not answered yet. */
  | "checking"
  /** This phone cannot, and never will. */
  | "unavailable"
  /** Nobody has agreed to the download. */
  | "off"
  /** Fetching or loading the weights. */
  | "loading"
  /** Ready to answer. */
  | "ready"

export interface IntelligenceValue {
  state: ModelState
  /** 0 to 1 while fetching. */
  progress: number
  /** Why it is or is not available, for a settings screen. */
  reason?: string
  /**
   * Asks one question.
   *
   * Returns the prose *and* whatever card the model asked to be shown. Both,
   * not either: a tool call with no words leaves an empty bubble, and prose
   * that describes a card the patient can already see is the model reading its
   * own output aloud.
   */
  ask: (question: string) => Promise<{ text: string; card?: Card }>
  /** The last failure, so a screen can say something true rather than generic. */
  error?: string
  enable: () => void
}

const Ctx = createContext<IntelligenceValue | null>(null)

export const IntelligenceProvider: FC<PropsWithChildren> = function IntelligenceProvider({
  children,
}) {
  const gate = useIntelligence()
  const [enabled, setEnabled] = useState(() => load<boolean>(INTELLIGENCE_ENABLED_KEY) === true)
  const [failure, setFailure] = useState<string | undefined>()

  /* Configured once per session. Re-configuring resets the library's own
     message history, so it is not something to do per turn. */
  const configured = useRef(false)

  /* Set by the tool callback during a turn and read once the answer returns.
     A ref rather than state: it is written inside an await and read in the same
     call, so a re-render in between would be a bug, not a feature. */
  const pending = useRef<Card | undefined>(undefined)

  const allowed = gate.available && enabled
  const llm = useLLM({ model: QWEN3_1_7B_QUANTIZED, preventLoad: !allowed })

  const enable = useCallback(() => {
    /* Written before the state flips, so an app killed mid-download comes back
       knowing it was asked and resumes rather than asking again. */
    save(INTELLIGENCE_ENABLED_KEY, true)
    setEnabled(true)
  }, [])

  const state: ModelState = !gate.available
    ? gate.state === "checking"
      ? "checking"
      : "unavailable"
    : !enabled
      ? "off"
      : llm.isReady
        ? "ready"
        : "loading"

  const value = useMemo<IntelligenceValue>(
    () => ({
      state,
      progress: llm.downloadProgress ?? 0,
      reason: gate.report?.reason,
      enable,
      error: failure,
      ask: async (question: string) => {
        if (!llm.isReady) throw new Error("not ready")

        /**
         * The library's own chat path, not a hand-built turn list.
         *
         * `generate(turns)` threw on every question. The prompt is the rules
         * plus the whole record, and nothing in that call manages the context
         * window — it is handed to the model and fails when it does not fit.
         *
         * `configure` takes the system prompt once and `sendMessage` carries
         * the conversation, with a `contextStrategy` that decides what to drop
         * when the window fills. Dropping the oldest turn is a decision this
         * app should not be reimplementing worse.
         */
        if (!configured.current) {
          llm.configure({
            chatConfig: { systemPrompt: systemPrompt() },
            toolsConfig: {
              tools: TOOLS as unknown as object[],
              /**
               * Records what to draw and tells the model it is done.
               *
               * The string returned here goes back into the conversation as the
               * tool's result, so it says what the patient can now see rather
               * than repeating the content — otherwise the model reads the card
               * out in its next sentence.
               */
              executeToolCallback: async (call) => {
                pending.current = cardFor(
                  call.toolName,
                  (call.arguments ?? {}) as Record<string, unknown>,
                )
                return pending.current
                  ? "Shown to the patient on screen."
                  : "That is not something this app can show."
              },
              /* The raw JSON of a call is never put in the thread. */
              displayToolCalls: false,
            },
            /* Low temperature: this reads facts out of a record and repeats
               them. Invention is the failure mode, not dullness. */
            generationConfig: { temperature: 0.3, topP: 0.9 },
          })
          configured.current = true
        }
        pending.current = undefined
        try {
          const out = await llm.sendMessage(question)
          setFailure(undefined)
          return { text: out, card: pending.current }
        } catch (e) {
          setFailure(String((e as Error)?.message ?? e))
          throw e
        }
      },
    }),
    [state, llm, gate.report?.reason, enable, failure],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useModel(): IntelligenceValue {
  const ctx = useContext(Ctx)
  if (!ctx) {
    /* A screen rendered outside the provider still has to work. Reported as
       unavailable rather than crashing — losing the feature is recoverable,
       a white screen in a transplant app is not. */
    return {
      state: "unavailable",
      progress: 0,
      enable: () => {},
      ask: async () => {
        throw new Error("no provider")
      },
    }
  }
  return ctx
}
