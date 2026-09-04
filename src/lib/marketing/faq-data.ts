export interface FaqItem {
    q: string;
    a: string;
}

/**
 * Read twice: once by the accordion, once by the JSON-LD in
 * `structured-data.tsx`. One list, so the page and the search result cannot
 * disagree about what was promised.
 *
 * Written for the people in the room at a tertiary hospital — a medical
 * director, a head of oncology or transplant, and whoever runs IT — in roughly
 * the order they ask: what is it, is it safe, what does it touch, and who is
 * accountable when it goes wrong.
 *
 * **Clinical safety sits above capability.** A page that leads with what an
 * agent can do and buries what it must not do has answered the wrong question
 * first for this reader, whatever else it gets right.
 */
export const FAQ_ITEMS: FaqItem[] = [
    {
        q: "What is a care pathway here?",
        a: "The contacts your protocol already implies, drawn as a graph: the pre-cycle labs reminder, the confirmation, the symptom check on day three, the scan reminder, the follow-up at six months. Each is a node with its own timing, its own questions and its own rule for when a person takes over. The drawing is what runs.",
    },
    {
        q: "Does it give clinical advice?",
        a: "No, and it is built so that it cannot drift into doing so. It asks the questions your protocol specifies and records the answers. Anything that is a symptom, a dose question or a sign of deterioration is handed to a nurse with what the patient said — it does not triage, reassure or advise.",
    },
    {
        q: "What happens if a patient reports something serious?",
        a: "The call is escalated to a number your department nominates, during the same call rather than as a task somebody picks up later, and what the patient said travels with it. If nobody answers there, that is a failure the platform reports rather than absorbs.",
    },
    {
        q: "Where does patient data go?",
        a: "It stays in your workspace. Recording is off unless you turn it on, and how long a call's content is kept is a number you set — when it lapses the content is deleted. What leaves is what you chose to send: the fields you defined, delivered to your own systems.",
    },
    {
        q: "Does it write into our HIS?",
        a: "It delivers outward. After a call it reads the conversation into the fields you defined and posts them to your HIS or CRM over a webhook, carrying the call id so that a retry can never create a second record. Nothing is installed beside your systems and no database is opened to us.",
    },
    {
        q: "Can it run different pathways per department?",
        a: "That is the usual shape. Oncology and transplant do not ask a patient the same questions, escalate to the same people, or run on the same clock — so each draws its own, and a department can change its own without a release or a ticket to anybody.",
    },
    {
        q: "What about patients who do not answer?",
        a: "Retries are part of the pathway rather than a setting buried somewhere: how many, how far apart, and what happens when the attempts are exhausted — usually a coordinator's list, which is now short and holds only the people who genuinely need a call from a person.",
    },
    {
        q: "Which languages?",
        a: "Hindi and English today, settled before the conversation starts rather than guessed from an accent, so the ear, the voice and the wording stay in one language for the whole call. More languages are a configuration change rather than a rebuild.",
    },
    {
        q: "Does it work on WhatsApp?",
        a: "Yes. WhatsApp Business calls arrive on the same platform and reach the same pathway. There is no keypad there, so it settles the language by asking once.",
    },
    {
        q: "Can we see it run before it touches a patient?",
        a: "Yes, and this is the part worth asking about. A pathway can be replayed against a real finished call and shows every step's input, output and timing — including exactly what would have been written to your systems, without writing it. You watch it execute before it speaks to anybody.",
    },
    {
        q: "How do we start?",
        a: "Call +91 80408 02529 and talk to the thing itself, then write to hello@sarvathra.ai. The first conversation is about one department, one protocol, and where its patient records live — not a signup form.",
    },
];
