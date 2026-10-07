-- InfraTrack: add login security to an EXISTING database (keeps your data)
-- Paste into: Supabase Dashboard -> SQL Editor -> Run
-- This does NOT drop any tables or delete any rows.

-- 1. Owner column. New rows get the logged-in user's id automatically.
alter table public.projects
  add column if not exists user_id uuid
  default auth.uid()
  references auth.users (id) on delete cascade;

create index if not exists projects_user_id_idx
  on public.projects (user_id);

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

-- ---------------------------------------------------------------------------
-- OLD PROJECTS: rows created before login have no owner, so nobody can see
-- them after RLS is on. To give them to yourself:
--   1. Create your account in the app (Create one -> sign up).
--   2. Authentication -> Users -> copy your user's UID.
--   3. Run:  update public.projects set user_id = 'PASTE-YOUR-UID' where user_id is null;
-- ---------------------------------------------------------------------------
