-- The billing views must run as whoever queries them, not as their owner.
--
-- A Postgres view executes with the privileges of the role that *owns* it
-- unless `security_invoker` is set. These four were created by `postgres`, so
-- every one of them read the underlying tables with row-level security bypassed
-- — and `grant select ... to authenticated` in 0055 then handed that to every
-- signed-in user of every organisation. Costs, token counts and call volumes
-- for the whole instance, from any account.
--
-- This is the same shape as the two holes closed on 1 September:
-- `resolve_vendor_secret` and `compose_agent_tools` were `SECURITY DEFINER`
-- functions granted to `anon`. The lesson did not transfer on its own, because
-- a view does not say `SECURITY DEFINER` anywhere — it is the default, and the
-- default is the dangerous one. **Any view added over a table with RLS needs
-- this line.**
--
-- Caught before anything read them, by checking rather than assuming:
--
--   select relname, reloptions from pg_class where relkind = 'v';

alter view public.billing_usage        set (security_invoker = on);
alter view public.billing_priced_usage set (security_invoker = on);
alter view public.call_costs           set (security_invoker = on);
alter view public.engine_costs         set (security_invoker = on);
