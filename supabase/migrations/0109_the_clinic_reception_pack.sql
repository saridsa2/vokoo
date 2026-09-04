-- The pack Vayuveda runs, captured so another clinic can be given the same thing.
--
-- Everything here is literal rather than copied from Vayuveda's rows at
-- migration time. A migration that reads `organizations where slug = 'vayuveda'`
-- reproduces nothing on a fresh database, and content that only exists on one
-- installation is not a pack.
--
-- ## What is in it, and what is deliberately not
--
--   packed      four agents, the three skills all four carry, the two flows
--               that answer a call, and the four platform engines those agents
--               name (granted per workspace by 0106).
--
--   not packed  **tools**, **schemas** and **number bindings**.
--
-- Tools stay out for the reason already recorded — nothing shipped in a pack
-- can authenticate, since `ctx.secrets` is `{}` on every invocation — and for a
-- sharper one: these particular tools are mocks. `check_slots` hashes a
-- doctor's name into plausible availability, which is what booked an
-- appointment against "Cardiologist A", a person who does not exist. Shipping
-- that to a customer is worse than shipping nothing.
--
-- So the skills arrive described and empty. That is the honest state: the
-- customer supplies what actually checks their diary.
--
-- Schemas stay out because `structured_outputs.org_id` is `not null` and
-- nothing substitutes a schema id into a graph — which is why **CRM Push is not
-- in this pack**. Its intelligence node carries a hard `shape_id`, and seeded
-- elsewhere that id resolves to nothing. Post-call stays Vayuveda's until a
-- schema can be packed.
--
-- Bindings stay out because `number_flows` keys on a phone number the new
-- workspace does not have yet.
--
-- ## Two things changed on the way in
--
-- **The clinic's identity is neutralised.** Every prompt said "You answer the
-- phone for Vayuveda, a clinic in Hyderabad", the keypad menu opened "Welcome
-- to Vayuveda", and the WhatsApp greeting named it. Seeded verbatim, a new
-- customer's agents would answer the phone as somebody else's clinic. Agents
-- arrive as drafts and the prompt is theirs to edit, so this is the first line
-- they will change.
--
-- **`set_language` is not a tool and never has been.** The WhatsApp prompt told
-- the model to call it, twice. That instruction is dropped here rather than
-- packed; Vayuveda's own copy still carries it and is a separate fix.
--
-- ## Version 2
--
-- v1 of `clinic-reception` was one agent, one flow and one engine. Every
-- workspace already seeded from it keeps `pack_version = 1` on its rows, which
-- is what that stamp is for.

update packs
   set label   = 'Clinic reception',
       domain  = 'Healthcare',
       summary = 'Answers in Hindi or English on a keypad menu, or on WhatsApp. Books and cancels appointments, gives timings and directions. Skills arrive without tools — connect what checks your diary.',
       version = 2,
       updated_at = now()
 where slug = 'clinic-reception';

-- v1's templates go, rather than being left inactive beside v2's. A pack is
-- what a workspace is given today; its history lives in the `pack_version`
-- stamped on every row it has ever seeded.
delete from templates
 where pack_id = (select id from packs where slug = 'clinic-reception');


-- ---- Skills ----------------------------------------------------------------
--
-- Copied without their `skill_tools` links, so each arrives described and with
-- nothing behind it. Seeded as drafts for that reason.

insert into templates (pack_id, kind, label, summary, payload, sort_order)
values ((select id from packs where slug = 'clinic-reception'), 'skill',
        'Book an appointment', 'the caller wants to see a doctor, asks for an appointment, or wants to come in',
        '{"name": "Book an appointment", "slug": "book-an-appointment", "description": "the caller wants to see a doctor, asks for an appointment, or wants to come in", "instructions": "Find out which doctor and which day. Offer the free times. Confirm the doctor, the day and the patient name before booking, then read the reference back.", "collects": [{"name": "doctor", "type": "string", "label": "Doctor", "required": true}, {"name": "date", "type": "string", "label": "Preferred day", "required": true}, {"name": "patient_name", "type": "string", "label": "Patient name", "required": true}], "completion": "A time is booked and the caller has been given the reference."}'::jsonb, 0);

