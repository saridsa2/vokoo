-- A locked row told everyone to go and edit it in a repository, including the
-- rows that were written here.
--
-- `origin` was added precisely because `locked` cannot say whose a thing is:
-- a console schema may be unlocked in the console, a pushed one may not. The
-- refusal message never learned that. Editing a locked console-made schema
-- said "authored elsewhere and locked — edit it where it is written", pointing
-- at a repository that does not exist, when the answer was a button on the
-- screen the reader was already looking at.
--
-- Found because a locked `Clinic lead` — `origin = console` — refused an edit
-- with that message, and the message is what made the lock look permanent.
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
    -- The same refusal, but it now says where the unlock is. Which one applies
    -- is what `origin` is for.
    if old.origin = 'push' then
      raise exception
        '% is authored in a repository and locked — edit it there, or push it with locked: false',
        coalesce(new.name, old.name)
        using errcode = 'P0005';
    end if;
    raise exception
      '% is locked. Unlock it to edit it — it was written here, so it can be unlocked here',
      coalesce(new.name, old.name)
      using errcode = 'P0005';
  end if;

  return new;
end;
$$;
