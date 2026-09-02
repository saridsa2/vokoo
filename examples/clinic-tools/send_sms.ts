import { defineTool } from "@vokoo/sdk"

/**
 * Nothing is sent yet, and this says so.
 *
 * Sending needs a provider and a credential, and there is neither: the executor
 * runs with an empty environment by design, and `ctx.secrets` is not populated
 * on a test run. So this validates what it was given and reports that it did not
 * send — which a flow can branch on.
 *
 * The alternative, returning `{ sent: true }`, would have the agent tell a
 * caller their confirmation is on its way when no message exists. That is the
 * same failure as a tool timing out and reporting success.
 */
export default defineTool({
    id: "38445e53-745c-4620-aeda-68a9ac53d7e5",
    name: "send_sms",
    description:
        "Send a text message. Not yet connected to a provider — it checks the number and the message and reports that nothing was sent, so do not tell the caller a message has gone out.",
    input: {
        to: { type: "string", required: true, description: "The recipient's number, with country code." },
        text: { type: "string", required: true, description: "What to send. One or two short sentences." },
    },
    timeoutSeconds: 10,
    async handler(args: { to: string; text: string }, ctx) {
        const to = args.to.replace(/[\s-]/g, "")
        if (!/^\+?\d{10,15}$/.test(to)) {
            throw new Error(`"${args.to}" is not a number I can send to. Ask the caller to repeat it with the country code.`)
        }
        if (args.text.trim().length === 0) {
            throw new Error("There is no message to send.")
        }
        if (args.text.length > 480) {
            return { sent: false, reason: "too_long", note: "That message is too long to send as a text." }
        }

        const provider = ctx.secrets.SMS_PROVIDER_KEY
        if (!provider) {
            console.log(`would send ${args.text.length} characters to ${to}`)
            return {
                sent: false,
                reason: "no_provider",
                to,
                note: "No SMS provider is configured, so nothing was sent. Do not tell the caller a message is on its way.",
            }
        }

        // Left for whoever wires the provider: the shape above is what the flow
        // already branches on, so only this arm changes.
        throw new Error("An SMS provider key is present but no provider is wired up yet.")
    },
})
