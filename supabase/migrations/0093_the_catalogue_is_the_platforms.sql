-- The catalogue was readable by everybody, including the rate card.
--
-- Every `catalogue_*` table carried `for select to authenticated using (true)`.
-- That was right when a tenant composed its own engines and connected its own
-- providers: it is the list of what it could choose from. Since 0090 and 0091
-- it chooses none of that, and the same grant now means:
--
--   catalogue_models          18 rows, every model and its provider id
--   catalogue_providers        5 rows
--   catalogue_engine_stages   13 rows, which vendor implements which stage
--   catalogue_vendor_rates    12 rows — **what we pay our vendors**
--
-- The last one is the serious one. A customer being sold a minute at a price
-- could read the cost side of that minute. It is not a leak of their data, it
-- is a leak of ours, which is why no RLS review looking for cross-tenant reads
-- would have found it — every one of these tables is correctly scoped to
-- "everyone", and "everyone" stopped being the right answer.
--
-- ## One table stays readable
--
-- `catalogue_node_types` is the flow composer's palette. Stitching call flows
-- is exactly what a tenant still does, and the palette names node types — a
-- trigger, a menu, an agent node — not vendors.

do $$
declare
    t text;
begin
    -- Named rather than pattern-matched, so a catalogue table added later is
    -- not swept in or left out by accident: it will not appear here and its
    -- author has to decide which side it belongs on.
    foreach t in array array[
        'catalogue_providers',
        'catalogue_models',
        'catalogue_voices',
        'catalogue_transcribers',
        'catalogue_vendors',
        'catalogue_engine_stages',
        'catalogue_vendor_rates'
    ]
    loop
        execute format('drop policy if exists %I on %I', t || '_read', t);
        -- The original names are not uniform — `catalogue_read`,
        -- `catalogue_credentials_read`, `catalogue_flow_nodes_read` — so drop
        -- every SELECT policy on the table rather than guessing its name.
        execute (
            select coalesce(string_agg(format('drop policy if exists %I on %I;', policyname, t), ' '), '')
              from pg_policies where tablename = t and schemaname = 'public'
        );
        execute format(
            'create policy %I on %I for select to authenticated using (is_platform_admin())',
            t || '_operator_only', t
        );
    end loop;
end $$;

comment on table catalogue_vendor_rates is
    'What a vendor charges us. Operator-only: this is the cost side of a price a customer is quoted.';

-- The palette a tenant still needs, restated so it is visibly a decision
-- rather than a policy that happened to survive.
drop policy if exists catalogue_flow_nodes_read on catalogue_node_types;
create policy catalogue_node_types_read on catalogue_node_types
    for select to authenticated using (true);

comment on table catalogue_node_types is
    'The flow composer palette. Readable by every tenant on purpose: stitching call flows is what a tenant does, and a node type names no vendor.';

-- ---- What the console asks for ---------------------------------------------

-- `capability_catalogue()` builds one object out of all eight tables. It is
-- `security definer`, so tightening the policies above would not have narrowed
-- it — it would have carried on returning everything to everyone.
--
-- It now answers according to who is asking: an operator gets the whole
-- catalogue, a tenant gets the palette and empty lists for the rest. Empty
-- rather than absent, because the console iterates these arrays and a missing
-- key is a crash where an empty array is simply no options.
create or replace function capability_catalogue()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    palette jsonb := coalesce((select jsonb_agg(to_jsonb(n) order by n.sort_order)
                                 from public.catalogue_node_types n where n.is_active), '[]'::jsonb);
begin
    if not is_platform_admin() then
        return jsonb_build_object(
            'providers', '[]'::jsonb,
            'models', '[]'::jsonb,
            'voices', '[]'::jsonb,
            'transcribers', '[]'::jsonb,
            'vendors', '[]'::jsonb,
            'nodeTypes', palette,
            'engineStages', '[]'::jsonb
        );
    end if;

    return jsonb_build_object(
        'providers', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order)
                               from public.catalogue_providers p where p.is_active), '[]'::jsonb),
        'models', coalesce((select jsonb_agg(to_jsonb(m) order by m.sort_order)
                            from public.catalogue_models m where m.is_active), '[]'::jsonb),
        'voices', coalesce((select jsonb_agg(to_jsonb(v) order by v.sort_order)
                            from public.catalogue_voices v where v.is_active), '[]'::jsonb),
        'transcribers', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order)
                                  from public.catalogue_transcribers t where t.is_active), '[]'::jsonb),
        'vendors', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order)
                             from public.catalogue_vendors c where c.is_active), '[]'::jsonb),
        'nodeTypes', palette,
        'engineStages', coalesce((select jsonb_agg(to_jsonb(s) order by s.stage, s.sort_order)
                                  from public.catalogue_engine_stages s where s.is_active), '[]'::jsonb)
    );
end;
$$;

-- ---- The agent row was still carrying the model ----------------------------

-- `provider`, `model` and the voice were copied onto the agent when an engine
-- was attached — a mirror of the engine kept in a table the tenant reads. So
-- every agent said `openai / gpt-4.1-mini / sarvam:anushka` regardless of what
-- the engine screen showed.
--
-- Cleared only where an engine is attached. An agent without one still falls
-- back to the bridge's environment, and blanking its columns would take that
-- fallback away — the phone comes first.
update agents
   set provider     = '',
       model        = '',
       voice_config = voice_config - 'voice',
       updated_at   = now()
 where engine_id is not null
   and (provider <> '' or model <> '' or voice_config ? 'voice');

comment on column agents.model is
    'Vestigial where an engine is attached: the engine decides, and the bridge reads it from there. Kept for an agent with no engine, which still falls back to the bridge environment.';
