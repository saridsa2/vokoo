-- `cohort_patients` carries `org_id` after all.  (#3)
--
-- 0110 left it off deliberately, on the reasoning that a denormalised copy is a
-- second source of truth that can disagree with the cohort's. Testing the API
-- showed that to be the wrong call for two reasons.
--
-- **It broke every insert.** `create_resource` in the control plane injects the
-- caller's `org_id` into the body of every write, which is how the whole
-- resource layer works. PostgREST answered `PGRST204: could not find the
-- 'org_id' column of 'cohort_patients' in the schema cache`, so a patient could
-- be created and a cohort could be created and the two could never be joined.
--
-- **And the objection does not survive contact.** A copy is only a second truth
-- if something can write it independently. Here a trigger sets it from the
-- cohort and refuses any value that disagrees, so it is derived rather than
-- duplicated — the same shape as the check that was already there, moved one
-- step earlier.
--
-- What it buys beyond the insert working: RLS becomes a direct
-- `is_org_member(org_id)` rather than a subquery per row, and the cross-org
-- guard from 0110 stops needing its own lookup because the mismatch cannot be
-- represented.

alter table public.cohort_patients
    add column if not exists org_id uuid references public.organizations(id) on delete cascade;

-- Backfill from the cohort. There are no rows today; this is here so the
-- migration is correct if it is ever run against an instance that has some.
update public.cohort_patients cp
   set org_id = c.org_id
  from public.cohorts c
 where c.id = cp.cohort_id
   and cp.org_id is distinct from c.org_id;

alter table public.cohort_patients
    alter column org_id set not null;

create index if not exists cohort_patients_org_idx
    on public.cohort_patients (org_id, created_at desc);

comment on column public.cohort_patients.org_id is
    'Derived from the cohort by trigger, never written by a caller. Present so the generic resource layer can insert, and so RLS is a direct check rather than a join.';

-- ---- Derived, and refusing to disagree -------------------------------------

-- Replaces `cohort_patient_same_org` from 0110. That function compared the two
-- orgs and raised; this one *sets* the column from the cohort and only raises
-- when the patient belongs somewhere else. A caller may send `org_id` — the
-- control plane always does — and it is overwritten rather than trusted.
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
    if cohort_org is null then
        raise exception 'no such cohort' using errcode = '23503';
    end if;

    select org_id into patient_org from public.patients where id = new.patient_id;
    if patient_org is null then
        raise exception 'no such patient' using errcode = '23503';
    end if;

    if patient_org <> cohort_org then
        raise exception 'a patient can only be enrolled on a cohort in their own organisation'
            using errcode = '23514';
    end if;

    -- Whatever the caller sent, the cohort decides.
    new.org_id := cohort_org;
    return new;
end;
$$;

-- ---- RLS, now a direct check -----------------------------------------------

drop policy if exists org_member_access on public.cohort_patients;
create policy org_member_access on public.cohort_patients
    for all using (public.is_org_member(org_id))
    with check (public.is_org_member(org_id));
