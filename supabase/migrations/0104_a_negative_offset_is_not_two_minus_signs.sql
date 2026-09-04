-- `timezone_choices()` printed Pacific/Marquesas as `-09:-30`.
--
-- `to_char(interval, 'HH24:MI')` formats each field independently, and both the
-- hours and the minutes of a negative interval are negative — so every zone
-- west of Greenwich whose offset is not a whole hour came back with two minus
-- signs, and every other western zone came back correct by luck (`-04:00` has
-- nothing in the minutes field to sign).
--
-- Sign the interval once and format its magnitude. Negating it rather than
-- calling `abs` on purpose: `@` was removed in Postgres 14 and `abs(interval)`
-- only arrived in 16, so unary minus is the one spelling that works on both
-- sides of that.
--
-- The sign is part of the value rather than something the reader adds: a
-- console that prefixed "UTC+" would be right for Asia/Kolkata and wrong for
-- America/New_York, which is the same fault one layer along.

create or replace function timezone_choices()
returns table (name text, utc_offset text)
language sql
stable
security definer
set search_path = public
as $$
    select name,
           (case when utc_offset < interval '0' then '-' else '+' end)
               || to_char(
                      case when utc_offset < interval '0' then -utc_offset else utc_offset end,
                      'HH24:MI'
                  ) as utc_offset
      from pg_timezone_names
     where name like '%/%'
       and name not like 'Etc/%'
       and name not like 'posix/%'
       and name not like 'right/%'
     order by name;
$$;

revoke all on function timezone_choices() from public, anon;
grant execute on function timezone_choices() to authenticated;
