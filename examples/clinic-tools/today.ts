import { defineTool } from "@vokoo/sdk"

/**
 * What day it is.
 *
 * A model has no clock. Asked to book "tomorrow", `gpt-4.1-mini` produced
 * `2024-06-07` on a call taken on 1 September 2026 — a date from its training,
 * confidently passed to `book_appointment`, which accepted it. Every relative
 * date the agent handled was wrong in the same way, and nothing in the chain
 * could notice.
 *
 * The resolved dates are returned rather than only today's, because a model
 * doing the arithmetic itself is a model that can get the arithmetic wrong. It
 * is cheaper to hand over the answer than to hope.
 *
 * Asia/Kolkata, not UTC: the clinic is in Hyderabad, and after 18:30 UTC the two
 * disagree about what day it is — which is exactly when an evening caller rings.
 */
export default defineTool({
    id: "b41e7d92-0c53-4a8f-9d16-2e7a5c93b408",
    name: "today",
    description:
        "The current date and the dates of common relative days. Call this before booking or checking availability, whenever the caller says today, tomorrow, this week or names a weekday.",
    input: {},
    timeoutSeconds: 5,
    async handler() {
        const zone = "Asia/Kolkata"
        // `en-CA` renders as YYYY-MM-DD, which is the format the other tools take.
        const iso = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: zone })
        const dayName = (date: Date) => date.toLocaleDateString("en-GB", { timeZone: zone, weekday: "long" })

        const now = new Date()
        const plus = (days: number) => new Date(now.getTime() + days * 86_400_000)

        // The next occurrence of each weekday, so "Friday" resolves without the
        // model counting. Today counts as today, not as next week.
        const weekdays: Record<string, string> = {}
        for (let ahead = 0; ahead < 7; ahead += 1) {
            const day = plus(ahead)
            weekdays[dayName(day).toLowerCase()] = iso(day)
        }

        console.log(`today is ${iso(now)} (${dayName(now)})`)

        return {
            timezone: zone,
            today: iso(now),
            weekday: dayName(now),
            time: now.toLocaleTimeString("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" }),
            tomorrow: iso(plus(1)),
            day_after_tomorrow: iso(plus(2)),
            next_week: iso(plus(7)),
            next: weekdays,
        }
    },
})
