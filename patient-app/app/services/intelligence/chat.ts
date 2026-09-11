import { RING_IF, UNIT_PHONE } from "@/services/mock/careData"

import { buildHistory } from "./history"

/**
 * What Sarv is told before a patient says anything.
 *
 * ## The shape of the problem
 *
 * A 1.7B instruct model, on a phone, talking to somebody six weeks after a
 * transplant. Left open it will do what it did on the bench: given "my chest
 * feels tight" with no instructions it began reasoning about angina and heart
 * attacks, and got the epidemiology wrong on the way. Nothing was wrong with
 * the model — it was asked an open question by a screen that had no business
 * asking one.
 *
 * ## And a fence on its own produces one answer
 *
 * The first version was almost all prohibitions — must not diagnose, must not
 * advise, must not comment, defer to the unit. A small model under that much
 * negative instruction collapses to the safest sentence it can construct, and
 * says it to everything. It answered "Hi" with *the unit is still monitoring
 * you, keep calm and follow their instructions*, and then answered every other
 * question with the same words.
 *
 * So the instructions now lead with the job — answer the question, with the
 * figures from the record — and carry worked examples of the shape of a good
 * answer, because a small model imitates far more reliably than it reasons.
 * The prohibitions are down to the three that matter, and generic reassurance
 * is named as a failure rather than left as the safest available output.
 *
 * ## Nothing in here names a condition
 *
 * Not "lung", not "FEV1", not "tacrolimus". The programme's own facts arrive in
 * the history block, which is generated from whatever the cohort tracks. This
 * file has to read the same for a heart cohort, a renal one, or a GLP-1
 * programme, or somebody will be editing prompt text per cohort — and that is
 * how one patient gets told about another patient's measurement.
 *
 * ## Why the escalation rules are repeated to it
 *
 * They are already in the history block. They are restated as instructions
 * because a model treats the two differently: in the history they are a fact
 * about the patient, in the instructions they are a rule about its own
 * behaviour. The thing that must never fail is Sarv absorbing a red-flag
 * symptom into a friendly answer.
 */

const RULES = [
  "You are Sarv, inside a hospital follow-up app. You are talking to the patient whose record is",
  "below. You have their record in front of you — use it.",
  "",
  "ANSWER THE QUESTION THEY ASKED, with the actual figures from their record.",
  "",
  "Examples of the shape of a good answer:",
  '- "What was my reading?" -> "2.33 this morning. Your baseline is 2.35, so that is right where it',
  '  should be."',
  '- "Hi" -> "Hello. You have got your morning reading to send today, and the weekly questions are',
  '  due tomorrow."',
  '- "What do I have to do?" -> name the outstanding items and when they are due.',
  '- "Is that alright?" -> say what the record says the target is and where their number sits',
  "  against it. Nothing more.",
  "",
  "Three things you must not do:",
  "- do not name a condition, diagnose, or guess a cause",
  "- do not comment on doses",
  "- do not invent a number, date or result. If it is not below, say you do not have it",
  "",
  "If they describe anything on the ring-the-unit list, say so plainly and give the number",
  `(${UNIT_PHONE}). Do not reassure them first and do not offer to pass a message — that list exists`,
  "because a message is too slow.",
  "",
  "Reasons to ring:",
  ...RING_IF.map((r) => `- ${r}`),
  "",
  "Never answer with general reassurance like 'your team is monitoring you' or 'follow their",
  "instructions'. That is true of everything and answers nothing. If you genuinely have nothing",
  "specific, say what you do have and stop.",
  "",
  "When you show something with a tool, do not also write out what it contains — the patient can",
  "see it. Say one short line and let the card speak.",
  "",
  "Two or three short sentences. Talk the way a ward nurse talks: plain, warm, no jargon, no lists",
  "unless they asked for one. Never open with a greeting unless they greeted you first.",
].join("\n")

