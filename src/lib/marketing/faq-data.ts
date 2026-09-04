export interface FaqItem {
    q: string;
    a: string;
}

/**
 * Read twice: once by the accordion, once by the JSON-LD in
 * `structured-data.tsx`. One list, so the page and the search result cannot
 * disagree about what was promised.
 *
 * **Every answer here describes something that runs.** The temptation on a
 * marketing FAQ is to answer the question the buyer wants answered rather than
 * the one the product can — and an FAQ is exactly where that gets quoted back
 * during a sales call. Where something is not built, the answer says so.
 */
export const FAQ_ITEMS: FaqItem[] = [
    {
        q: "What happens on a call?",
        a: "It answers, asks whether the caller wants Hindi or English, and takes it from there — which doctor, which day, what is free, confirming the time before booking anything. It reads the booking reference back one character at a time. If the caller asks for a person, it hands the call to your desk.",
    },
    {
        q: "Which languages?",
        a: "Hindi and English today, chosen by the caller on the keypad before the conversation starts rather than guessed from an accent. The choice is made before the line opens, so the ear, the voice and the wording are all in one language for the whole call — nothing switches halfway.",
    },
    {
        q: "Does it work on WhatsApp?",
        a: "Yes. WhatsApp Business calls arrive on the same platform and reach the same agent. There is no keypad there, so it asks which language once and then holds to it.",
    },
    {
        q: "Can it call patients, not just answer them?",
        a: "Yes — reminders, follow-ups, and results-ready calls run on the same flows you draw for answering. It is the same agent in the other direction rather than a second product to configure.",
    },
    {
        q: "Does it write to our system?",
        a: "After a call ends it reads the conversation into whichever fields you define and sends them to your CRM or HIS over a webhook. That runs after the caller has hung up, so nothing on the live call waits for it.",
    },
    {
        q: "What happens when something breaks?",
        a: "The call is handed to a number you nominate rather than left in silence. That is the whole reason it exists: the platform knows within seconds when a line has gone wrong, and the caller should not be the one who finds out.",
    },
    {
        q: "Can it invent an appointment?",
        a: "It books against what your system says is free and confirms the exact time with the caller before committing. It is instructed never to offer a doctor it has not been given — if it does not know, it says so and offers to take the request for your front desk.",
    },
    {
        q: "How do we get started?",
        a: "Call +91 80408 02529 and talk to the thing itself, then email hello@sarvathra.ai. Setup is a conversation about your doctors, your hours and where your appointments live — not a signup form.",
    },
];
