/**
 * Everything the page says, in one file.
 *
 * Separated from the markup because the whole of tonight's failure was copy,
 * and copy that lives inside JSX is copy nobody can review. This file can be
 * read end to end in a minute and rewritten without touching a component.
 *
 * The register is adapted from the Journey Builder document — a verb, an
 * object, and the mechanism, no adjectives — because that is the language this
 * category is sold in and it is what landed when we used it before.
 */

/** What a hospital runs into today. The document's "Problems Healthcare Faces". */
export const PROBLEMS = [
    {
        title: "Contact depends on who is free",
        body: "The path names the day. Whether anyone rings on it depends on the ward that afternoon, and when the ward is busy the path is what gives way.",
    },
    {
        title: "A message cannot hear an answer",
        body: "Outreach tools send. An opened link proves somebody opened it and a form collects what the form knew to ask. Neither tells you how the patient is.",
    },
    {
        title: "What the patient said stays with whoever rang",
        body: "It is in a slip, a memory or a WhatsApp thread. The next clinician seeing that patient starts without it.",
    },
    {
        title: "Nothing records the contact that did not happen",
        body: "A missed follow-up leaves no row. The patient is not flagged as missed — they are absent from a list nobody checked.",
    },
];

/** What Sarvathra does. The document's "Solutions Offered", in its shape. */
export const SOLUTIONS = [
    "Converts a published care path into agents that carry it out",
    "Instantiates one agent per patient across a whole cohort",
    "Speaks on the phone, over WhatsApp, and in your own app",
    "Asks what the path asks and records the answer against the patient",
    "Brings a clinician onto the call the moment an answer needs one",
    "Assigns cohorts to practitioners, who see every patient current",
    "Writes the outcome back into your systems, keyed so a retry cannot duplicate it",
];

/** The four care paths, and what each asks for. */
export const PATHS = [
    {
        name: "Chemotherapy",
        guideline: "NICE NG151",
        setting: "Oncology day care",
        contacts: "21",
        window: "Per cycle",
        asks: "Anti-emetics, temperature, the line site, eating and drinking, and the bloods before the next cycle.",
    },
    {
        name: "Type 2 diabetes",
        guideline: "NICE NG28",
        setting: "Endocrinology",
        contacts: "12",
        window: "Per year",
        asks: "Review intervals, medication tolerance, and the checks that quietly lapse between appointments.",
    },
    {
        name: "Postpartum",
        guideline: "ICMR",
        setting: "Obstetrics",
        contacts: "9",
        window: "Six weeks",
        asks: "Recovery, feeding, mood, and the signs a mother is least likely to ring the ward about.",
    },
    {
        name: "GLP-1 therapy",
        guideline: "NICE TA875",
        setting: "Weight management",
        contacts: "16",
        window: "Titration",
        asks: "Dose steps, side effects, and whether the patient is still taking it at all.",
    },
];

/** What arrives in a pack. */
export const PACK = [
    {
        part: "The care path",
        detail: "Every contact the guideline implies, as a graph with its own timing and its own branches.",
    },
    {
        part: "Voice agents",
        detail: "One per path, with the prompt, the engine and the voice the conversation runs on.",
    },
    {
        part: "Skills",
        detail: "What an agent may do inside a conversation — ask, confirm, book, escalate.",
    },
    {
        part: "Tools",
        detail: "How it reaches anything outside the call: your HIS, your CRM, a scheduler.",
    },
];

/** How it runs, end to end. The document's six steps, in ours. */
export const STEPS = [
    {
        n: "01",
        title: "Take the guideline",
        body: "NICE and ICMR have already written the path. Nobody at your hospital draws it from a blank canvas.",
    },
    {
        n: "02",
        title: "Ship it as a pack",
        body: "The path, the agents, the skills and the tools arrive together. Your department changes what it does differently; we help with that.",
    },
    {
        n: "03",
        title: "Create the cohort",
        body: "A cohort is one care path and the patients on it. Every patient gets their own instance of the agent, following their own dates.",
    },
    {
        n: "04",
        title: "Assign practitioners",
        body: "One or more per cohort. What they open is already current, because the following has been done.",
    },
    {
        n: "05",
        title: "It holds the conversation",
        body: "Phone, WhatsApp or your app. It asks what the path asks and listens to the reply, in the patient's language.",
    },
    {
        n: "06",
        title: "A person takes over when needed",
        body: "A symptom, a dose question, a patient who sounds unwell — to the number the department names, during the same call.",
    },
];

/** The questions a hospital asks before it lets anything speak to its patients. */
export const FAQ = [
    {
        q: "Does it give clinical advice?",
        a: "No, and it is built so that it cannot drift into doing so. It asks the questions the path specifies and records the answers. Anything that is a symptom, a dose question or a sign of deterioration is handed to a person with what the patient said.",
    },
    {
        q: "What happens if a patient reports something serious?",
        a: "The call is escalated to a number your department nominates, during the same call rather than as a task somebody opens later, and what the patient said travels with it. If nobody answers there, that is a failure Sarvathra reports rather than absorbs.",
    },
    {
        q: "Can we change the path we are given?",
        a: "Yes, and most departments do. A pack is a template rather than a fixed product, and we help with the customisation.",
    },
    {
        q: "Can different departments run different paths?",
        a: "That is the usual shape. A cohort is defined by one care path, so oncology and obstetrics each have their own, and a department can change its own without a release.",
    },
    {
        q: "Which languages, and on what?",
        a: "Phone, WhatsApp Business, and your own app. The language is settled before the conversation starts rather than guessed from an accent, so the ear, the voice and the wording stay in one language for the whole call.",
    },
    {
        q: "What about patients who do not answer?",
        a: "Retries are part of the path rather than a setting buried somewhere: how many, how far apart, and what happens when the attempts are exhausted — usually a coordinator's list, which is now short and holds only the people who genuinely need a person.",
    },
    {
        q: "Does it write into our HIS?",
        a: "It delivers outward. After a conversation it reads what was said into the fields you defined and posts them to your HIS or CRM, carrying the call id so that a retry cannot create a second record. Nothing is installed beside your systems and no database is opened to us.",
    },
    {
        q: "Where does patient data go?",
        a: "It stays in your workspace. Recording is off unless you turn it on, and how long a conversation's content is kept is a number you set — when it lapses the content is deleted.",
    },
];
