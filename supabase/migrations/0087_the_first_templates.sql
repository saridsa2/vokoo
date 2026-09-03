-- The first templates, taken from engines that have carried real calls.
--
-- Not invented. `Hindi relay (Sarvam)` and `Gemini Live (native audio)` are the
-- two shapes this platform has actually run — a cascading relay and a native
-- audio model — and the Sarvam chain is here because Sarvam beat ElevenLabs at
-- both ends on measured calls, which is the finding that makes the platform
-- template worth having.
--
-- **The platform engine carries no clinic-specific prompt.** Vayuveda's own
-- carries "Vayuveda clinic, Hyderabad. Cardiologist, dermatologist..." as an
-- STT hint, which is right for Vayuveda and wrong seeded into a law firm. A
-- template is the chain, not somebody's business.

insert into templates (kind, audience, label, summary, payload, sort_order) values

-- The operator's own. A workspace on platform keys gets this and cannot see
-- inside it.
('engine', 'platform', 'Indian English relay',
 'Sarvam at both ends, OpenAI in the middle. Chosen on measured calls: Sarvam reads reference codes and Indian names correctly where narration-trained models do not.',
 jsonb_build_object(
   'name', 'Voice engine',
   'slug', 'voice-engine',
   'description', 'Provided by Sarvathra.',
   'mode', 'cascading',
   'config', jsonb_build_object(
     'language', 'en-IN',
     'stt', jsonb_build_object('provider','sarvam','model','saaras:v3','language','en-IN','mode','codemix'),
     'llm', jsonb_build_object('provider','openai','model','gpt-4.1-mini','temperature',0.4,'max_tokens',120),
     'tts', jsonb_build_object('provider','sarvam','model','bulbul:v3','voice','ritu','language','en-IN')
   )
 ), 0),

-- A plain starting point for somebody bringing their own keys. One provider,
-- nothing tuned — they are buying the platform, not the chain.
('engine', 'byo', 'Starter engine',
 'A single native-audio model. A starting point to point at your own keys and change.',
 jsonb_build_object(
   'name', 'Starter engine',
   'slug', 'starter-engine',
   'description', 'Edit this to suit your own providers.',
   'mode', 'realtime',
   'config', jsonb_build_object(
     'realtime', jsonb_build_object('provider','gemini','model','gemini-live-2.5-flash','voice','Aoede','temperature',0.4)
   )
 ), 0),

-- Onboarding, not intellectual property, so both audiences get it. The prompt
-- is deliberately generic and says so: a starter agent that pretends to know
-- the business would answer a caller with something untrue.
('agent', 'both', 'Reception',
 'Answers the phone, takes a message, hands over when asked.',
 jsonb_build_object(
   'name', 'Reception',
   'provider', '',
   'model', '',
   'first_message', 'Thanks for calling. How can I help you today?',
   'system_prompt', 'You answer the phone for this business. You do not yet know its hours, services or staff — say so plainly if asked, and offer to take a message rather than guessing. Keep replies to one or two sentences, because the caller is listening rather than reading. If the caller asks for a person, or is upset, or you are asked something you cannot answer, call finish_call with the outcome wants_human.'
 ), 0),

-- A graph with one agent node. `{{AGENT_ID}}` is substituted at seeding: the
-- agent does not exist until the workspace does, and a template carrying a real
-- id would only work for one tenant.
('flow', 'both', 'Answer the phone',
 'The flow a call arrives at. One node: hand the caller to Reception.',
 jsonb_build_object(
   'name', 'Answer the phone',
   'description', 'Seeded with the workspace. Edit it on the Calls board.',
   'trigger_event', 'call.answered',
   'channel', 'voice',
   'graph', jsonb_build_object(
     'nodes', jsonb_build_array(
       jsonb_build_object('id','start','type','trigger.call_answered','name','Call answered','config', '{}'::jsonb),
       jsonb_build_object('id','agent','type','agent','name','Reception',
                          'config', jsonb_build_object('agent','{{AGENT_ID}}','timeout_seconds',600))
     ),
     'edges', jsonb_build_array(
       jsonb_build_object('from','start','to','agent','outcome','answered')
     )
   )
 ), 0);
