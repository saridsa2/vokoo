-- An engine has two names, because it has two audiences.
--
-- 0091 stopped a tenant reading `engines.config`, and then handed them the name
-- and the description — which say:
--
--   Hindi relay (Sarvam)
--   "Sarvam listens and speaks; OpenAI thinks. Beat ElevenLabs on names, on
--    reference numbers and on latency."
--
-- Every vendor in the chain, and the finding that chose them. Hiding the config
-- and showing that is hiding nothing. The leak was found by reading what the
-- picker actually returned rather than by trusting that removing `config` was
-- enough.
--
-- `name` and `description` stay the operator's: they are how you tell two
-- engines apart while pricing them, and "beat ElevenLabs on latency" is exactly
-- the note worth keeping there. `public_name` and `public_description` are what
-- a customer sees.
--
-- ## Null means not offered
--
-- `available_engines` returns nothing for an engine with no `public_name`,
-- rather than falling back to the internal one. Falling back is how the leak
-- comes back the first time somebody adds an engine and does not think about
-- this file — the failure has to be an engine missing from a dropdown, which
-- somebody notices and fixes, not an engine appearing under the name of the
-- vendor it runs on, which nobody notices at all.

alter table engines
    add column if not exists public_name        text,
    add column if not exists public_description text;

comment on column engines.public_name is
    'What a customer sees. NULL means the engine is not offered to any workspace — deliberately, so a new engine is invisible until somebody names it rather than exposed under the vendor it runs on.';

comment on column engines.public_description is
    'One sentence for a customer, in terms of what the call sounds like. Never the vendors: that is what `description` is for.';

-- Written per engine rather than derived. A rule that strips "(Sarvam)" would
-- have left "Hindi relay" — which still says how it is built — and would say
-- nothing at all about the two whose vendor is only in the description.
update engines set
    public_name        = 'Hindi',
    public_description = 'Hindi and English in one call, with Indian names and numbers read back correctly.'
 where slug = 'hindi-relay-sarvam';

update engines set
    public_name        = 'English (India)',
    public_description = 'English for Indian callers — local names, numbers and place names.'
 where slug = 'english-relay-sarvam';

update engines set
    public_name        = 'Conversational',
    public_description = 'One voice that listens and speaks at once. The quickest to answer, and the one that can use your tools.'
 where slug = 'gemini-live-native-audio';

update engines set
    public_name        = 'Conversational (English)',
    public_description = 'One voice that listens and speaks at once, for English-only lines.'
 where slug = 'openai-realtime-english';

update engines set
    public_name        = 'Standard',
    public_description = 'A general-purpose voice line.'
 where slug = 'voice-engine';

-- `hindi-relay` is left unnamed on purpose: it is the older duplicate of
-- `hindi-relay-sarvam`, has carried no sessions, and offering a customer two
-- entries that do the same thing is worse than offering one. It stays in the
-- table so nothing pointing at it breaks, and out of every picker.

create or replace function available_engines(p_org uuid)
returns table (id uuid, name text, description text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not (is_org_member(p_org) or is_platform_admin() or caller_is_service_role()) then
        raise exception 'not a member of that organisation';
    end if;

    return query
    select e.id,
           e.public_name,
           coalesce(e.public_description, '')
      from engines e
     where e.status = 'published'
       -- Not offered until somebody has named it for a customer. See above:
       -- the safe failure is an absent option, not a leaked vendor.
       and e.public_name is not null
       and org_may(p_org, 'engine', e.id::text)
     order by e.public_name;
end;
$$;

revoke all on function available_engines(uuid) from public, anon;
grant execute on function available_engines(uuid) to authenticated, service_role;

comment on function available_engines is
    'The engines a workspace may attach to an agent, under their customer-facing names. Never the internal name, the description, the config or the mode — each of those says which vendor runs the call.';
