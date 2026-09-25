# Acamics — Static Frontend Deployment

The browser app is hosted as static HTML/CSS/JavaScript. Supabase provides authentication, shared official events, and per-account personal events. A Supabase Edge Function handles privileged official-event writes.

## Hosting

- Netlify publishes `frontend/` through the repository `netlify.toml`.
- Vercel can publish `frontend/` as a static site.

## Supabase requirements

Before deploying the frontend, apply the migration and deploy the `staff-event-action` Edge Function described in [`supabase/SETUP.md`](supabase/SETUP.md). Set `TEACHER_ACTION_PASSWORD` as an Edge Function secret; never add it to browser code or commit it.

- Official events are read from `public.events` and are visible to everyone.
- Students can create and manage only their own rows in `public.personal_events`, protected by RLS.
- Admins can add, delete, and postpone official events. Teachers need the shared staff action password for each of those actions.
- Legacy browser-stored personal events migrate to the signed-in user's Supabase account on first load after the migration is applied.
- Calendar `.ics` export works in the browser.
- `backend/` remains the original academic/local Python implementation; it is not the production data backend.
