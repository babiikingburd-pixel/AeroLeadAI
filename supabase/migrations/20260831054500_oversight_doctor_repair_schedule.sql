select cron.schedule(
  'oversight-doctor-repair-five-minutes',
  '2-59/5 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='oversight_project_url') || '/functions/v1/oversight-doctor-repair',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='oversight_publishable_key')
    ),
    body := jsonb_build_object('source','supabase-doctor-cron','scheduled_at',now()),
    timeout_milliseconds := 50000
  );
  $job$
);