# InfraTrack

Infrastructure project monitoring. Create projects with a year-wise plan, record monthly
progress, and compare actual work and spending against the plan.

Built with plain HTML, CSS and JavaScript, with Supabase for the database and login.

## Features

- Email login and sign up. Every user sees only their own projects.
- Create projects with a year-wise plan (planned work % and planned expenditure).
- Monthly progress updates: add, edit and delete.
- Dashboard with cumulative totals and status (Ahead, Behind, Target Achieved).
- Edit and delete projects.
- Search and filter the project list.
- Export and import a JSON backup.

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run `supabase_schema.sql` (new database).
   If your tables already exist, run `supabase_security_upgrade.sql` instead.
3. Open **Project Settings, API** and copy the Project URL and the **anon public** key
   into `config.js`. Never put the `service_role` key anywhere in this project.
4. Open **Authentication, Providers** and make sure Email is enabled.
   For quick testing you can turn off "Confirm email". For real use, leave it on.
5. Open `index.html` in a browser (or use the VS Code Live Server extension).

## Security

- Row Level Security (RLS) is enabled on every table. A logged-in user can only read
  and change rows that belong to them, and logged-out visitors get no access.
- The anon key in `config.js` is public by design. It is only safe because RLS is on.
  Do not turn RLS off.

## Deploy on GitHub Pages

1. Push the project to GitHub.
2. Repository **Settings, Pages**: choose the `main` branch and the root folder.
3. In Supabase, open **Authentication, URL Configuration** and set **Site URL** to your
   GitHub Pages address (for example `https://<username>.github.io/infratrack/`).
   Without this, email confirmation links will point to the wrong place.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure, login screen and modals |
| `style.css` | Styling |
| `script.js` | App logic, Supabase calls and login |
| `config.js` | Supabase URL and anon key |
| `supabase_schema.sql` | Full database setup for a new project |
| `supabase_security_upgrade.sql` | Adds login security to an existing database |
