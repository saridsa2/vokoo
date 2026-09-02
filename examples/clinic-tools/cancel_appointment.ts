import { defineTool } from "@vokoo/sdk"

/**
 * Stands in for Vayuveda's booking system until it has an HTTP API.
 *
 * Checks the reference is one this clinic issues before confirming. An agent
 * that says "cancelled" to a mistyped reference has cancelled nothing, and the
 * caller will not find out until they are turned away.
 */
export default defineTool({
    id: "67b0cc03-7f9f-4bc5-8d4a-a8316838a2e0",
    name: "cancel_appointment",
    description:
        "Cancel a booking by its reference. Confirm the reference back to the caller before calling this. Reports whether the reference was recognised.",
    input: {
        booking_id: { type: "string", required: true, description: "The VY- reference given when the booking was made." },
    },
    timeoutSeconds: 10,
    async handler(args: { booking_id: string }) {
        const reference = args.booking_id.trim().toUpperCase()

        // The shape `book_appointment` issues: VY-1234-1100.
        if (!/^VY-\d{4}-\d{4}$/.test(reference)) {
            console.log(`not a reference this clinic issues: ${reference}`)
            return {
                cancelled: false,
                reason: "unknown_reference",
                note: "That is not a booking reference I recognise. Ask the caller to read it again, or offer to look it up by name.",
            }
        }

        console.log(`cancelled ${reference}`)
        return { cancelled: true, booking_id: reference }
    },
})
