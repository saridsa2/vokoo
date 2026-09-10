-- Evidence links are review pointers, not copies of whole document chunks.
-- Keep the exact source prefix within the table's established 1,000-character
-- contract even when a model returns an entire chunk as its excerpt.

begin;

create or replace function public.normalize_compiler_evidence_excerpt()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.excerpt := left(btrim(new.excerpt), 1000);
  return new;
end;
$$;

drop trigger if exists normalize_compiler_evidence_excerpt on public.compiler_evidence_links;
create trigger normalize_compiler_evidence_excerpt
before insert or update of excerpt on public.compiler_evidence_links
for each row execute function public.normalize_compiler_evidence_excerpt();

commit;
