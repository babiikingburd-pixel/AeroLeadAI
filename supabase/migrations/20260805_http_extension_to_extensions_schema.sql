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

drop extension http;
create extension http with schema extensions;

alter function public.discover_city_addresses(text, text, integer)
  set search_path = public, extensions, pg_temp;
alter function public.fetch_mn_storm_events(text, text, text)
  set search_path = public, extensions, pg_temp;
alter function public.sync_metrogis_parcels(text, text, text, integer)
  set search_path = public, extensions, pg_temp;
