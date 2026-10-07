-- Run only after the reminders migration and Edge Function are deployed.
-- First replace the placeholder with the exact REMINDER_CRON_SECRET value
-- saved in Supabase Edge Function Secrets.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $setup$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'acamics_reminder_cron_secret'
  ) then
    perform vault.create_secret(
      'REPLACE_WITH_REMINDER_CRON_SECRET',
      'acamics_reminder_cron_secret',
      'Shared only between Supabase Cron and the send-reminders Edge Function'
    );
  end if;
end;
$setup$;

do $schedule$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'acamics-send-reminders';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'acamics-send-reminders',
    '*/5 * * * *',
    $request$
      select net.http_post(
        url := 'https://axceorzwzfuyuaeoswgv.supabase.co/functions/v1/send-reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-reminder-cron-secret',
          (select decrypted_secret from vault.decrypted_secrets where name = 'acamics_reminder_cron_secret')
        ),
        body := '{}'::jsonb
      );
    $request$
  );
end;
$schedule$;
