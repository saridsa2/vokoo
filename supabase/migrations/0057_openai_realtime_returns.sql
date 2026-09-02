-- OpenAI Realtime comes back, now that it can call tools.
--
-- Migration 0045 withdrew it on a rule that still holds — an engine which
-- cannot call tools is not supported — and on a fact that no longer does:
-- `OpenAIRealtimeConfig` had no functions field, so every skill an agent
-- granted would have been silently unreachable, and `finish_call` with it, so
-- a flow would have sat at its agent node until the timeout.
--
-- All three halves of that are now implemented, against OpenAI's own
-- documentation rather than recollection:
--
--   declaring   `session.tools[]` with `session.tool_choice`, flat —
--               `{type, name, description, parameters}`, not the nested
--               `{type:"function", function:{..}}` chat completions takes.
--   receiving   `response.done` carries the call as an output item with
--               `type:"function_call"`, `name`, `call_id` and `arguments` as a
--               JSON **string**. That event used to map to `TurnComplete` and
--               the payload was discarded.
--   answering   `conversation.item.create` with
--               `{type:"function_call_output", call_id, output}` where output
--               is the serialised string, then a separate `response.create` —
--               without which the model holds the answer and never speaks it.
--
-- Four tests pin those shapes so they cannot drift back.

update public.catalogue_engine_stages
   set is_active = true,
       supports_tools = true
 where id = 'realtime:openai';

-- Models are **not** seeded here. `POST /catalogue/refresh` asks OpenAI what it
-- currently serves and filters its model list for realtime ones, excluding the
-- translate and transcribe variants that cannot hold a conversation. A
-- hand-typed list is what put Sarvam's retired `bulbul:v2` in front of a caller
-- on 1 September; the rule that came out of that was to ask the provider, and
-- this follows it.
--
-- Voices are a different matter: OpenAI publishes no voices endpoint, so
-- discovery cannot help and pre-flight is the only check. Only `alloy` is
-- seeded — the value the handler already defaults to, and therefore the one
-- value known to work. The rest belong here once somebody reads them off the
-- provider's own page; offering an unverified name would put a call one
-- dropdown away from failing.
-- `catalogue_providers` is the realtime-provider catalogue that
-- `catalogue_models` and `catalogue_voices` key on. It had only gemini and
-- local, so nothing about OpenAI could be stored there at all.
-- The summary is the same warning the Gemini row carries, because the fact is
-- the same one: caller audio leaves the country. A clinic choosing an engine
-- should read that where the choice is made, not find it later.
insert into public.catalogue_providers
    (id, label, summary, inference_location, is_sovereign, tagline, realtime_url)
values (
    'openai',
    'OpenAI',
    'Caller audio is sent to OpenAI for processing. Review this against your data protection obligations before using it for patient or customer calls.',
    'openai_cloud',
    false,
    'OpenAI',
    'wss://api.openai.com/v1/realtime'
)
on conflict (id) do nothing;

insert into public.catalogue_voices (id, provider_id, label, engine)
values ('openai-alloy', 'openai', 'alloy', 'realtime')
on conflict (id) do nothing;

-- The realtime rate rows carry a warning rather than a number.
--
-- Realtime meters audio tokens and text tokens separately in each direction,
-- and cached input tokens at a reduced rate — `response.done` breaks all three
-- out in `input_token_details` / `output_token_details`. `BillingEvent::LlmUsage`
-- carries two numbers, so only the totals are stored and the split is logged.
-- Pricing those totals at a single per-token rate would be wrong by roughly an
-- order of magnitude on an audio call, which is exactly the confidently wrong
-- invoice this table was shaped to prevent.
update public.catalogue_vendor_rates
   set notes = 'DO NOT PRICE YET — realtime bills audio, text and cached tokens at different '
               'rates and only the totals are recorded. Needs input_audio_token / '
               'input_text_token / input_cached_token units and an event that can carry them. '
               'Sanity check: user audio is 1 token per 100ms, assistant audio 1 per 50ms.'
 where stage = 'realtime';
