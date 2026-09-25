-- Acamics: user-owned personal events and guarded staff postponement.
-- Run this in the Supabase SQL Editor before using the updated frontend.

create table if not exists public.personal_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_id text,
  title text not null check (length(btrim(title)) > 0),
  category text not null default 'Academic',
  start_date date not null,
  end_date date not null,
  start_time time,
  end_time time,
  location text not null default 'Campus',
  description text not null default '',
  color_theme text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_events_dates_valid check (end_date >= start_date),
  constraint personal_events_legacy_unique unique (owner_id, legacy_id)
);

alter table public.personal_events enable row level security;

revoke all on table public.personal_events from anon, authenticated;
grant select, insert, update, delete on table public.personal_events to authenticated;

drop policy if exists "Users can read their own personal events" on public.personal_events;
create policy "Users can read their own personal events"
  on public.personal_events for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Users can create their own personal events" on public.personal_events;
create policy "Users can create their own personal events"
  on public.personal_events for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can update their own personal events" on public.personal_events;
create policy "Users can update their own personal events"
  on public.personal_events for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can delete their own personal events" on public.personal_events;
create policy "Users can delete their own personal events"
  on public.personal_events for delete to authenticated
  using ((select auth.uid()) = owner_id);

create index if not exists personal_events_owner_start_idx
  on public.personal_events (owner_id, start_date);

-- Private-to-the-Edge-Function account-based passphrase rate limit.
create table if not exists public.staff_action_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  failed_at timestamptz not null default now()
);

alter table public.staff_action_attempts enable row level security;
revoke all on table public.staff_action_attempts from anon, authenticated;
grant all on table public.staff_action_attempts to service_role;
create index if not exists staff_action_attempts_user_time_idx
  on public.staff_action_attempts (user_id, failed_at desc);

-- Called only by the trusted Edge Function using the service-role key.
-- The Edge Function verifies the shared teacher passphrase before reaching this RPC.
create or replace function public.staff_postpone_event(
  p_actor_id uuid,
  p_event_id bigint,
  p_new_start_date date,
  p_new_end_date date,
  p_reason text,
  p_attachment_path text default null
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role text;
  v_event public.events%rowtype;
  v_history jsonb;
begin
  select p.role into v_role
  from public.profiles as p
  where p.id = p_actor_id;

  if v_role is null or v_role not in ('admin', 'teacher') then
    raise exception 'Only admins and teachers can postpone official events.'
      using errcode = '42501';
  end if;

  if p_new_start_date is null or p_new_end_date is null then
    raise exception 'New start and end dates are required.' using errcode = '22004';
  end if;

  if p_new_end_date < p_new_start_date then
    raise exception 'The new end date cannot be before the new start date.'
      using errcode = '22007';
  end if;

  if nullif(btrim(p_reason), '') is null then
    raise exception 'A postponement reason is required.' using errcode = '22023';
  end if;

  select e.* into v_event
  from public.events as e
  where e.id = p_event_id and e.is_official is true
  for update;

  if not found then
    raise exception 'Official event not found.' using errcode = 'P0002';
  end if;

  v_history := coalesce(v_event.postponement_history, '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object(
      'postponed_at', now(),
      'postponed_by', p_actor_id,
      'reason', btrim(p_reason),
      'attachment_path', p_attachment_path,
      'previous_start_date', v_event.start_date,
      'previous_end_date', v_event.end_date,
      'new_start_date', p_new_start_date,
      'new_end_date', p_new_end_date
    ));

  update public.events as e
  set start_date = p_new_start_date,
      end_date = p_new_end_date,
      original_start_date = coalesce(e.original_start_date, e.start_date),
      original_end_date = coalesce(e.original_end_date, e.end_date),
      postponement_reason = btrim(p_reason),
      postponement_history = v_history,
      lifecycle_status = 'postponed'
  where e.id = p_event_id
  returning e.* into v_event;

  return v_event;
end;
$function$;

revoke all on function public.staff_postpone_event(uuid, bigint, date, date, text, text)
  from public, anon, authenticated;
grant execute on function public.staff_postpone_event(uuid, bigint, date, date, text, text)
  to service_role;
