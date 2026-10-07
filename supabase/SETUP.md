# Supabase setup for Acamics event permissions

The browser never contains the staff action password or a Supabase secret/service-role key.

## 1. Apply the database migration

Open the Supabase SQL Editor for the Acamics project and run the complete file:

`migrations/20260925000100_personal_events_and_staff_actions.sql`

For the event postponement attachment and completion-proof feature, also run:

`migrations/20261001000100_event_proof_and_completion.sql`

For staff cancellation and cancellation history, run this migration after the previous one:

`migrations/20261002000100_official_event_cancellation.sql`

For calendar-year grouping and cohort targeting, run this migration after the cancellation migration:

`migrations/20261003000100_calendar_year_and_cohort_scope.sql`

For installable-app push reminders, run `migrations/20261008000100_web_push_reminders.sql` after the calendar migration.

These migrations create a private Storage bucket for proof files, restrict uploads to admins and teachers, let signed-in users review event proof, and add the history columns and staff-only RPCs. Cancellation changes the event status to `cancelled` instead of deleting the row, and stores its reason, actor, and timestamp. Keep the bucket private; the frontend uses temporary signed links to display attachments. The existing `profiles.role` check should already allow `student`, `teacher`, and `admin`; new accounts should continue to default to `student`. Assign teacher roles only after verification, using the Supabase Dashboard/SQL Editor.

## 2. Set the shared teacher action password

In Supabase Dashboard → Edge Functions → Secrets, add:

- Name: `TEACHER_ACTION_PASSWORD`
- Value: a strong, randomly generated phrase that is not used as an account password

Use a long random value; do not use the sample `MIT@123` or commit the value to Git. The Edge Function requires it for every teacher add/delete/postpone action. Admin actions do not prompt for it.

## 3. Deploy the Edge Function

From the repository root, after installing and logging in to the Supabase CLI and linking the project if needed, run:

```powershell
supabase functions deploy staff-event-action --project-ref axceorzwzfuyuaeoswgv
```

The function verifies the caller's Supabase session and profile role. It requires `admin` or `teacher`; for teachers it checks the shared phrase server-side and limits failed attempts to five per account per 15 minutes. Its Supabase service-role key is read only from the Edge Function environment. The updated function supports optional postponement attachments, completion confirmation with a required proof file and note, and recorded event cancellation.

## 4. Personal event data migration

On each account's first sign-in after the migration is applied, the frontend imports that account's legacy local events from `acamics_personal_events` / `campussync_personal_events` into `personal_events`, then removes the imported rows from local storage. Events with the old temporary `student-1` owner are assigned to the first account that migrates them. Rows already tagged with a different UUID are left in that browser's local storage.

Students can create, edit, delete, and reschedule rows owned by their own account. RLS enforces ownership; frontend checks are only for UI behavior. Official event writes go through the Edge Function.

## 5. Replace the old shared calendar with the 2026-27 Part-I calendar

The source transcription is in `data/official_calendar_2026-27_part1_review.csv`. The import file is `data/official_calendar_2026-27_part1_import.csv`; it contains 34 undergraduate rows for the 2025-2029 batch, all marked `academic_part = 1`. The PhD progress seminar is excluded from the import. The generated `calendar_year` is intentionally omitted from the CSV because Postgres derives it from `start_date`.

After reviewing the import CSV and applying the migration:

1. In Supabase Dashboard → Table Editor → `events`, export the current rows if you want a local copy. The previous shared calendar can then be replaced; personal events live in `personal_events` and are not affected.
2. In SQL Editor, clear the old shared rows with `delete from public.events;` and run it. This deletes every row in the shared `events` table, including its embedded postponement/completion/cancellation history.
3. In Table Editor → `events`, choose **Import data from CSV** and select `data/official_calendar_2026-27_part1_import.csv`. Keep the header row enabled and let Supabase match the CSV headers to columns. Do not add an `id` or `calendar_year` column to the CSV; both are generated/defaulted by the database.
4. Confirm the table shows 34 imported rows. The calendar groups rows under the year from their start date. Select **2026 → 2nd year (2025–2029) → Part 1** to view this calendar. Part 2 displays an empty-state message until its calendar is imported. The January 2027 Open House appears under 2027 for the same cohort, displayed there as 3rd year.

