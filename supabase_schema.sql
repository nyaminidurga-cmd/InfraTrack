-- InfraTrack — Supabase PostgreSQL schema
-- Paste into: Supabase Dashboard → SQL Editor → Run
-- Matches the frontend data model. Includes login security (RLS) at the bottom.
-- FRESH INSTALL ONLY. If your tables already exist, run
-- supabase_security_upgrade.sql instead.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Reset (only if you are recreating this schema from scratch)
-- This drops existing InfraTrack tables and ALL of their rows.
-- These lines are commented out for safety. Un-comment them ONLY if you
-- really want to wipe and recreate everything.
-- ---------------------------------------------------------------------------

-- drop table if exists public.progress_updates cascade;
-- drop table if exists public.project_years cascade;
-- drop table if exists public.projects cascade;

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- projects
-- One infrastructure project (create / edit form)
-- ---------------------------------------------------------------------------

create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid()
                    references auth.users (id) on delete cascade,
  name            text not null,
  type            text not null,
  location        text not null,
  total_budget    numeric(14, 2) not null,
  start_date      date not null,
  end_date        date not null,
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint projects_type_check
    check (type in ('Irrigation', 'Road', 'Bridge', 'Building', 'Other')),

  constraint projects_total_budget_positive
    check (total_budget > 0),

  constraint projects_end_after_start
    check (end_date > start_date)
);

create trigger projects_set_updated_at
before update on public.projects
for each row
execute function public.set_updated_at();

create index projects_user_id_idx on public.projects (user_id);

comment on table public.projects is
  'Infrastructure project. Year plans and monthly actuals live in child tables.';

comment on column public.projects.type is
  'Same values as the frontend select. Building = Major Building.';

comment on column public.projects.total_budget is
  'Total planned budget in ₹ crore. Must equal sum of project_years.planned_expenditure.';

-- ---------------------------------------------------------------------------
-- project_years
-- One yearly plan per project (planned work + planned expenditure)
-- ---------------------------------------------------------------------------

create table public.project_years (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects (id) on delete cascade,
  year_index            integer not null,
  label                 text not null,
  start_year            integer not null,
  year_start            date not null,
  year_end              date not null,
  planned_work          numeric(5, 2) not null,
  planned_expenditure   numeric(14, 2) not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint project_years_year_index_nonnegative
    check (year_index >= 0),

  constraint project_years_end_on_or_after_start
    check (year_end >= year_start),

  constraint project_years_planned_work_range
    check (planned_work >= 0 and planned_work <= 100),

  constraint project_years_planned_expenditure_nonnegative
    check (planned_expenditure >= 0),

  constraint project_years_unique_index
    unique (project_id, year_index),

  constraint project_years_unique_label
    unique (project_id, label)
);

create index project_years_project_id_idx
  on public.project_years (project_id);

create trigger project_years_set_updated_at
before update on public.project_years
for each row
execute function public.set_updated_at();

comment on table public.project_years is
  'Year-wise plan created with the project. planned_work is cumulative %. planned_expenditure is that year only.';

comment on column public.project_years.year_index is
  'Display order. 0 is the first project year.';

comment on column public.project_years.planned_work is
  'Cumulative physical progress target (%) by the end of this year.';

comment on column public.project_years.planned_expenditure is
  'Planned expenditure for this year only, in ₹ crore.';

-- ---------------------------------------------------------------------------
-- progress_updates
-- One monthly actual work + actual expenditure row per year
-- ---------------------------------------------------------------------------

create table public.progress_updates (
  id                    uuid primary key default gen_random_uuid(),
  project_year_id       uuid not null references public.project_years (id) on delete cascade,
  month                 date not null,
  monthly_work          numeric(5, 2) not null,
  monthly_expenditure   numeric(14, 2) not null,
  saved_at              timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint progress_updates_month_is_first_of_month
    check (month = date_trunc('month', month)::date),

  constraint progress_updates_monthly_work_range
    check (monthly_work >= 0 and monthly_work <= 100),

  constraint progress_updates_monthly_expenditure_nonnegative
    check (monthly_expenditure >= 0),

  constraint progress_updates_unique_month
    unique (project_year_id, month)
);

create index progress_updates_project_year_id_idx
  on public.progress_updates (project_year_id);

create index progress_updates_month_idx
  on public.progress_updates (month);

