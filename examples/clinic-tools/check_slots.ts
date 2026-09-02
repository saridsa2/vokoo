import { defineTool } from "@vokoo/sdk"

/**
 * Stands in for Vayuveda's booking system until it has an HTTP API.
 *
 * Deterministic on purpose: the same doctor and date give the same answer every
 * time, so `book_appointment` can agree with what this offered and a caller who
 * rings twice is not told two different things.
 */
export default defineTool({
    id: "9bcddd85-73f4-458e-b692-3d47e761f944",
    name: "check_slots",
    description:
        "Find free appointment times for a doctor on a date. Returns the times still open, in 24-hour clock. An empty list means nothing is free that day.",
    input: {
        doctor: { type: "string", required: true, description: "Surname, as the caller said it." },
        date: { type: "string", required: true, description: "ISO date, e.g. 2026-09-02." },
    },
    timeoutSeconds: 10,
    async handler(args: { doctor: string; date: string }) {
        const day = new Date(`${args.date}T00:00:00Z`)
        if (Number.isNaN(day.getTime())) {
            throw new Error(`"${args.date}" is not a date I can read. Ask the caller for a day and month.`)
        }

        const weekday = day.getUTCDay()
        if (weekday === 0) {
            console.log("closed on Sunday")
            return { doctor: args.doctor, date: args.date, slots: [], note: "The clinic is closed on Sundays." }
        }

        // A stable pseudo-random pick, so the same request answers the same way.
        const seed = [...`${args.doctor.toLowerCase()}${args.date}`].reduce((a, c) => a + c.charCodeAt(0), 0)
        const all = ["09:30", "10:15", "11:00", "12:00", "15:15", "16:00", "17:30"]
        const slots = all.filter((_, index) => (seed >> index) % 3 !== 0)

        // Saturdays are a short day, which is the kind of rule a caller notices
        // being got wrong.
        const open = weekday === 6 ? slots.filter((time) => time < "13:00") : slots

        console.log(`${args.doctor} on ${args.date}: ${open.length} free`)
        return { doctor: args.doctor, date: args.date, slots: open }
    },
})
