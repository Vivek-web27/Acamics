# Acamics — Static Frontend Deployment

The browser app is hosted as static HTML/CSS/JavaScript. Supabase provides authentication, shared official events, and per-account personal events. A Supabase Edge Function handles privileged official-event writes.

## Hosting

- Netlify publishes `frontend/` through the repository `netlify.toml`.
- Vercel can publish `frontend/` as a static site.

## Supabase requirements

Before deploying the frontend, apply all SQL migrations in timestamp order and deploy the `staff-event-action` Edge Function described in [`supabase/SETUP.md`](supabase/SETUP.md). Set `TEACHER_ACTION_PASSWORD` as an Edge Function secret; never add it to browser code or commit it.

- Official events are read from `public.events` and are visible to everyone.
- Students can create and manage only their own rows in `public.personal_events`, protected by RLS.
- Admins can add, delete, postpone, and confirm completion for official events. Teachers need the shared staff action password for each management action.
- Postponement reasons are required; supporting files are optional. Staff must add a completion note and proof file before marking an official event completed. Private files and the event history remain in Supabase for later review.
- Cancelled official events remain in the calendar with their cancellation reason and history; they are not deleted.
- Official events are grouped by start-date calendar year, undergraduate cohort, and academic-calendar part (Part 1 or Part 2). PhD events are excluded. Apply the cohort migration and replace/import calendars as described in [`supabase/SETUP.md`](supabase/SETUP.md).
- Legacy browser-stored personal events migrate to the signed-in user's Supabase account on first load after the migration is applied.
- Calendar `.ics` export works in the browser.
- The frontend is an installable PWA with a service worker and Web Push support. Apply `supabase/migrations/20261008000100_web_push_reminders.sql`, configure the VAPID/scheduler secrets, deploy `send-reminders`, and schedule it using [`supabase/reminders_schedule.sql`](supabase/reminders_schedule.sql) before enabling background reminders.
- `backend/` remains the original academic/local Python implementation; it is not the production data backend.
