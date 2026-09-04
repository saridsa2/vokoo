export interface FaqItem {
    q: string;
    a: string;
}

/**
 * Read twice: once by the accordion, once by the JSON-LD in
 * `structured-data.tsx`. One list, so the page and the search result cannot
 * disagree about what was promised.
 *
 * These are the questions a hospital administrator asks in the second meeting,
 * in roughly the order they ask them: what does it actually do, what does it
 * touch, what happens when it goes wrong, and who is accountable.
 */
export const FAQ_ITEMS: FaqItem[] = [
    {
        q: "What is a patient journey here?",
        a: "Whatever your clinic already does informally, drawn as a graph: the enquiry that comes in, the language it is answered in, the diary check, the booking, the confirmation, the reminder before the appointment, the follow-up after it, and where the outcome is written. Each step is a node on a canvas. The drawing is not documentation — it is the thing that runs.",
    },
    {
        q: "What happens on a call?",
        a: "It answers, settles the language, and takes it from there — which doctor, which day, what is free, confirming the time before booking anything. It reads the booking reference back one character at a time. If the patient asks for a person, it hands the call to your desk.",
    },
    {
        q: "Which languages?",
        a: "Hindi and English, chosen by the patient on the keypad before the conversation starts rather than guessed from an accent. The choice is made before the line opens, so the ear, the voice and the wording are all in one language for the whole call — nothing switches halfway. More languages are a configuration change, not a rebuild.",
    },
    {
        q: "Does it work on WhatsApp?",
        a: "Yes. WhatsApp Business calls arrive on the same platform and reach the same journey. There is no keypad there, so it asks which language once and then holds to it.",
    },
    {
        q: "Can it call patients, not just answer them?",
        a: "Yes — reminders, follow-ups and results-ready calls run on the same journey you draw for answering, with the campaign deciding who is called, from which number, how fast and how often to retry. It is the same agent in the other direction rather than a second product to configure.",
    },
    {
        q: "Does it write to our system?",
        a: "After a call ends it reads the conversation into whichever fields you define and delivers them to your CRM or HIS over a webhook, with the call id as an idempotency key so a retry never creates a second record. That runs after the patient has hung up, so nothing on the live call waits for it.",
    },
    {
        q: "What happens when something breaks?",
        a: "The call is handed to a number you nominate rather than left in silence. That is the whole reason the escalation path exists: the platform knows within seconds when a line has gone wrong, and the patient should not be the one who finds out.",
    },
    {
        q: "Can it invent an appointment, or a doctor?",
        a: "It books against what your system says is free and confirms the exact time with the patient before committing. It is instructed never to offer a doctor it has not been given — if it does not know, it says so and offers to take the request for your front desk.",
    },
    {
        q: "Can we see it run before it touches a patient?",
        a: "Yes, and this is the part worth asking about. A journey can be replayed against a real finished call and shows you every step's input, output and timing — including exactly what would have been sent to your systems, without sending it. You watch it execute before it answers anything.",
    },
    {
        q: "How do we start?",
        a: "Call +91 80408 02529 and talk to the thing itself, then write to hello@sarvathra.ai. The first conversation is about your specialities, your hours and where your appointments live — not a signup form.",
    },
];
