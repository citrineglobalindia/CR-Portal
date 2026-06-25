# CR Portal — StudioAI Pro

A lightweight Change Request portal for **Citrine Global India**. Clients raise change
requests for StudioAI Pro and track their status; an admin reviews everything, updates
statuses, comments, and exports reports. It's a single HTML file backed by Supabase
(Postgres + Auth + Storage) — no build step, no server to run.

## Features

- Email/password sign-up and login (with password reset)
- **Client view** — submit change requests (title, area, type, priority, count,
  description, file attachments) and track their status
- **Admin view** — dashboard stats, search/filter by status, type, priority and client,
  inline status changes, status history, comments, and attachment uploads
- Auto-generated reference numbers (`CR-0001`, `CR-0002`, …)
- Exports: Excel (`.xlsx`), PDF, Word (`.doc`), and CSV — respecting the active filters
- Row Level Security: clients see only their own requests; admins see all

## Tech

- Frontend: a single `index.html` (vanilla JS, no framework)
- Backend: [Supabase](https://supabase.com) — Postgres, Auth, Storage
- Libraries (via CDN): supabase-js, SheetJS (xlsx), jsPDF + autotable

## Setup

### 1. Create the database

In your Supabase project, open **SQL Editor → New query**, paste the contents of
[`supabase-setup.sql`](./supabase-setup.sql), and run it. This creates all tables,
the ref-number and `updated_at` triggers, Row Level Security policies, and the private
`cr-attachments` storage bucket. The script is idempotent — safe to re-run.

### 2. Configure the app

Open `index.html` and set these two values near the top of the `<script>` block to
your project's values (Supabase Dashboard → **Project Settings → API**):

```js
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_KEY = "YOUR_ANON_OR_PUBLISHABLE_KEY";
```

The anon/publishable key is meant to be exposed in client-side code, so it's safe to
commit. **Never** put the `service_role` key here.

### 3. Make yourself admin

Sign up once through the portal, then run this in the SQL Editor with your email:

```sql
update public.cr_profiles set role = 'admin' where email = 'you@yourcompany.com';
```

Reload the portal and you'll land on the admin dashboard.

## Running

There's nothing to build or serve — just open `index.html` in a browser, or host it
on any static host (GitHub Pages, Netlify, Vercel, etc.).

## Data model

| Table | Purpose |
|-------|---------|
| `cr_profiles` | User profile + role (`client` / `admin`) |
| `cr_requests` | The change requests |
| `cr_status_history` | Audit trail of status changes |
| `cr_comments` | Comments on a request |
| `cr_attachments` | File metadata (files live in the `cr-attachments` bucket) |

## Security notes

- Access is enforced by Postgres Row Level Security, not just the UI.
- Only the anon/publishable key belongs in the client. Keep the service-role key secret.
- Attachments are stored in a private bucket and served via short-lived signed URLs.