insert into templates (pack_id, kind, label, summary, payload, sort_order)
values ((select id from packs where slug = 'clinic-reception'), 'skill',
        'Cancel an appointment', 'the caller wants to cancel a booking they already have',
        '{"name": "Cancel an appointment", "slug": "cancel-an-appointment", "description": "the caller wants to cancel a booking they already have", "instructions": "Ask for the booking reference and read it back before cancelling. If it is not recognised, say so and offer to pass them to the front desk.", "collects": [{"name": "booking_id", "type": "string", "label": "Booking reference", "required": true}], "completion": "The booking is cancelled and the caller has been told so."}'::jsonb, 1);

insert into templates (pack_id, kind, label, summary, payload, sort_order)
values ((select id from packs where slug = 'clinic-reception'), 'skill',
        'Opening hours and directions', 'the caller asks when the clinic is open, where it is, or how to get there',
        '{"name": "Opening hours and directions", "slug": "opening-hours", "description": "the caller asks when the clinic is open, where it is, or how to get there", "instructions": "Answer with the hours for the day they asked about, or the address and the nearest landmark. If they did not say a day, assume today.", "collects": [{"name": "day", "type": "string", "label": "Day", "required": true}], "completion": "The caller has been told what they asked for."}'::jsonb, 2);


-- ---- Agents ----------------------------------------------------------------
--
-- One per way in. The three behind the keypad differ only in which language
-- they are told to hold to and which engine they run on — which is the point:
-- both Sarvam services take their language when the socket opens, so the
-- choice has to be made before the agent node rather than mid-call.

insert into templates (pack_id, kind, label, summary, payload, engine_slug, sort_order)
values ((select id from packs where slug = 'clinic-reception'), 'agent',
        'Reception (Hindi)', 'Runs on hindi-relay-sarvam.',
        '{"name": "Reception (Hindi)", "system_prompt": "You answer the phone for this clinic. Be brief and warm. Speak in short sentences a caller can follow on a phone line. Always reply in Hindi, written in Devanagari script. The caller chose Hindi on the keypad, so do not switch to English even if they use English words for names, doctors or dates. Write numbers, times and dates in Devanagari words rather than digits. Read a booking reference one character at a time.", "first_message": "मैं अपॉइंटमेंट बुक या रद्द कर सकती हूँ, और क्लिनिक का समय और पता बता सकती हूँ। आप क्या करना चाहेंगे?", "config": {}, "skills": ["Book an appointment", "Cancel an appointment", "Opening hours and directions"]}'::jsonb,
        'hindi-relay-sarvam', 0);

insert into templates (pack_id, kind, label, summary, payload, engine_slug, sort_order)
values ((select id from packs where slug = 'clinic-reception'), 'agent',
        'Reception (English)', 'Runs on english-relay-sarvam.',
        '{"name": "Reception (English)", "system_prompt": "You answer the phone for this clinic. Be brief and warm. Speak in short sentences a caller can follow on a phone line. Always reply in English. The caller chose English on the keypad, so do not switch to Hindi. Read a booking reference one character at a time.", "first_message": "I can book or cancel an appointment, and tell you our timings and how to find us. What would you like to do?", "config": {}, "skills": ["Book an appointment", "Cancel an appointment", "Opening hours and directions"]}'::jsonb,
        'english-relay-sarvam', 1);

insert into templates (pack_id, kind, label, summary, payload, engine_slug, sort_order)
values ((select id from packs where slug = 'clinic-reception'), 'agent',
        'Reception (Realtime)', 'Runs on openai-realtime-english.',
        '{"name": "Reception (Realtime)", "system_prompt": "You answer the phone for this clinic. Be brief and warm. Speak in short sentences a caller can follow on a phone line. Always reply in English. Read a booking reference one character at a time.", "first_message": "I can book or cancel an appointment, and tell you our timings and how to find us. What would you like to do?", "config": {}, "skills": ["Book an appointment", "Cancel an appointment", "Opening hours and directions"]}'::jsonb,
        'openai-realtime-english', 2);

