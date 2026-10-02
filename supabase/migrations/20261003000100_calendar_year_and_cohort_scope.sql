-- Add calendar-year, undergraduate cohort, and academic-part targeting.
-- An empty target_cohort_start_years array means the event is for every
-- undergraduate cohort. calendar_year follows start_date automatically.

alter table public.events
  add column if not exists target_cohort_start_years integer[] not null default '{}'::integer[],
  add column if not exists academic_part smallint not null default 1;

alter table public.events
  add column if not exists calendar_year integer generated always as
    (extract(year from start_date)::integer) stored;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_target_cohort_years_check'
  ) then
    alter table public.events
      add constraint events_target_cohort_years_check
      check (
        cardinality(target_cohort_start_years) <= 20
        and array_position(target_cohort_start_years, null) is null
        and 0 <> all(target_cohort_start_years)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_academic_part_check'
  ) then
    alter table public.events
      add constraint events_academic_part_check
      check (academic_part in (1, 2));
  end if;
end;
$migration$;

-- The existing events table is the shared undergraduate calendar. Until those
-- legacy rows are replaced by the reviewed CSV, scope them to the batch that
-- supplied the new calendar instead of displaying them in every cohort.
update public.events
set target_cohort_start_years = array[2025]::integer[]
where cardinality(target_cohort_start_years) = 0;

create index if not exists events_calendar_year_idx
  on public.events (calendar_year);

create index if not exists events_target_cohort_start_years_idx
  on public.events using gin (target_cohort_start_years);

comment on column public.events.calendar_year is
  'Calendar year derived from start_date; academic_year remains the academic-year label.';
comment on column public.events.target_cohort_start_years is
  'Cohort admission/start years targeted by an undergraduate event; empty array means all undergraduate cohorts.';
comment on column public.events.academic_part is
  'Part 1 or Part 2 of the cohort academic calendar.';
