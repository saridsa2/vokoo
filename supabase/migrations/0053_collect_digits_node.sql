-- Ask the caller to press a key, and branch on which one.
--
-- The first node whose outcomes it does not declare. `outcomes_from` points at
-- the `digits` field, so the branches are whatever the flow's author wrote —
-- three for a language menu, five for a department one — and `timeout` is the
-- single outcome the type can name in advance.
--
-- Why the keypad and not the microphone: the language a caller picks has to be
-- known *before* the engine connects. Sarvam takes its language when the socket
-- opens (`SarvamSttConfig.language`, `SarvamTtsConfig.language`), so a tool
-- firing mid-call would leave the ear and the mouth in the old language while
-- the model wrote in the new one. Collecting a digit before the agent node
-- means each branch reaches its own agent with its own engine, and every socket
-- opens in the right language. Nothing reconnects.
--
-- `suspends` is true for the same reason the agent node is: the flow stops here
-- and resumes on something the caller does. It differs in where it waits — the
-- agent node waits with the audio pipeline up, this one waits with no pipeline
-- at all, because `<collectdtmf>` is answered between streams.

insert into public.catalogue_node_types (
  id, node_type, label, description, provider_action,
  outcomes, outcomes_from, fields,
  suspends, default_timeout_seconds, sort_order, is_active, is_addable
) values (
  'kookoo.collect_digits',
  'custom',
  'Ask for a keypress',
  'Play a prompt and wait for the caller to press a key, then leave by the branch for that key.',
  'collect_digits',
  '[{"id": "timeout", "label": "No key pressed"}]'::jsonb,
  'digits',
  '[
     {"key": "prompt", "type": "text", "label": "What the caller hears", "required": true,
      "help": "Spoken by the carrier, before any engine exists. Say the options and their keys."},
     {"key": "language", "type": "text", "label": "Prompt language", "required": false,
      "default": "en-IN", "hint": "en-IN, hi-IN, te-IN, ta-IN…"},
     {"key": "digits", "type": "branches", "label": "Keys", "required": true,
      "help": "One branch per key. The board draws a path out of this node for each."},
     {"key": "attempts", "type": "number", "label": "Attempts", "required": false, "default": 1,
      "help": "How many times to repeat the prompt before leaving by No key pressed."}
   ]'::jsonb,
  true,
  8,
  14,
  true,
  true
)
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description,
  provider_action = excluded.provider_action,
  outcomes = excluded.outcomes,
  outcomes_from = excluded.outcomes_from,
  fields = excluded.fields,
  suspends = excluded.suspends,
  default_timeout_seconds = excluded.default_timeout_seconds,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  is_addable = excluded.is_addable;