create trigger progress_updates_set_updated_at
before update on public.progress_updates
for each row
execute function public.set_updated_at();

comment on table public.progress_updates is
  'Monthly incremental actuals. Cumulative totals and status are calculated in the app.';

comment on column public.progress_updates.month is
  'First day of the reporting month (e.g. 2025-06-01). Map to YYYY-MM in the UI.';

comment on column public.progress_updates.monthly_work is
  'Incremental work progress (%) for this month, not cumulative.';

comment on column public.progress_updates.monthly_expenditure is
  'Incremental expenditure (₹ crore) for this month, not cumulative.';

-- ---------------------------------------------------------------------------
-- Row Level Security: every user can only see and change their OWN data.
-- projects.user_id is filled automatically with the logged-in user's id.
-- project_years and progress_updates are protected through their parent project.
-- ---------------------------------------------------------------------------

alter table public.projects        enable row level security;
alter table public.project_years   enable row level security;
alter table public.progress_updates enable row level security;

-- Logged-out visitors (the public anon role) get no access at all.
revoke all on public.projects         from anon;
revoke all on public.project_years    from anon;
revoke all on public.progress_updates from anon;

grant select, insert, update, delete on public.projects         to authenticated;
grant select, insert, update, delete on public.project_years    to authenticated;
grant select, insert, update, delete on public.progress_updates to authenticated;

-- Re-running this file is safe: old policies are removed first.
drop policy if exists "projects_select_own"  on public.projects;
drop policy if exists "projects_insert_own"  on public.projects;
drop policy if exists "projects_update_own"  on public.projects;
drop policy if exists "projects_delete_own"  on public.projects;

drop policy if exists "project_years_select_own" on public.project_years;
drop policy if exists "project_years_insert_own" on public.project_years;
drop policy if exists "project_years_update_own" on public.project_years;
drop policy if exists "project_years_delete_own" on public.project_years;

drop policy if exists "progress_updates_select_own" on public.progress_updates;
drop policy if exists "progress_updates_insert_own" on public.progress_updates;
drop policy if exists "progress_updates_update_own" on public.progress_updates;
drop policy if exists "progress_updates_delete_own" on public.progress_updates;

-- projects
create policy "projects_select_own" on public.projects
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "projects_insert_own" on public.projects
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "projects_update_own" on public.projects
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "projects_delete_own" on public.projects
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- project_years (owner = owner of the parent project)
create policy "project_years_select_own" on public.project_years
  for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_years.project_id
      and p.user_id = (select auth.uid())
  ));

create policy "project_years_insert_own" on public.project_years
  for insert to authenticated
  with check (exists (
    select 1 from public.projects p
    where p.id = project_years.project_id
      and p.user_id = (select auth.uid())
  ));

create policy "project_years_update_own" on public.project_years
  for update to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_years.project_id
      and p.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = project_years.project_id
      and p.user_id = (select auth.uid())
  ));

create policy "project_years_delete_own" on public.project_years
  for delete to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_years.project_id
      and p.user_id = (select auth.uid())
  ));

-- progress_updates (owner = owner of the parent project, through project_years)
create policy "progress_updates_select_own" on public.progress_updates
  for select to authenticated
  using (exists (
    select 1
    from public.project_years y
    join public.projects p on p.id = y.project_id
    where y.id = progress_updates.project_year_id
      and p.user_id = (select auth.uid())
  ));

create policy "progress_updates_insert_own" on public.progress_updates
  for insert to authenticated
  with check (exists (
    select 1
    from public.project_years y
    join public.projects p on p.id = y.project_id
    where y.id = progress_updates.project_year_id
      and p.user_id = (select auth.uid())
  ));

create policy "progress_updates_update_own" on public.progress_updates
  for update to authenticated
  using (exists (
    select 1
    from public.project_years y
    join public.projects p on p.id = y.project_id
    where y.id = progress_updates.project_year_id
      and p.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1
    from public.project_years y
    join public.projects p on p.id = y.project_id
    where y.id = progress_updates.project_year_id
      and p.user_id = (select auth.uid())
  ));

create policy "progress_updates_delete_own" on public.progress_updates
  for delete to authenticated
  using (exists (
    select 1
    from public.project_years y
    join public.projects p on p.id = y.project_id
    where y.id = progress_updates.project_year_id
      and p.user_id = (select auth.uid())
  ));
