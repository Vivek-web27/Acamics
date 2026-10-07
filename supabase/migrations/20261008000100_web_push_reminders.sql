-- Account-scoped Web Push preferences and subscriptions for Acamics.
-- The server-owned outbox is never readable or writable by browser roles.

create table if not exists public.reminder_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  cohort_start_year smallint not null default 2025 check (cohort_start_year between 2000 and 2100),
  offsets_minutes smallint[] not null default array[1440, 60]::smallint[],
  timezone text not null default 'Asia/Kolkata' check (timezone = 'Asia/Kolkata'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminder_preferences_offsets_check check (
    cardinality(offsets_minutes) between 1 and 2
    and array_position(offsets_minutes, null) is null
    and offsets_minutes <@ array[1440, 60]::smallint[]
  )
);

alter table public.reminder_preferences enable row level security;
revoke all on table public.reminder_preferences from anon, authenticated;
grant select, insert, update, delete on table public.reminder_preferences to authenticated;
drop policy if exists "Users manage own reminder preferences" on public.reminder_preferences;
create policy "Users manage own reminder preferences"
  on public.reminder_preferences for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.push_subscriptions (
  endpoint text primary key check (length(endpoint) between 1 and 4096),
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null check (length(p256dh) between 1 and 256),
  auth_secret text not null check (length(auth_secret) between 1 and 256),
  expiration_time timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;
drop policy if exists "Users manage own push subscriptions" on public.push_subscriptions;
create policy "Users manage own push subscriptions"
  on public.push_subscriptions for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.notification_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  event_title text not null,
  event_start_at timestamptz not null,
  offset_minutes smallint not null check (offset_minutes in (1440, 60)),
  due_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending', 'sent', 'failed')),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (user_id, event_key, event_start_at, offset_minutes)
);

create index if not exists notification_outbox_pending_idx
  on public.notification_outbox(due_at) where state = 'pending';
alter table public.notification_outbox enable row level security;
revoke all on table public.notification_outbox from anon, authenticated;
grant all on table public.notification_outbox to service_role;

create or replace function public.set_reminder_updated_at()
returns trigger language plpgsql set search_path = '' as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists reminder_preferences_updated_at on public.reminder_preferences;
create trigger reminder_preferences_updated_at before update on public.reminder_preferences
for each row execute function public.set_reminder_updated_at();
drop trigger if exists push_subscriptions_updated_at on public.push_subscriptions;
create trigger push_subscriptions_updated_at before update on public.push_subscriptions
for each row execute function public.set_reminder_updated_at();
