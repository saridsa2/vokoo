-- The operator holds the keys a tenant's calls run on.
--
-- Migration 0084 made `vendor_credentials.org_id` nullable and taught
-- `resolve_vendor_secret` to fall back to those rows. Nothing could write one:
-- `set_vendor_credential` takes an org and the console only ever passes its
-- own, so a provisioned workspace resolved `(none)` for every vendor — which
-- is the shape this project keeps recording, a mechanism built and left with
-- no way to reach it.
--
-- These are the operator's counterparts, guarded by `is_platform_admin()`
-- rather than by membership, because a platform key belongs to nobody's
-- workspace.

create or replace function operator_set_platform_key(p_vendor text, p_secret text, p_label text)
returns json
language plpgsql
security definer
set search_path = public, vault
as $$
declare
    existing_ref text;
    new_ref uuid;
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;
    if coalesce(btrim(p_secret), '') = '' then
        raise exception 'a key cannot be empty';
    end if;

    select secret_ref into existing_ref
      from vendor_credentials where org_id is null and vendor = p_vendor;

    if existing_ref is not null then
        -- Replace the secret in place. Deleting and re-creating would change
        -- the reference, and anything holding the old one would resolve to
        -- nothing without saying why.
        perform vault.update_secret(existing_ref::uuid, p_secret);
        update vendor_credentials
           set label = coalesce(nullif(btrim(p_label), ''), label),
               updated_at = now()
         where org_id is null and vendor = p_vendor;
    else
        new_ref := vault.create_secret(p_secret, 'platform:' || p_vendor, 'Platform key for ' || p_vendor);
        insert into vendor_credentials (org_id, vendor, secret_ref, label)
        values (null, p_vendor, new_ref::text, coalesce(nullif(btrim(p_label), ''), p_vendor));
    end if;

    -- The last four characters, never the key. Enough to tell two keys apart
    -- when somebody is checking which one is installed, and useless to anybody
    -- who obtains it.
    return json_build_object('vendor', p_vendor, 'hint', right(p_secret, 4));
end;
$$;

revoke all on function operator_set_platform_key(text, text, text) from public, anon;
grant execute on function operator_set_platform_key(text, text, text) to authenticated;

create or replace function operator_platform_keys()
returns table (vendor text, label text, hint text, updated_at timestamptz)
language plpgsql
security definer
set search_path = public, vault
as $$
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    -- **A hint, never the secret.** There is no route that returns a key, and
    -- this is the one place that could most easily become one — an operator
    -- screen listing what is installed is exactly where somebody would add
    -- "and show me the value".
    return query
    select c.vendor,
           c.label,
           right(s.decrypted_secret, 4),
           c.updated_at
      from vendor_credentials c
      join vault.decrypted_secrets s on s.id = c.secret_ref::uuid
     where c.org_id is null
     order by c.vendor;
end;
$$;

revoke all on function operator_platform_keys() from public, anon;
grant execute on function operator_platform_keys() to authenticated;

create or replace function operator_delete_platform_key(p_vendor text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_platform_admin() then
        raise exception 'not a platform administrator';
    end if;

    delete from vendor_credentials where org_id is null and vendor = p_vendor;
    return json_build_object('ok', true, 'vendor', p_vendor);
end;
$$;

revoke all on function operator_delete_platform_key(text) from public, anon;
grant execute on function operator_delete_platform_key(text) to authenticated;
