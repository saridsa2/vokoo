-- Patients, cohorts, and enrolment.  (#3)
--
-- The product is a care path instantiated per patient across a cohort. Until
-- now **none of those three nouns was a row.** `select table_name from
-- information_schema.tables where table_schema = 'public'` returned 57 tables
-- and not one of them was `patients`, `cohorts` or an enrolment. `packs`
-- existed and nothing bound a pack to a population; `calls` is keyed to a
-- `phone_number_id` and a `provider_call_id` — to a line, never to a person.
--
-- So what was built is the spine: a platform that answers an inbound call,
-- resolves the number to a flow and walks it. Every one of the 69 rows in
-- `calls` is `direction = 'inbound'` and every one was placed by us for
-- testing. Nothing above the spine could be built before this.
--
-- ## Three tables, and why not fewer
--
-- A patient is not a member of one cohort. Somebody on a GLP-1 path can also be
-- postpartum, so identity is its own table and the enrolment is the join. And
-- the enrolment is not a plain join table: it carries `started_on`, which is
-- the column the whole product turns on.
--
-- ## `started_on` is the load-bearing column
--
-- Two patients on the same care path are at different points in it. Every
-- contact the path makes due is computed from the day that patient's path
-- began, not from a date on the cohort — a cohort-level start would make the
-- whole thing one campaign, which is precisely what this is not, and which is
-- what every journey builder in this category already does.
--
-- ## What this migration deliberately does not do
--
-- Nothing is scheduled and no call is placed. Enrolling a patient has no
-- observable effect beyond the row existing. That is #4.

-- ---- Patients --------------------------------------------------------------

create table if not exists public.patients (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references public.organizations(id) on delete cascade,

    full_name text not null,
    -- E.164, stored with the leading `+` as the console already stores a DID.
    -- `graph::spellings` exists in the bridge because a number was once looked
    -- up as `918040802529` while the console held `+918040802529`, and every
    -- escalation would have found nowhere to go. One spelling here.
    phone text not null,

    -- BCP-47, e.g. `hi-IN`. Null means the organisation's default rather than
    -- "unknown": both Sarvam services take their language when the socket
    -- opens, so a call cannot start without one being decided.
    language text,

    -- The hospital's own identifier. Without it a write-back has nothing to
    -- match on at the other end, and the outcome lands in a record nobody can
    -- reconcile.
    mrn text,

    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- One person, one row, per organisation. Enrolling them twice on two paths must
-- not create two patients — that is how a hospital ends up ringing the same
-- person about two things and knowing it is the same person nowhere.
create unique index if not exists patients_org_phone_idx
    on public.patients (org_id, phone);

create index if not exists patients_org_name_idx
    on public.patients (org_id, full_name);

comment on table public.patients is
    'A person a care path is followed for. Identity only — enrolment lives in cohort_patients, because one patient may be on several paths at once.';
comment on column public.patients.mrn is
    'The hospital''s own record number. What an outcome written back to their HIS is matched on.';

-- ---- Cohorts ---------------------------------------------------------------

create table if not exists public.cohorts (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references public.organizations(id) on delete cascade,

    name text not null,

    -- **The care path.** `not null`, and there is no join table, because a
    -- cohort is *defined* by exactly one path. A cohort holding patients on
    -- three different paths is the error this constraint exists to prevent, and
    -- it is an error that has already been made once — on the marketing page,
    -- where a "Chemotherapy cohort" listed a postpartum patient inside it.
    --
    -- `restrict` rather than `cascade`: deleting a flow that a live cohort is
    -- running would silently strand every patient on it.
    flow_id uuid not null references public.flows(id) on delete restrict,

    -- Where the path came from, when it came from a pack. Null for a path a
    -- department drew itself.
    pack_id uuid references public.packs(id) on delete set null,

    status text not null default 'draft'
        check (status in ('draft', 'running', 'paused')),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists cohorts_org_status_idx
    on public.cohorts (org_id, status);

comment on table public.cohorts is
    'One care path and the patients on it. The flow is the path and is not nullable: a cohort is defined by its path.';

-- ---- Enrolment -------------------------------------------------------------

create table if not exists public.cohort_patients (
    id uuid primary key default gen_random_uuid(),
    cohort_id uuid not null references public.cohorts(id) on delete cascade,
    patient_id uuid not null references public.patients(id) on delete cascade,

    -- Day 0 of *this patient's* path. See the note at the top of the file:
    -- this is the column the product turns on.
    started_on date not null,

    status text not null default 'active'
        check (status in ('active', 'completed', 'withdrawn')),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists cohort_patients_unique_idx
    on public.cohort_patients (cohort_id, patient_id);

-- What #4 will ask for: the active enrolments, oldest start first.
create index if not exists cohort_patients_due_idx
    on public.cohort_patients (cohort_id, status, started_on);

create index if not exists cohort_patients_patient_idx
    on public.cohort_patients (patient_id);

comment on column public.cohort_patients.started_on is
    'Day 0 of this patient''s path. Every due contact is computed from it, which is why enrolment is a table rather than an array on the cohort.';

-- ---- Row level security ----------------------------------------------------

alter table public.patients enable row level security;
alter table public.cohorts enable row level security;
alter table public.cohort_patients enable row level security;

drop policy if exists org_member_access on public.patients;
create policy org_member_access on public.patients
    for all using (public.is_org_member(org_id))
    with check (public.is_org_member(org_id));

drop policy if exists org_member_access on public.cohorts;
create policy org_member_access on public.cohorts
    for all using (public.is_org_member(org_id))
    with check (public.is_org_member(org_id));

-- `cohort_patients` carries no `org_id` of its own — denormalising one would be
-- a second source of truth that can disagree with the cohort's. It is reached
-- through the cohort instead, so the policy joins.
drop policy if exists org_member_access on public.cohort_patients;
create policy org_member_access on public.cohort_patients
    for all using (
        exists (
            select 1 from public.cohorts c
             where c.id = cohort_patients.cohort_id
               and public.is_org_member(c.org_id)
        )
    )
    with check (
        exists (
            select 1 from public.cohorts c
             where c.id = cohort_patients.cohort_id
               and public.is_org_member(c.org_id)
        )
    );

-- A patient may only be enrolled on a cohort in their own organisation. RLS
-- stops a *member of another org* reaching either row; it does not stop a
-- member of two organisations enrolling one org's patient on the other's
-- cohort, because they legitimately pass both checks.
create or replace function public.cohort_patient_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    cohort_org uuid;
    patient_org uuid;
begin
    select org_id into cohort_org from public.cohorts where id = new.cohort_id;
    select org_id into patient_org from public.patients where id = new.patient_id;
    if cohort_org is null or patient_org is null or cohort_org <> patient_org then
        raise exception 'a patient can only be enrolled on a cohort in their own organisation';
    end if;
    return new;
end;
$$;

drop trigger if exists cohort_patients_same_org on public.cohort_patients;
create trigger cohort_patients_same_org
    before insert or update on public.cohort_patients
    for each row execute function public.cohort_patient_same_org();

-- ---- Keeping `updated_at` honest -------------------------------------------

-- `set_updated_at` is the one 0001 defines and attaches to every other table.
drop trigger if exists set_patients_updated_at on public.patients;
create trigger set_patients_updated_at before update on public.patients
    for each row execute function public.set_updated_at();

drop trigger if exists set_cohorts_updated_at on public.cohorts;
create trigger set_cohorts_updated_at before update on public.cohorts
    for each row execute function public.set_updated_at();

drop trigger if exists set_cohort_patients_updated_at on public.cohort_patients;
create trigger set_cohort_patients_updated_at before update on public.cohort_patients
    for each row execute function public.set_updated_at();
