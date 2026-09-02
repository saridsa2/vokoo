-- Post-call flows: extract a shape from the call, send it somewhere.
--
-- A flow on `call.ended`, which has been a constant in `graph.rs`, a node type
-- in this catalogue and a bindable row in `number_flows` since the flow
-- vocabulary landed — and which nothing has ever resolved. `resolve_for_event`
-- is called with `call.answered` and `call.failed` and nothing else, so a
-- post-call flow could be drawn, published and bound, and would never run.
--
-- Two nodes make it useful. The shape they take is n8n's: a node says *what*,
-- and what it points at says *how*. n8n attaches that as a sub-node because a
-- workflow carries its own configuration; we point at a row instead, which is
-- what the agent node already does with `agent_id` and what an agent does with
-- `engine_id`. Same shielding, no new canvas machinery.

-- ------------------------------------------------------------- retention

-- How long a call's content is kept, decided by the business rather than by us.
--
-- A clinic and a travel agency answer this differently and both are right, so
-- it is a column and not a policy. Null means keep — which is what happens
-- today, and saying so is better than a default nobody chose.
--
-- It covers the call's *content*: transcript, analysis, recording url. Not the
-- call row itself, which is what billing and call volume are counted from and
-- carries nothing about what was said.
alter table public.organizations
  add column if not exists retention_days integer
    check (retention_days is null or retention_days > 0);

comment on column public.organizations.retention_days is
  'Days to keep a call''s transcript, analysis and recording url. Null keeps them indefinitely. The call row itself is not deleted — it is what billing counts.';

-- ------------------------------------------------------- node families

-- Which kind of flow a node type belongs on.
--
-- A post-call board must not offer `kookoo.transfer`: there is no caller left
-- to transfer. A call board must not offer `http.request`, because a blocking
-- HTTP call mid-conversation is what tools are for and what the 2s dispatcher
-- budget exists to bound.
--
-- An array because the generic ones belong to both — `condition` and `var` are
-- not about calls at all. Derived from the flow's trigger rather than stored on
-- the flow: `call.answered` and `call.failed` are live, `call.ended` is after,
-- so the board already knows which palette to show.
alter table public.catalogue_node_types
  add column if not exists families text[] not null default '{call}';

update public.catalogue_node_types set families = '{call,post_call}'
 where id in ('condition', 'loop', 'var', 'code');

update public.catalogue_node_types set families = '{post_call}'
 where id = 'trigger.call_ended';

-- --------------------------------------------------------- the two nodes

-- Read the call and fill in a shape.
--
-- The node names a shape and a model; it does not carry a prompt, a schema or a
-- provider's request format. That is the shielding: changing from MiniMax to
-- anything else is one field, the way changing a voice is.
--
-- `shape_id` points at `structured_outputs`, a table that has existed and been
-- empty since the schema was written, described exactly as this needs: a named
-- JSON schema extracted from conversations.
insert into public.catalogue_node_types (
  id, node_type, label, description, provider_action,
  outcomes, fields, suspends, default_timeout_seconds,
  sort_order, is_active, is_addable, families
) values (
  'intelligence',
  'custom',
  'Read the call',
  'Fill in a shape from what was said, using a model. The result is written to the call before anything is sent anywhere.',
  'intelligence',
  '[{"id": "ok",      "label": "Filled in"},
    {"id": "empty",   "label": "Nothing to read"},
    {"id": "failed",  "label": "The model could not"}]'::jsonb,
  '[{"key": "shape_id", "type": "structured_output", "label": "Shape to fill", "required": true,
     "help": "A named JSON schema. Define it once and every flow that needs it points here."},
    {"key": "provider", "type": "text", "label": "Provider", "required": false, "default": "minimax"},
    {"key": "model", "type": "text", "label": "Model", "required": false, "default": "MiniMax-M2",
     "help": "Pre-flight is the only check — MiniMax publishes no model list."},
    {"key": "instruction", "type": "text", "label": "Extra instruction", "required": false,
     "help": "Anything the shape''s own field descriptions do not say."}]'::jsonb,
  false,
  30,
  20,
  true,
  true,
  '{post_call}'
)
on conflict (id) do update set
  label = excluded.label, description = excluded.description,
  outcomes = excluded.outcomes, fields = excluded.fields,
  families = excluded.families, is_active = excluded.is_active;

-- Send it somewhere.
--
-- Deliberately after the intelligence node writes its result to the call: the
-- extraction is persisted before delivery is attempted, so a bridge restart
-- loses the send and never the data. That is most of what a durable queue buys,
-- for none of the machinery — and the queue can arrive the first time an outage
-- actually costs something.
insert into public.catalogue_node_types (
  id, node_type, label, description, provider_action,
  outcomes, fields, suspends, default_timeout_seconds,
  sort_order, is_active, is_addable, families
) values (
  'http.request',
  'custom',
  'Send a webhook',
  'POST the filled-in shape to another system.',
  'http_request',
  -- `refused` and `unavailable` are apart because they retry differently: a 4xx
  -- means the payload is wrong and retrying it a hundred times is a bug that
  -- looks like resilience, while a 5xx is theirs and worth trying again.
  '[{"id": "ok",          "label": "Accepted"},
    {"id": "refused",     "label": "Refused (4xx) — the payload is wrong"},
    {"id": "unavailable", "label": "Unavailable (5xx) — try later"},
    {"id": "failed",      "label": "Could not reach it"}]'::jsonb,
  '[{"key": "url", "type": "text", "label": "URL", "required": true},
    {"key": "method", "type": "text", "label": "Method", "required": false, "default": "POST"},
    {"key": "secret_vendor", "type": "text", "label": "Credential", "required": false,
     "help": "A connected provider key, sent as a bearer token. Never type a key here."},
    {"key": "body", "type": "text", "label": "Body", "required": false,
     "help": "Leave empty to send the filled-in shape. Or write JSON with {{ }} to reference it."}]'::jsonb,
  false,
  20,
  21,
  true,
  true,
  '{post_call}'
)
on conflict (id) do update set
  label = excluded.label, description = excluded.description,
  outcomes = excluded.outcomes, fields = excluded.fields,
  families = excluded.families, is_active = excluded.is_active;

-- ------------------------------------------------------------- minimax

insert into public.catalogue_vendors (id, label, kind, description, help_url)
values ('minimax', 'MiniMax', 'llm',
        'Reads finished calls and fills in a shape. Transcripts are sent to MiniMax for processing.',
        'https://platform.minimax.io/')
on conflict (id) do nothing;

-- OpenAI-compatible at `https://api.minimax.io/v1/chat/completions` with bearer
-- auth, so it is a host and a key rather than an integration — the same shape
-- Groq and NVIDIA take.
--
-- **It publishes no `/models` endpoint**, so discovery cannot enumerate it and
-- these are hand-entered from the vendor's documentation. That is the exact
-- situation that put Sarvam's retired `bulbul:v2` in front of a caller, so
-- pre-flight is the only thing standing between a wrong name here and a
-- post-call flow that fails silently.
insert into public.catalogue_engine_stages (id, stage, provider_id, vendor_id, label, tagline, models, supports_tools, is_active)
values ('llm:minimax', 'llm', 'minimax', 'minimax', 'MiniMax', 'OpenAI-compatible',
        '[{"id": "MiniMax-M2", "label": "MiniMax-M2"},
          {"id": "MiniMax-M2.1", "label": "MiniMax-M2.1"},
          {"id": "MiniMax-M2.5", "label": "MiniMax-M2.5"},
          {"id": "MiniMax-M3", "label": "MiniMax-M3"}]'::jsonb,
        false, true)
on conflict (id) do nothing;
