-- A person may set their own name.
--
-- `memberships` is writable only by an admin (`memberships_manage`), which is
-- right for role and wrong for this: `display_name` is now what the console
-- calls somebody in the sidebar and on the Team screen, and needing an
-- administrator to correct your own name is silly.
--
-- ## Why not a policy
--
-- The obvious move is another RLS policy: `for update using (user_id =
-- auth.uid())`. **Postgres policies cannot restrict a column.** That policy
-- would let anybody set their own `role` to `owner`, which is a privilege
-- escalation reached through a name field.
--
-- So it is a function that writes exactly one column, and the column list is
-- the constraint. Same shape as `org_people`: definer, guarded on its first
-- line, granted to `authenticated` and never to `anon`.

create or replace function set_my_display_name(p_org uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    cleaned text := nullif(btrim(p_name), '');
begin
    if auth.uid() is null then
        raise exception 'not signed in';
    end if;

    -- Bounded rather than free: this renders in a sidebar and a table, and a
    -- name nobody could have typed by accident is somebody testing what the
    -- column will hold.
    if cleaned is not null and length(cleaned) > 80 then
        raise exception 'that name is too long';
    end if;

    update memberships
       set display_name = cleaned,
           updated_at   = now()
     where org_id  = p_org
       and user_id = auth.uid();

    if not found then
        -- Not "no such organisation": saying which of the two it was would
        -- tell somebody probing ids that they had found a real one.
        raise exception 'you are not a member of that organisation';
    end if;

    return cleaned;
end;
$$;

revoke all on function set_my_display_name(uuid, text) from public, anon;
grant execute on function set_my_display_name(uuid, text) to authenticated;

comment on function set_my_display_name is
    'Set your own name in one organisation. Definer because memberships is admin-writable, and one column because a policy cannot restrict one — an update policy here would let anybody make themselves an owner.';
