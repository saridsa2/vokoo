-- Two things a tool and a schema both need: a reference, and a lock.
--
-- ---------------------------------------------------------------- reference
--
-- A tool may name a registry schema as its input. Two columns, always both:
--
--   schema_id  the reference — what the author said
--   schema     the snapshot  — what was pushed, and what the model is shown
--
-- The reference is a plain id, so a tool written in a file and a tool drawn on
-- a canvas produce the identical thing. The alternative was resolving a
-- TypeScript import at push time and inlining it, which works perfectly until a
-- tool has no TypeScript — at which point the composer needs a second way to
-- say the same thing and the registry has two dialects. **The authoring format
-- must never be load-bearing**: anything the push has to parse to understand a
-- relationship is a thing a canvas cannot produce.
--
-- The snapshot stays because a pushed tool's contract has to be concrete. And
-- keeping both is what makes drift visible: editing a schema can say which
-- tools were pushed against an older version of it, which neither column
-- answers alone.

alter table public.tools
  add column if not exists schema_id uuid references public.structured_outputs(id) on delete set null;

comment on column public.tools.schema_id is
  'The registry schema this tool names as its input, if any. `schema` remains the compiled snapshot that was pushed.';

-- `on delete set null`, not cascade: deleting a schema must not delete the
-- tools that referenced it. They keep their snapshot and go on working, and the
-- null says the reference is gone — a thing to report, not a reason to take a
-- working tool off a live line.
create index if not exists tools_schema_id_idx on public.tools (schema_id) where schema_id is not null;

-- ------------------------------------------------------------------- lock
--
-- Anything synced from the CLI is locked unless the author says otherwise.
--
-- The SDK spec already states the rule — "the source is shown and not edited; a
-- pushed tool's authority is a repository" — and nothing enforced it. A console
-- edit to a pushed tool was accepted and then silently discarded by the next
-- push. That is the worst shape a failure can take: it looks like it worked.
--
-- `locked = false` is a deliberate choice by whoever pushed, and a real one: a
-- developer scaffolds a schema and wants the team to refine the field
-- descriptions where they can see the calls.
--
-- Enforced here rather than in the console, because a rule the UI merely
-- honours is one the next screen forgets.

alter table public.tools
  add column if not exists locked boolean not null default false;
alter table public.structured_outputs
  add column if not exists locked boolean not null default false;

comment on column public.tools.locked is
  'Authored elsewhere — pushed from the CLI. Refused for editing in the console, because the next push would overwrite the edit without saying so. Set false in the source to allow console edits.';
comment on column public.structured_outputs.locked is
  'Authored elsewhere — pushed from the CLI. See tools.locked.';

/*
 * Refuse a console edit to a locked row.
 *
 * The push RPCs are the one writer allowed through, and they say so with a
 * transaction-local setting rather than by being recognised — a trigger that
 * checked `current_user` would be defeated by anything else running as the
 * same definer, and a trigger that checked the row's shape would be guessing.
 *
 * `locked` itself is always writable: a push must be able to unlock a row whose
 * source now says `locked: false`, and somebody has to be able to adopt one.
 */
create or replace function public.refuse_locked_edit()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('vokoo.pushing', true), '') = 'on' then
    return new;
  end if;

  -- Unchanged rows are not edits. An UPDATE that touches nothing happens on
  -- every idempotent write and must not be an error.
  if to_jsonb(new) - 'locked' - 'updated_at' is not distinct from to_jsonb(old) - 'locked' - 'updated_at' then
    return new;
  end if;

  if old.locked then
    raise exception
      '% is authored elsewhere and locked — edit it where it is written, or push it with locked: false',
      coalesce(new.name, old.name)
      using errcode = 'P0005';
  end if;

  return new;
end;
$$;

drop trigger if exists tools_refuse_locked_edit on public.tools;
create trigger tools_refuse_locked_edit
  before update on public.tools
  for each row execute function public.refuse_locked_edit();

drop trigger if exists structured_outputs_refuse_locked_edit on public.structured_outputs;
create trigger structured_outputs_refuse_locked_edit
  before update on public.structured_outputs
  for each row execute function public.refuse_locked_edit();
