do $$ begin perform cron.unschedule('oversight-crawler-group-a-two-minutes'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('oversight-crawler-group-b-two-minutes'); exception when others then null; end $$;

select cron.schedule('oversight-crawler-group-a-two-minutes','*/2 * * * *',$$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='oversight_project_url') || '/functions/v1/oversight-crawler-group-a',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='oversight_publishable_key')),
    body := jsonb_build_object('source','supabase-crawler-a-cron','scheduled_at',now()),
    timeout_milliseconds := 110000
  );
$$);

select cron.schedule('oversight-crawler-group-b-two-minutes','1-59/2 * * * *',$$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='oversight_project_url') || '/functions/v1/oversight-crawler-group-b',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='oversight_publishable_key')),
    body := jsonb_build_object('source','supabase-crawler-b-cron','scheduled_at',now()),
    timeout_milliseconds := 110000
  );
$$);
