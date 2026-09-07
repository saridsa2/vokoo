-- Supabase installs pgcrypto in `extensions`. The document RPC deliberately
-- pins its search path, so name that trusted schema explicitly; otherwise the
-- first authenticated upload reaches digest(bytea, text) and fails to resolve
-- a function which is present but invisible.

alter function public.create_document(uuid, text, text, text)
  set search_path = public, extensions;

notify pgrst, 'reload schema';
