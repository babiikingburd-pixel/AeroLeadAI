-- pg_net is non-relocatable. Recreate it in the protected extensions schema
-- when an earlier install used Postgres' public-schema default.
do $migration$
declare
  extension_schema text;
begin
  select n.nspname into extension_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_net';

  if extension_schema = 'public' then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
end
$migration$;