/**
 * What Sarv may put on the screen, as opposed to say.
 *
 * ## Why these are tools and not formatting instructions
 *
 * Asked "how am I doing", the model reproduced the record's own layout back at
 * the patient — because a model given a table copies the table. Telling it to
 * write prose instead works until the next question. Handing it a *tool* is the
 * durable version: the arguments come back as an object by construction, the
 * app renders the card from its own data, and there is no formatting for the
 * model to get right or wrong.
 *
 * ## The model chooses which card, never what it says
 *
 * This is the boundary that matters in a health app. `show_reading` names a
 * measurement; the card it renders is drawn from the record by the same
 * component the Progress screen uses. So the worst failure available to a 1.7B
 * model on a phone is *the wrong chart*, not a wrong number.
 *
 * ## And it never performs the action
 *
 * `call_unit` shows the panel with the number as a button. It does not dial.
 * A model that can place a call is a model that can place a call by mistake,
 * at three in the morning, to a transplant unit — and the patient pressing the
 * button is both the consent and the confirmation.
 */
export const TOOLS = [
  {
    type: "function",
    function: {
      name: "call_unit",
      description:
        "Show the patient the transplant unit's phone number as a button they can press. Use this whenever they describe anything on the list of reasons to ring. It does not place the call.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "show_reading",
      description:
        "Show the patient one of their measurements as a chart with its target. Use when they ask about a specific measurement.",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "Which measurement. One of the keys listed in their record.",
          },
        },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_todo",
      description: "Show what the patient still has outstanding, as a list they can tap.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
] as const

/** What a tool call asks the screen to render under the reply. */
export type Card =
  | { kind: "call_unit" }
  | { kind: "reading"; key: string }
  | { kind: "todo" }

/** Turns a model's tool call into a card, or nothing if it asked for something unknown. */
export function cardFor(toolName: string, args: Record<string, unknown>): Card | undefined {
  if (toolName === "call_unit") return { kind: "call_unit" }
  if (toolName === "show_todo") return { kind: "todo" }
  if (toolName === "show_reading" && typeof args.key === "string") {
    return { kind: "reading", key: args.key }
  }
  /* An unknown tool is dropped rather than guessed at. The reply's prose still
     stands on its own — a missing card is a worse answer, not a broken one. */
  return undefined
}

export interface ChatTurn {
  role: "system" | "user" | "assistant"
  content: string
}

/**
 * The instructions and the record, as one system prompt.
 *
 * Handed to `configure` once per session rather than rebuilt into a turn list
 * per question. The library then carries the conversation itself and applies a
 * context strategy when the window fills — which is the part that was failing
 * when this app built the turns by hand and passed them straight to `generate`.
 */
export function systemPrompt(): string {
  /**
   * `/no_think` is Qwen 3's own switch, and it is not a style preference.
   *
   * The model is a reasoning model: it opens every answer with a `<think>`
   * block. On a phone that block is long, slow, and frequently unfinished when
   * generation stops — and an unclosed block means `visible()` correctly
   * returns nothing, so the patient got "I did not follow that" to a perfectly
   * clear question.
   *
   * Thinking buys very little here anyway. The job is reading six named facts
   * out of a record and answering in two sentences, not working something out.
   * Turning it off makes the reply arrive sooner *and* makes it arrive at all.
   */
  return `${RULES}\n\n=== THE PATIENT'S RECORD ===\n${buildHistory().brief}\n\n/no_think`
}

/**
 * Strips a reasoning model's thinking block.
 *
 * Qwen 3 opens with `<think>…</think>` and the patient must never see it. This
 * is a parser and parsers of model output are exactly what this project's notes
 * warn against — the durable answer is a forced tool call, which is how the
 * server side solved the same problem with MiniMax.
 *
 * It is here because chat is prose by nature: there is no schema to force, so
 * there is nothing to force it into. Written to fail safe — an unclosed block
 * means the whole reply is still being thought, so nothing is shown rather than
 * half a thought being shown.
 */
export function visible(raw: string): string {
  const open = raw.indexOf("<think>")
  if (open === -1) return raw.trim()
  const close = raw.indexOf("</think>")
  if (close === -1) return ""
  return raw.slice(close + "</think>".length).trim()
}
