import { defineTool } from "@vokoo/sdk"

/**
 * Stands in for Vayuveda's booking system until it has an HTTP API.
 *
 * Refuses a time `check_slots` would not have offered. Without that check the
 * agent can book whatever the caller said, the clinic finds out later, and the
 * caller arrives to no appointment — which is worse than being told no now.
 */
export default defineTool({
    id: "be28303d-af41-4cbc-b57b-79d5e2efd357",
    name: "book_appointment",
    description:
        "Book a named patient into a free time with a doctor. Only times returned by check_slots are accepted. Returns a booking reference to read back to the caller.",
    input: {
        doctor: { type: "string", required: true, description: "Surname." },
        slot: { type: "string", required: true, description: "An ISO date and 24-hour time, e.g. 2026-09-02T11:00." },
        patient_name: { type: "string", required: true, description: "As the caller gave it." },
    },
    timeoutSeconds: 10,
    async handler(args: { doctor: string; slot: string; patient_name: string }) {
        const [date, time] = args.slot.split("T")
        if (!date || !time) {
            throw new Error(`"${args.slot}" is not a date and time. Expected something like 2026-09-02T11:00.`)
        }

        const day = new Date(`${date}T00:00:00Z`)
        if (Number.isNaN(day.getTime())) throw new Error(`"${date}" is not a date I can read.`)

        const weekday = day.getUTCDay()
        if (weekday === 0) {
            return { booked: false, reason: "closed", note: "The clinic is closed on Sundays." }
        }

        const seed = [...`${args.doctor.toLowerCase()}${date}`].reduce((a, c) => a + c.charCodeAt(0), 0)
        const all = ["09:30", "10:15", "11:00", "12:00", "15:15", "16:00", "17:30"]
        const free = all
            .filter((_, index) => (seed >> index) % 3 !== 0)
            .filter((t) => (weekday === 6 ? t < "13:00" : true))

        if (!free.includes(time.slice(0, 5))) {
            console.log(`${time} is not free; offering ${free.join(", ")}`)
            return { booked: false, reason: "taken", free, note: `${time} is not free. Offer one of the times listed.` }
        }

        // Derived from the booking rather than random, so asking twice does not
        // produce two references for one appointment.
        const reference = `VY-${(seed % 9000) + 1000}-${time.replace(":", "")}`
        console.log(`booked ${args.patient_name} with ${args.doctor} at ${args.slot} as ${reference}`)
        return {
            booked: true,
            booking_id: reference,
            doctor: args.doctor,
            slot: args.slot,
            patient_name: args.patient_name,
        }
    },
})
