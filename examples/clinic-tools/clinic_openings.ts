import { defineTool } from "@vokoo/sdk"

/**
 * The worked example from the SDK spec. Kept because it is the smallest tool
 * that shows the whole shape: arguments, a log line, a branch, a result.
 */
export default defineTool({
    id: "3f2a91b4-7c6d-4e18-9a03-5b8e2d4c7f10",
    name: "clinic_openings",
    description: "Find open appointment slots for a doctor on a given date.",
    input: {
        doctor: { type: "string", required: true, description: "Surname, as the caller said it." },
        date: { type: "string", required: true, description: "ISO date, e.g. 2026-09-02." },
    },
    timeoutSeconds: 10,
    async handler(args: { doctor: string; date: string }, ctx) {
        console.log("checking", args.doctor, "on", args.date)
        const weekend = [0, 6].includes(new Date(`${args.date}T00:00:00Z`).getUTCDay())
        if (weekend) {
            console.log("closed at the weekend")
            return { doctor: args.doctor, date: args.date, slots: [], note: "The clinic is closed at weekends." }
        }
        return { doctor: args.doctor, date: args.date, slots: ["09:30", "11:00", "15:15"], org: ctx.orgId }
    },
})
