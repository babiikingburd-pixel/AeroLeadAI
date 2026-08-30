-- Move the `http` extension out of the `public` schema and into `extensions`.
--
-- Supabase's database linter flags extensions installed in `public`
-- (lint 0014_extension_in_public): anything in `public` is reachable through
-- PostgREST and shadowable by objects created there.
--
-- `http` is not relocatable (pg_extension.extrelocatable = false), so
-- `ALTER EXTENSION http SET SCHEMA extensions` is rejected -- drop and recreate
-- is the only way to move it. No objects outside the extension depend on it:
-- the three callers below reference `http_response` / `http_get()` / `http()`
-- from inside plpgsql bodies, which Postgres resolves at execution time rather
-- than recording in pg_depend. That is also why each one needs `extensions`
-- added to its search_path -- otherwise the unqualified names stop resolving
-- once the extension leaves `public`.

-- A fresh AeroLeadAI database may not use pgsql-http at all. In that case this
-- migration must remain a no-op rather than installing an unused extension or
-- failing on DROP EXTENSION.
do $migration$
declare
  current_schema text;
begin
  select n.nspname
    into current_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'http';

  if current_schema = 'public' then
    drop extension http;
    create extension http with schema extensions;
  end if;
end
$migration$;

-- These functions existed in the legacy database but are intentionally absent
-- from the rebuilt schema. Only update functions that actually exist.
do $migration$
declare
  signature text;
begin
  foreach signature in array array[
    'public.discover_city_addresses(text,text,integer)',
    'public.fetch_mn_storm_events(text,text,text)',
    'public.sync_metrogis_parcels(text,text,text,integer)'
  ] loop
    if to_regprocedure(signature) is not null then
      execute format(
        'alter function %s set search_path = public, extensions, pg_temp',
        signature
      );
    end if;
  end loop;
end
$migration$;
