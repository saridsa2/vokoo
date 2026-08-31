-- Gemini 3.1 Flash Live, into the catalogue.
--
-- The published agent already names `gemini-3.1-flash-live-preview`, and the
-- bridge already runs `LIVE_MODEL=models/gemini-3.1-flash-live-preview`. Only
-- the catalogue was missing the row, so the console showed "Unknown model" and
-- left the Model field unselected while the call path worked.
--
-- `id` has to match `agents.model` exactly: the console resolves a model with
-- `catalogue.models.find((model) => model.id === id)`.
--
-- The model id was read from the provider rather than composed by hand —
-- `GET /v1beta/models` filtered on `bidiGenerateContent` returns seven models,
-- and `models/gemini-3.1-flash-live-preview` is among them. Composing an id
-- that looked right is how `models/gemini-live-2.5-flash-preview` came to be
-- wrong.
--
-- `context_tokens` is the provider's `inputTokenLimit`. `supports_tools` is
-- evidenced rather than assumed: this model is what ran the call whose trace
-- shows the agent node returning `wants_human`, which requires the tool call to
-- have been made. `native_audio` and `supports_structured_output` are carried
-- across from the 2.5 Live row and have not been verified against the provider.

begin;

insert into public.catalogue_models (
  id, provider_id, label, summary, tagline,
  native_audio, supports_tools, supports_structured_output,
  context_tokens, latency_class, sort_order, is_active, provider_model_id
) values (
  'gemini-3.1-flash-live-preview',
  'gemini',
  'Gemini 3.1 Flash Live',
  'Native audio and function calling, processed by Google. A preview model: Google may change or withdraw it.',
  'Native audio · tools · preview',
  true, true, true,
  131072, 'network', 0, true,
  'models/gemini-3.1-flash-live-preview'
)
on conflict (id) do update set
  provider_id                = excluded.provider_id,
  label                      = excluded.label,
  summary                    = excluded.summary,
  tagline                    = excluded.tagline,
  native_audio               = excluded.native_audio,
  supports_tools             = excluded.supports_tools,
  supports_structured_output = excluded.supports_structured_output,
  context_tokens             = excluded.context_tokens,
  latency_class              = excluded.latency_class,
  sort_order                 = excluded.sort_order,
  is_active                  = excluded.is_active,
  provider_model_id          = excluded.provider_model_id;

-- The newer model leads the list; 2.5 Live keeps its place behind it.
update public.catalogue_models
   set sort_order = 1
 where id = 'gemini-live-2.5-flash';

commit;