insert into templates (pack_id, kind, label, summary, payload, engine_slug, sort_order)
values ((select id from packs where slug = 'clinic-reception'), 'agent',
        'WhatsApp reception', 'Runs on gemini-live-native-audio.',
        '{"name": "WhatsApp reception", "system_prompt": "You answer the phone for this clinic. Be brief and warm. Speak in short sentences a caller can follow on a phone line.\n\n## Language\n\nThis caller reached you on WhatsApp. There is no keypad here, so which language to speak is the first thing to settle, and you settle it by asking.\n\nIf the caller has already spoken in a language, use it — never ask a question they have just answered. Otherwise ask once, briefly, offering Hindi and English.\n\nAfter that speak only that language for the whole call, including numbers, times and dates. Write Hindi in Devanagari and its numbers in Devanagari words; write English in Latin script and its numbers in digits.\n\nYou can serve a caller in either language equally well. Never treat a language request as something you cannot handle, and never hand the call to a person because of it.\n\n## Doctors\n\nNever invent a doctor. If you do not know which doctors this clinic has, say so and ask the caller which doctor they want, or offer to take their request for the front desk. Do not offer a name the caller has not given you, and do not guess a specialty the clinic provides.\n\n## Booking\n\nFind out which doctor and which day, check what is free, and confirm the exact time before booking. Read a booking reference back one character at a time.", "first_message": "Namaste. Hindi ya English?", "config": {}, "skills": ["Book an appointment", "Cancel an appointment", "Opening hours and directions"]}'::jsonb,
        'gemini-live-native-audio', 3);


-- ---- Flows -----------------------------------------------------------------
--
-- Agents are named `{{AGENT:<label>}}` rather than by uuid (0108). The main
-- line names three, which is what the single `{{AGENT_ID}}` placeholder could
-- not express — every branch of the menu would have landed on one agent.

insert into templates (pack_id, kind, label, summary, payload, sort_order)
values ((select id from packs where slug = 'clinic-reception'), 'flow',
        'Main line', 'Answers the phone and hands over when asked.',
        '{"name": "Main line", "description": "Answers the phone and hands over when asked.", "trigger_event": "call.answered", "channel": "voice", "config": {}, "graph": {"nodes": [{"id": "trigger", "name": "Call answered", "type": "trigger", "config": {}, "position": {"x": -831, "y": 13}, "implementation": "trigger.call_answered"}, {"id": "n_lang", "name": "Choose a language", "type": "custom", "config": {"digits": [{"id": "1", "label": "English"}, {"id": "2", "label": "Hindi"}, {"id": "3", "label": "OpenAI Realtime"}], "prompt": "Welcome. For English, press 1. Hindi ke liye, do dabaiye. To try our newest assistant, press 3.", "attempts": 1, "language": "en-IN"}, "position": {"x": -357, "y": -9}, "implementation": "kookoo.collect_digits"}, {"id": "n_agent_en", "name": "Reception (English)", "type": "custom", "config": {"agent_id": "{{AGENT:Reception (English)}}", "timeout_seconds": 600}, "position": {"x": 153, "y": -398}, "implementation": "agent"}, {"id": "n_agent", "name": "Reception", "type": "custom", "config": {"agent_id": "{{AGENT:Reception (Hindi)}}", "timeout_seconds": 600}, "position": {"x": 180, "y": 0}, "implementation": "agent"}, {"id": "n_agent_rt", "name": "Reception (Realtime)", "type": "custom", "config": {"agent_id": "{{AGENT:Reception (Realtime)}}", "timeout_seconds": 600}, "position": {"x": 171, "y": 420}, "implementation": "agent"}, {"id": "n_done", "name": "Finished", "type": "custom", "config": {"reason": "answered"}, "position": {"x": 734, "y": -258}, "implementation": "kookoo.hangup"}, {"id": "n_gone", "name": "Caller gone", "type": "custom", "config": {"reason": "abandoned"}, "position": {"x": 771, "y": 167}, "implementation": "kookoo.hangup"}], "start": "trigger", "version": 2, "variables": [], "transitions": [{"id": "t0", "to": "n_lang", "from": "trigger", "outcome": "started"}, {"id": "t1", "to": "n_agent_en", "from": "n_lang", "outcome": "1"}, {"id": "t2", "to": "n_agent", "from": "n_lang", "outcome": "2"}, {"id": "t3", "to": "n_agent_rt", "from": "n_lang", "outcome": "3"}, {"id": "t4", "to": "n_agent", "from": "n_lang", "outcome": "timeout"}, {"id": "e1", "to": "n_done", "from": "n_agent_en", "outcome": "done"}, {"id": "e2", "to": "n_done", "from": "n_agent_en", "outcome": "out_of_scope"}, {"id": "e3", "to": "n_done", "from": "n_agent_en", "outcome": "wants_human"}, {"id": "e4", "to": "n_done", "from": "n_agent_en", "outcome": "failed"}, {"id": "e5", "to": "n_gone", "from": "n_agent_en", "outcome": "gone_quiet"}, {"id": "e6", "to": "n_gone", "from": "n_agent_en", "outcome": "timeout"}, {"id": "h1", "to": "n_done", "from": "n_agent", "outcome": "done"}, {"id": "h2", "to": "n_done", "from": "n_agent", "outcome": "out_of_scope"}, {"id": "h3", "to": "n_done", "from": "n_agent", "outcome": "wants_human"}, {"id": "h4", "to": "n_done", "from": "n_agent", "outcome": "failed"}, {"id": "h5", "to": "n_gone", "from": "n_agent", "outcome": "gone_quiet"}, {"id": "h6", "to": "n_gone", "from": "n_agent", "outcome": "timeout"}, {"id": "r1", "to": "n_done", "from": "n_agent_rt", "outcome": "done"}, {"id": "r2", "to": "n_done", "from": "n_agent_rt", "outcome": "out_of_scope"}, {"id": "r3", "to": "n_done", "from": "n_agent_rt", "outcome": "wants_human"}, {"id": "r4", "to": "n_done", "from": "n_agent_rt", "outcome": "failed"}, {"id": "r5", "to": "n_gone", "from": "n_agent_rt", "outcome": "gone_quiet"}, {"id": "r6", "to": "n_gone", "from": "n_agent_rt", "outcome": "timeout"}]}}'::jsonb, 0);

