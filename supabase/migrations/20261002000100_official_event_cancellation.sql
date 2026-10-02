-- Preserve official cancellations in the event table and expose them in history.
-- Run this migration after 20261001000100_event_proof_and_completion.sql.

alter table public.events
  add column if not exists cancellation_history jsonb not null default '[]'::jsonb;

-- If lifecycle_status already has an allow-list CHECK constraint, extend that
-- same rule to accept cancelled while preserving its existing allowed values.
do $migration$
declare
  v_check record;
  v_expression text;
begin
  for v_check in
    select c.conname, pg_get_constraintdef(c.oid) as definition
    from pg_constraint as c
    where c.conrelid = 'public.events'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%lifecycle_status%'
      and pg_get_constraintdef(c.oid) ilike '%completed%'
      and pg_get_constraintdef(c.oid) not ilike '%cancelled%'
  loop
    v_expression := substring(v_check.definition from '^CHECK \((.*)\)$');
    if v_expression is not null then
      execute format('alter table public.events drop constraint %I', v_check.conname);
      execute format(
        'alter table public.events add constraint %I CHECK ((%s) OR lifecycle_status::text = %L)',
        v_check.conname,
        v_expression,
        'cancelled'
      );
    end if;
  end loop;
end;
$migration$;

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
    raise exception 'Only admins and teachers can postpone official events.' using errcode = '42501';
  end if;
  if p_new_start_date is null or p_new_end_date is null then
    raise exception 'New start and end dates are required.' using errcode = '22004';
  end if;
  if p_new_end_date < p_new_start_date then
    raise exception 'The new end date cannot be before the new start date.' using errcode = '22007';
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
  if v_event.lifecycle_status in ('completed', 'cancelled') then
    raise exception 'Completed or cancelled events cannot be postponed.' using errcode = '22023';
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
  select p.role into v_role from public.profiles as p where p.id = p_actor_id;
  if v_role is null or v_role not in ('admin', 'teacher') then
    raise exception 'Only admins and teachers can confirm official event completion.' using errcode = '42501';
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
  if v_event.lifecycle_status = 'cancelled' then
    raise exception 'Cancelled events cannot be marked completed.' using errcode = '22023';
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
  set lifecycle_status = 'completed', completion_history = v_history
  where e.id = p_event_id
  returning e.* into v_event;
  return v_event;
end;
$function$;

revoke all on function public.staff_complete_event(uuid, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.staff_complete_event(uuid, bigint, text, text)
  to service_role;

create or replace function public.staff_cancel_event(
  p_actor_id uuid,
  p_event_id bigint,
  p_reason text
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
  select p.role into v_role from public.profiles as p where p.id = p_actor_id;
  if v_role is null or v_role not in ('admin', 'teacher') then
    raise exception 'Only admins and teachers can cancel official events.' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A cancellation reason is required.' using errcode = '22023';
  end if;

  select e.* into v_event
  from public.events as e
  where e.id = p_event_id and e.is_official is true
  for update;
  if not found then
    raise exception 'Official event not found.' using errcode = 'P0002';
  end if;
  if v_event.lifecycle_status = 'completed' then
    raise exception 'Completed events cannot be cancelled.' using errcode = '22023';
  end if;
  if v_event.lifecycle_status = 'cancelled' then
    raise exception 'This event has already been cancelled.' using errcode = '22023';
  end if;

  v_history := coalesce(v_event.cancellation_history, '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object(
      'cancelled_at', now(),
      'cancelled_by', p_actor_id,
      'reason', btrim(p_reason)
    ));
  update public.events as e
  set lifecycle_status = 'cancelled', cancellation_history = v_history
  where e.id = p_event_id
  returning e.* into v_event;
  return v_event;
end;
$function$;

revoke all on function public.staff_cancel_event(uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.staff_cancel_event(uuid, bigint, text)
  to service_role;
