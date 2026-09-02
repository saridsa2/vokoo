-- The executable half of a tool version.
--
-- `source` is what you wrote, kept for reading and diffing. `code` is the same
-- thing with the types removed, which is what actually runs.
--
-- The split exists because of what the runtime will and will not do. Measured
-- on this deployment: a Deno isolate imports JavaScript from a `data:` URL, and
-- refuses TypeScript from one — it parses the type annotation as JavaScript and
-- fails. It also refuses to import a `.ts` file written to `/tmp`; the worker's
-- module loader is scoped to the function it was created for.
--
-- So the types come off before storage rather than at execution. The CLI does it
-- with `module.stripTypeScriptTypes`, which is in Node and needs no bundler —
-- the same reason there is no bundler anywhere else in this SDK.
begin;

alter table public.tool_versions
  add column if not exists code text not null default '';

comment on column public.tool_versions.code is
  'The version with types stripped. What the executor imports; `source` is what a person reads.';

commit;
