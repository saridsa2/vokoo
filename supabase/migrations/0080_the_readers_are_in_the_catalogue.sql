-- The models that can read a finished call.
--
-- `organizations.intelligence_provider` and `intelligence_model` were free text
-- on the settings screen, which is the shape that has hurt this project before:
-- a relay was published on Sarvam's `bulbul:v2` months after Sarvam retired it,
-- the call connected and thought and the caller heard silence. A typed model id
-- is a call that fails at the moment nobody is watching.
--
-- So they come from `catalogue_models`, like every other model in the console.
--
-- ## Provenance, because these were not all found the same way
--
-- **Anthropic publishes `GET /v1/models`.** Discovery can and should own these;
-- they are seeded here so the dropdown works today, and a refresh will
-- overwrite them with whatever the provider actually offers.
--
-- **MiniMax publishes no models endpoint.** This is the Sarvam situation
-- exactly, and CLAUDE.md already names it: "Discovery only covers providers
-- that publish a list — Sarvam publishes none, which is exactly the provider
-- that broke." So the MiniMax row is hand-maintained, and the only thing that
-- will catch it going stale is a post-call reading failing.
--
-- **There is no pre-flight for this provider.** `POST /engine/preflight` builds
-- and runs the real processors for an *engine*; nothing does the equivalent for
-- the workspace's reader, so a wrong model here is discovered when a call ends.
-- Worth building, and named here rather than left to be rediscovered.

-- Both providers have to exist before their models can. `catalogue_providers`
-- carries only the three that answer a *live* call, because that is all it has
-- ever needed to: a reader is a different job and reached the database by a
-- different door (`organizations.intelligence_provider`, free text).
--
-- The summaries follow the convention the existing rows set — where the audio
-- goes, said plainly, so somebody weighing a data protection obligation can
-- read it off the row rather than infer it from a brand.
insert into catalogue_providers
    (id, label, summary, inference_location, is_sovereign, sort_order, is_active, tagline)
values
    ('minimax', 'MiniMax',
     'Finished transcripts are sent to MiniMax for reading. Nothing is sent while a caller is on the line — this runs after the call has ended.',
     'minimax_cloud', false, 2, true, 'MiniMax Cloud'),
    ('anthropic', 'Anthropic',
     'Finished transcripts are sent to Anthropic for reading. Nothing is sent while a caller is on the line — this runs after the call has ended.',
     'anthropic_cloud', false, 3, true, 'Anthropic Cloud')
on conflict (id) do update
    set label   = excluded.label,
        summary = excluded.summary;

insert into catalogue_models
    (id, provider_id, label, summary, native_audio, supports_tools,
     supports_structured_output, context_tokens, latency_class, sort_order,
     is_active, tagline, provider_model_id)
values
    -- MiniMax. The workspace default, and the one that has actually read a
    -- call: it filled a six-field shape from a twelve-line Hindi transcript.
    -- Serves the Anthropic Messages API shape at api.minimax.io/anthropic/v1,
    -- which is what lets one client talk to both.
    ('MiniMax-M2', 'minimax', 'MiniMax M2',
     'Reads a finished call and fills in a shape. A reasoning model, so the shape is held by a forced tool call rather than by parsing its reply.',
     false, true, true, 200000, 'network', 0, true,
     'Default reader · Messages API', 'MiniMax-M2'),

    -- Anthropic. Seeded so the dropdown has more than one provider; discovery
    -- should replace these the first time it runs against a connected key.
    ('claude-sonnet-4-5', 'anthropic', 'Claude Sonnet 4.5',
     'Reads a finished call and fills in a shape. Forced tool call, so the arguments arrive as JSON by construction.',
     false, true, true, 200000, 'network', 1, true,
     'Balanced', 'claude-sonnet-4-5'),

    ('claude-haiku-4-5', 'anthropic', 'Claude Haiku 4.5',
     'The cheaper reader. Nobody is waiting on a post-call reading, so speed matters less here than it does on a live call.',
     false, true, true, 200000, 'network', 2, true,
     'Cheapest', 'claude-haiku-4-5')
on conflict (id) do update
    set provider_id       = excluded.provider_id,
        label             = excluded.label,
        summary           = excluded.summary,
        tagline           = excluded.tagline,
        provider_model_id = excluded.provider_model_id,
        is_active         = true;

comment on table catalogue_models is
    'Every model the console offers, live or post-call. Discovery owns the providers that publish a list; the rest are hand-maintained and say so in their migration.';
