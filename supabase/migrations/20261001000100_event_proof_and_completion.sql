-- Private proof uploads and staff-confirmed completion records for official events.
-- Run this file in the Supabase SQL Editor before deploying the updated frontend/function.

alter table public.events
  add column if not exists completion_history jsonb not null default '[]'::jsonb;

-- Keep uploaded proofs private. The frontend opens them through short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('acamics-event-proof', 'acamics-event-proof', false, 10485760, null)
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = null;

create or replace function public.is_acamics_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'teacher')
  );
$function$;

revoke all on function public.is_acamics_staff() from public, anon;
grant execute on function public.is_acamics_staff() to authenticated;

drop policy if exists "Signed-in users can view Acamics event proof" on storage.objects;
create policy "Signed-in users can view Acamics event proof"
  on storage.objects for select to authenticated
  using (bucket_id = 'acamics-event-proof');

drop policy if exists "Staff can upload their Acamics event proof" on storage.objects;
create policy "Staff can upload their Acamics event proof"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'acamics-event-proof'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_acamics_staff()
  );

create or replace function public.staff_complete_event(
  p_actor_id uuid,
  p_event_id bigint,
  p_reason text,
  p_attachment_path text
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
    raise exception 'Only admins and teachers can confirm official event completion.'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_reason), '') is null then
    raise exception 'A completion note is required.' using errcode = '22023';
  end if;

  if nullif(btrim(p_attachment_path), '') is null then
    raise exception 'A proof attachment is required to confirm completion.' using errcode = '22023';
  end if;

  select e.* into v_event
  from public.events as e
  where e.id = p_event_id and e.is_official is true
  for update;

  if not found then
    raise exception 'Official event not found.' using errcode = 'P0002';
  end if;

  if v_event.lifecycle_status = 'completed' then
    raise exception 'This event has already been marked completed.' using errcode = '22023';
  end if;

  if coalesce(v_event.end_date, v_event.start_date) > current_date then
    raise exception 'The event has not reached its scheduled end date yet.' using errcode = '22023';
  end if;

  v_history := coalesce(v_event.completion_history, '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object(
      'completed_at', now(),
      'completed_by', p_actor_id,
      'reason', btrim(p_reason),
      'attachment_path', p_attachment_path
    ));

  update public.events as e
  set lifecycle_status = 'completed',
      completion_history = v_history
  where e.id = p_event_id
  returning e.* into v_event;

  return v_event;
end;
$function$;

revoke all on function public.staff_complete_event(uuid, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.staff_complete_event(uuid, bigint, text, text)
  to service_role;
