-- The push identifies itself for its own body, and no longer.
--
-- `set_config('vokoo.pushing', 'on', true)` is transaction-local, which is
-- narrow enough in production — the control plane makes one RPC per request —
-- and not narrow enough to be a rule. Anything running in the same transaction
-- after a push inherited permission to edit locked rows.
--
-- Found by testing the lock rather than reasoning about it: a script that
-- pushed and then tried a console-style edit in one transaction had the edit
-- accepted, and printed "FAIL — the edit was accepted".
--
-- Turning it off before returning makes the window the push body itself. An
-- exception still leaves it set, which is harmless: the transaction aborts and
-- the setting dies with it.

create or replace function public.end_push()
returns void
language plpgsql
as $$
begin
  perform set_config('vokoo.pushing', 'off', true);
end;
$$;

comment on function public.end_push() is
  'Closes the window in which a push may write locked rows. Called before every successful return from push_functions and push_schemas.';
