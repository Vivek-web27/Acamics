# Supabase setup for Acamics event permissions

The browser never contains the staff action password or a Supabase secret/service-role key.

## 1. Apply the database migration

Open the Supabase SQL Editor for the Acamics project and run the complete file:

`migrations/20260925000100_personal_events_and_staff_actions.sql`

This creates the owner-scoped `personal_events` table, its RLS policies, a rate-limit table used only by the Edge Function, and the service-role-only postponement RPC. The existing `profiles.role` check should already allow `student`, `teacher`, and `admin`; new accounts should continue to default to `student`. Assign teacher roles only after verification, using the Supabase Dashboard/SQL Editor.

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

The function verifies the caller's Supabase session and profile role. It requires `admin` or `teacher`; for teachers it checks the shared phrase server-side and limits failed attempts to five per account per 15 minutes. Its Supabase service-role key is read only from the Edge Function environment.

## 4. Personal event data migration

On each account's first sign-in after the migration is applied, the frontend imports that account's legacy local events from `acamics_personal_events` / `campussync_personal_events` into `personal_events`, then removes the imported rows from local storage. Events with the old temporary `student-1` owner are assigned to the first account that migrates them. Rows already tagged with a different UUID are left in that browser's local storage.

Students can create, edit, delete, and reschedule rows owned by their own account. RLS enforces ownership; frontend checks are only for UI behavior. Official event writes go through the Edge Function.
