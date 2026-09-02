-- Where a thing came from, which is not the same as whether it is locked.
--
-- `locked` says whether the console may edit it. `origin` says who it belongs
-- to. Conflating them left a hole: the lock trigger deliberately allowed
-- `locked` itself to be written — a push has to be able to unlock a row whose
-- source now says `locked: false` — which also let the console unlock a
-- CLI-pushed schema, edit it, and lose the edit on the next push regardless.
-- The lock was a suggestion.
--
-- With origin the rule can be said properly:
--
--   console-origin   the console may lock and unlock it freely. Locking one is
--                    a way to say "this is settled, do not edit it by accident",
--                    and unlocking it is the same person changing their mind.
--   push-origin      the console may not unlock it. Its authority is a
--                    repository, and taking it over means saying so there —
--                    `locked: false` in the file, or deleting the file.

alter table public.structured_outputs
  add column if not exists origin text not null default 'console'
    check (origin in ('console', 'push'));
alter table public.tools
  add column if not exists origin text not null default 'console'
    check (origin in ('console', 'push'));

comment on column public.structured_outputs.origin is
  'console = written here. push = arrived from a repository via the CLI, and only a push may unlock it.';
comment on column public.tools.origin is
  'console = made here. push = arrived from a repository via the CLI, and only a push may unlock it.';

-- Anything already carrying a version came from a push.
update public.tools set origin = 'push' where current_version is not null;

create or replace function public.refuse_locked_edit()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('vokoo.pushing', true), '') = 'on' then
    return new;
  end if;

  -- An UPDATE that changes nothing is not an edit, and happens on every
  -- idempotent write.
  if to_jsonb(new) - 'locked' - 'updated_at' is not distinct from to_jsonb(old) - 'locked' - 'updated_at' then
    -- Except when it is the lock itself moving, which is the one field this
    -- comparison ignores and therefore has to judge separately.
    if new.locked is distinct from old.locked and old.origin = 'push' then
      raise exception
        '% came from a repository — unlock it at the source with locked: false, or delete the file to take it over here',
        coalesce(new.name, old.name)
        using errcode = 'P0005';
    end if;
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
