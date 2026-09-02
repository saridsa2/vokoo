-- `resolve_vendor_secret` was executable by `anon`.
--
-- It is SECURITY DEFINER, it takes an org id as an argument, and it has no
-- membership check inside — it returns `vault.decrypted_secrets` for whatever
-- org it is handed. `anon` is the key embedded in the console bundle and served
-- to every browser, so it is public by construction.
--
-- Verified against the live instance on 1 September: a POST to
-- `/rest/v1/rpc/resolve_vendor_secret` carrying only the anon key, with an org
-- id, returned HTTP 200 and the decrypted provider key. Both stored credentials
-- — the Gemini inference key and the KooKoo carrier key — were readable that
-- way by anyone who could reach the host.
--
-- One caller is legitimate: the media bridge, which resolves a provider key per
-- call using `SUPABASE_SERVICE_ROLE_KEY`. That is `service_role`, and it keeps
-- its grant. Nothing else needs plaintext:
--
--   * the console lists credentials through `list_vendor_credentials`, which
--     returns four characters and a date and never the secret;
--   * the control plane holds no service key at all, by design, so it cannot
--     read a secret even accidentally.
--
-- The `authenticated` role is revoked too, though it does not currently hold
-- the grant: a later `grant execute ... to authenticated` on the schema would
-- otherwise re-open this silently.

begin;

revoke execute on function public.resolve_vendor_secret(uuid, text) from anon;
revoke execute on function public.resolve_vendor_secret(uuid, text) from authenticated;
revoke execute on function public.resolve_vendor_secret(uuid, text) from public;

comment on function public.resolve_vendor_secret(uuid, text) is
  'Plaintext provider key for one org. service_role only — the media bridge is the only caller. Never grant to anon or authenticated: the anon key is public.';

commit;
