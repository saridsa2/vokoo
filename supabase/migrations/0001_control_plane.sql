create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'starter',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'developer', 'viewer')),
  display_name text,
  invited_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create or replace function public.is_org_member(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where org_id = target_org_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where org_id = target_org_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.create_control_plane_organization(p_name text, p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  created_org public.organizations;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if length(trim(p_name)) = 0 or p_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'invalid organization name or slug';
  end if;
  insert into public.organizations (name, slug)
  values (trim(p_name), lower(p_slug))
  returning * into created_org;
  insert into public.memberships (org_id, user_id, role)
  values (created_org.id, auth.uid(), 'owner');
  return to_jsonb(created_org);
end;
$$;

revoke all on function public.create_control_plane_organization(text, text) from public;
grant execute on function public.create_control_plane_organization(text, text) to authenticated;

create table if not exists public.assistants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  status text not null default 'draft',
  provider text not null default 'openai',
  model text not null default 'gpt-4.1-mini',
  system_prompt text not null default '',
  first_message text not null default '',
  voice_config jsonb not null default '{}'::jsonb,
  transcriber_config jsonb not null default '{}'::jsonb,
  analysis_config jsonb not null default '{}'::jsonb,
  compliance_config jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assistant_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  assistant_id uuid not null references public.assistants(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assistant_id, version)
);

create table if not exists public.tools (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  kind text not null default 'function',
  description text not null default '',
  endpoint_url text,
  schema jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assistant_tools (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  assistant_id uuid not null references public.assistants(id) on delete cascade,
  tool_id uuid not null references public.tools(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assistant_id, tool_id)
);

create table if not exists public.squads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text not null default '',
  graph jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'draft',
  graph jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  number text not null,
  label text not null default '',
  provider text not null default 'kookoo',
  assistant_id uuid references public.assistants(id) on delete set null,
  status text not null default 'inactive',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, number)
);

create table if not exists public.voices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  provider text not null,
  provider_voice_id text not null,
  language text not null default 'en-IN',
  preview_url text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider, provider_voice_id)
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  bucket text not null default 'knowledge',
  object_path text not null,
  mime_type text,
  size_bytes bigint,
  status text not null default 'processing',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket, object_path)
);

create table if not exists public.test_suites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  target_type text not null default 'assistant',
  target_id uuid,
  cases jsonb not null default '[]'::jsonb,
  last_run jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  kind text not null default 'rubric',
  rubric jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  severity text not null default 'medium',
  status text not null default 'open',
  source_type text,
  source_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.monitors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  event text not null,
  enabled boolean not null default true,
  rules jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifiers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  kind text not null default 'webhook',
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text not null default '',
  definition jsonb not null default '{"widgets":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  assistant_id uuid references public.assistants(id) on delete set null,
  phone_number_id uuid references public.phone_numbers(id) on delete set null,
  provider text not null default 'kookoo',
  provider_call_id text,
  direction text not null default 'inbound',
  from_number text,
  to_number text,
  status text not null default 'queued',
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  cost numeric(12, 6),
  transcript jsonb not null default '[]'::jsonb,
  analysis jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  assistant_id uuid references public.assistants(id) on delete set null,
  status text not null default 'active',
  messages jsonb not null default '[]'::jsonb,
  analysis jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.structured_outputs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text not null default '',
  schema jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.provider_credentials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  label text not null,
  secret_ref text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider, label)
);

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null,
  scopes text[] not null default '{}',
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations', 'memberships', 'assistants', 'assistant_versions', 'tools',
    'assistant_tools', 'squads', 'workflows', 'phone_numbers', 'voices', 'files',
    'test_suites', 'evaluations', 'issues', 'monitors', 'notifiers', 'boards',
    'calls', 'chats', 'structured_outputs', 'provider_credentials', 'api_keys'
  ] loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', table_name, table_name);
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end $$;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select using (public.is_org_member(id));

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations for update using (public.is_org_admin(id)) with check (public.is_org_admin(id));

drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select using (public.is_org_member(org_id));

drop policy if exists memberships_manage on public.memberships;
create policy memberships_manage on public.memberships for all using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'assistants', 'assistant_versions', 'tools', 'assistant_tools', 'squads',
    'workflows', 'phone_numbers', 'voices', 'files', 'test_suites', 'evaluations',
    'issues', 'monitors', 'notifiers', 'boards', 'calls', 'chats',
    'structured_outputs', 'provider_credentials', 'api_keys'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists org_member_access on public.%I', table_name);
    execute format(
      'create policy org_member_access on public.%I for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id))',
      table_name
    );
    execute format('create index if not exists %I on public.%I (org_id, updated_at desc)', table_name || '_org_updated_idx', table_name);
  end loop;
end $$;

create index if not exists memberships_user_idx on public.memberships (user_id, org_id);
create index if not exists calls_org_created_idx on public.calls (org_id, created_at desc);
create index if not exists calls_org_status_idx on public.calls (org_id, status);
create index if not exists chats_org_created_idx on public.chats (org_id, created_at desc);
create index if not exists issues_org_status_idx on public.issues (org_id, status, severity);

create or replace function public.control_plane_metrics(p_org_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'organization access denied';
  end if;
  select jsonb_build_object(
    'total_calls', count(*),
    'total_minutes', round(coalesce(sum(duration_seconds), 0)::numeric / 60, 2),
    'total_spend', round(coalesce(sum(cost), 0), 4),
    'average_call_seconds', round(coalesce(avg(duration_seconds), 0), 2),
    'success_rate', round(
      coalesce(100.0 * count(*) filter (where status in ('ended', 'completed')) / nullif(count(*), 0), 0),
      2
    ),
    'open_issues', (select count(*) from public.issues where org_id = p_org_id and status = 'open'),
    'active_assistants', (select count(*) from public.assistants where org_id = p_org_id and status = 'published')
  ) into result
  from public.calls
  where org_id = p_org_id;
  return result;
end;
$$;

revoke all on function public.control_plane_metrics(uuid) from public;
grant execute on function public.control_plane_metrics(uuid) to authenticated;

revoke all on public.provider_credentials from anon;
revoke all on public.api_keys from anon;
grant select, insert, update, delete on public.provider_credentials to authenticated;
grant select, insert, update, delete on public.api_keys to authenticated;
