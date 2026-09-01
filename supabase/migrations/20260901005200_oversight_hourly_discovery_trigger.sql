do $$ begin
  if exists (select 1 from cron.job where jobname = 'oversight-hourly-discovery') then
    perform cron.unschedule('oversight-hourly-discovery');
  end if;
end $$;

select cron.schedule(
  'oversight-hourly-discovery',
  '17 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='oversight_project_url') || '/functions/v1/oversight-discovery-trigger',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='oversight_publishable_key')
    ),
    body := jsonb_build_object('source','supabase-cron','scheduled_at',now()),
    timeout_milliseconds := 60000
  );
  $job$
);