insert into templates (pack_id, kind, label, summary, payload, sort_order)
values ((select id from packs where slug = 'clinic-reception'), 'flow',
        'WhatsApp reception', 'Answers the call.',
        '{"name": "WhatsApp reception", "description": "", "trigger_event": "call.answered", "channel": "voice", "config": {}, "graph": {"nodes": [{"id": "trigger", "name": "Call answered", "type": "trigger", "config": {}, "position": {"x": -600, "y": 0}, "implementation": "trigger.call_answered"}, {"id": "n_agent", "name": "Reception", "type": "custom", "config": {"agent_id": "{{AGENT:WhatsApp reception}}", "timeout_seconds": 600}, "position": {"x": -100, "y": 0}, "implementation": "agent"}, {"id": "n_done", "name": "Finished", "type": "custom", "config": {"reason": "answered"}, "position": {"x": 400, "y": -120}, "implementation": "kookoo.hangup"}, {"id": "n_gone", "name": "Caller gone", "type": "custom", "config": {"reason": "abandoned"}, "position": {"x": 400, "y": 140}, "implementation": "kookoo.hangup"}], "start": "trigger", "version": 2, "variables": [], "transitions": [{"id": "t0", "to": "n_agent", "from": "trigger", "outcome": "started"}, {"id": "a1", "to": "n_done", "from": "n_agent", "outcome": "done"}, {"id": "a2", "to": "n_done", "from": "n_agent", "outcome": "out_of_scope"}, {"id": "a3", "to": "n_done", "from": "n_agent", "outcome": "wants_human"}, {"id": "a4", "to": "n_done", "from": "n_agent", "outcome": "failed"}, {"id": "a5", "to": "n_gone", "from": "n_agent", "outcome": "gone_quiet"}, {"id": "a6", "to": "n_gone", "from": "n_agent", "outcome": "timeout"}]}}'::jsonb, 1);