The review CSV retains transcription notes. In particular, the source prints “Provisional Detention” twice on October 31; both rows are present in the import unless you remove one from the CSV before importing.

For later calendar releases, do not clear the table again. Add the new calendar's rows with the matching cohort start year and set `academic_part` to `2` for Part 2. The app uses the same `public.events` table and separates each calendar by start-date calendar year, cohort, and part.

Official events added through the staff form can target one undergraduate cohort or all undergraduate cohorts, and must be assigned to Part 1 or Part 2. PhD events are not supported in this version. When you receive another cohort/part calendar, import its rows with the corresponding `target_cohort_start_years` and `academic_part` values. Deploy the updated Edge Function only after you have reviewed and locally tested the UI:

```powershell
npx supabase@latest functions deploy staff-event-action --project-ref axceorzwzfuyuaeoswgv --use-api
```

## 6. Installable app and background reminders

The frontend is a Progressive Web App. On desktop/Android, use the browser's **Install Acamics** option. On iPhone/iPad, use **Share → Add to Home Screen**; iOS only delivers web push to a Home Screen web app. Users enable notifications in Acamics → Settings and select their undergraduate batch. The current release sends reminders for official events targeted to that batch and the user's personal events. Timed events use the selected 24-hour and/or 1-hour offsets. Events with no start time use 9:00 AM IST on the event date as their assumed start, so the 24-hour reminder arrives at 9:00 AM the day before; the 1-hour reminder is skipped.

The `notification_outbox` is server-only. Reminder subscriptions and preferences have owner-only RLS. The browser receives only the public VAPID key; never expose the VAPID private key, the scheduler secret, or the Supabase service-role key.

1. Apply the new `20261008000100_web_push_reminders.sql` migration in the Supabase SQL Editor.
2. Generate a VAPID key pair locally in PowerShell. This prints JSON containing a public and private JWK; keep it private and do not paste it into chat or commit it:

   ```powershell
   node -e "const {generateKeyPairSync}=require('node:crypto');const p=generateKeyPairSync('ec',{namedCurve:'prime256v1'});console.log(JSON.stringify({publicKey:p.publicKey.export({format:'jwk'}),privateKey:p.privateKey.export({format:'jwk'})}))"
   ```

3. Generate a separate scheduler secret:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

4. In Supabase Dashboard → Edge Functions → Secrets, add `VAPID_KEYS_JSON` (the entire JSON from step 2), `VAPID_SUBJECT` (a `mailto:` address you control), and `REMINDER_CRON_SECRET` (the value from step 3). Do not use the teacher action password for the scheduler secret.
5. From the repository root, deploy the reminder function:

   ```powershell
   npx supabase@latest functions deploy send-reminders --project-ref axceorzwzfuyuaeoswgv --use-api
   ```

6. Open `supabase/reminders_schedule.sql`, replace `REPLACE_WITH_REMINDER_CRON_SECRET` with the same scheduler secret, and run the SQL in Supabase SQL Editor. This enables the five-minute `pg_cron` job. Keep the edited secret out of Git; run the SQL in the dashboard without saving it to the repository.
7. After the frontend is published over HTTPS, open it, sign in, choose Settings → **Enable reminders**, and allow notifications. The **Send a test alert** button checks device notification display immediately. Real event reminders are sent by the scheduled Edge Function, including when the app is closed.

For local UI testing, serve the `frontend` directory (not the repository root) with `python -m http.server 8000`. `localhost` is treated as a secure context for service workers and push. The browser must remain installed/enabled on that same origin for its saved push subscription to work. Push subscriptions created on localhost are separate from subscriptions on the Netlify site. No Netlify deployment is needed until you decide the UI is ready. Push reminders do not change Supabase's separate signup confirmation email limit.
