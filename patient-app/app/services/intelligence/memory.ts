import { load, save } from "@/utils/storage"

import type { Card } from "./chat"

import type { Message } from "@/services/mock/careData"

/**
 * What the conversation remembers between launches.
 *
 * ## Why a store and not component state
 *
 * The thread lived in `useState` seeded from a mock array, so every launch
 * began the conversation again. For a patient on a year-long programme that is
 * not a small thing: what they asked last Tuesday and what Sarv told them is
 * part of their record of their own care, and an app that forgets it is one
 * they stop trusting with anything that matters.
 *
 * ## Two different memories, deliberately separate
 *
 * - **The transcript** is everything said, kept for the patient to scroll. It
 *   grows for a year.
 * - **The context** is the handful of turns the model is shown. It is small
 *   because the window is small, and it is *derived* from the transcript rather
 *   than being the same thing — the model does not need March to answer a
 *   question in September.
 *
 * Conflating them is how a chat app ends up either forgetting everything or
 * feeding a year of conversation into a two-thousand-token window and having
 * the prompt silently truncated.
 *
 * ## Everything stays on the phone
 *
 * This is MMKV, the same store the auth token and the health grant use. Nothing
 * here is synced. The conversation is the patient's, the model that reads it
 * runs on their device, and neither has any reason to leave it.
 */
const KEY = "chat.transcript"

/** How many turns the model is shown. The window is small; the record matters more. */
const CONTEXT_TURNS = 6

export interface StoredMessage extends Message {
  /** Epoch milliseconds. `at` is for display; this is for sorting and grouping. */
  sentAt: number
  /**
   * What Sarv asked the app to draw with this reply.
   *
   * Stored with the message rather than held in screen state so it survives a
   * relaunch: scrolling back to yesterday's answer and finding the chart gone
   * would make the conversation look like it had been edited.
   */
  card?: Card
}

export function loadTranscript(seed: Message[]): StoredMessage[] {
  const stored = load<StoredMessage[]>(KEY)
  if (stored && stored.length) return stored

  /**
   * Seeded once from the mock thread, then owned by the store.
   *
   * The seed is dated backwards from now so the day separators have something
   * to separate on a fresh install — otherwise every message in a "two days
   * ago" conversation is stamped today and the grouping looks broken on the one
   * run where somebody is most likely to look at it.
   */
  const now = Date.now()
  const day = 86_400_000
  const spread = seed.map((m, i) => ({
    ...m,
    sentAt: now - (seed.length - i) * (day / 2),
  }))
  save(KEY, spread)
  return spread
}

export function appendMessage(
  all: StoredMessage[],
  message: Message & { card?: Card },
): StoredMessage[] {
  const next = [...all, { ...message, sentAt: Date.now() }]
  save(KEY, next)
  return next
}

/**
 * The turns the model is shown.
 *
 * A patient's own words and Sarv's replies only — a coordinator's message is
 * part of the transcript and not part of what the model is answering as. Taking
 * the tail rather than a summary because summarising a conversation with the
 * same small model that is about to answer costs a second inference and
 * introduces a second thing that can be wrong.
 */
export function contextFor(all: StoredMessage[]) {
  return all
    .filter((m) => m.from === "you" || m.from === "agent")
    .slice(-CONTEXT_TURNS)
    .map((m) => ({
      role: m.from === "you" ? ("user" as const) : ("assistant" as const),
      content: m.body,
    }))
}

/**
 * The label above a day's messages.
 *
 * Relative for the last week because that is how people refer to recent days,
 * absolute after that because "nine days ago" is a sum nobody wants to do. No
 * separator is emitted for the first group when it is today — a conversation
 * that opens with the word "Today" is labelling the obvious.
 */
export function dayLabel(at: number, now = Date.now()): string {
  const d = new Date(at)
  const midnight = (t: number) => {
    const x = new Date(t)
    x.setHours(0, 0, 0, 0)
    return x.getTime()
  }
  const days = Math.round((midnight(now) - midnight(at)) / 86_400_000)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return d.toLocaleDateString("en-IN", { weekday: "long" })
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long" })
}

/** Groups a transcript into days, oldest first. */
export function byDay(all: StoredMessage[]): Array<{ label: string; messages: StoredMessage[] }> {
  const out: Array<{ label: string; messages: StoredMessage[] }> = []
  for (const m of all) {
    const label = dayLabel(m.sentAt)
    const last = out[out.length - 1]
    if (last && last.label === label) last.messages.push(m)
    else out.push({ label, messages: [m] })
  }
  return out
}
