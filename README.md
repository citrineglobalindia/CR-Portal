# CR Portal — StudioAI Pro

A Change Request portal for **Stepstones Global India**. Admins provision client accounts;
clients log in to raise change requests (heading, description, photos) and track their
status; admins review everything, change statuses, comment, and export reports. Email
notifications keep both sides informed. Single-page app backed by Supabase
(Postgres + Auth + Storage + Edge Functions).

**Live:** https://cr-portal.vercel.app

## Features

- **Admin-provisioned clients** — admins create client accounts with a username +
  password, contact email, business details (company, phone, address, GST/Tax ID,
  website) and a **logo**. Public self-signup is disabled.
- **Client login** by username + password (mapped to an internal login email);
  the contact email is used only for notifications.
- **First-run setup** — the very first visit lets you create the admin account; after
  that the screen is login-only.
- **Per-client CR numbering** — references auto-generate as `CR-<code>-<n>`
  (e.g. `CR-BharatOne-1`, `CR-BharatOne-2`).
- **Change requests** with heading, description and photo upload; clients track status.
- **Admin dashboard** — stats, search/filter, inline status changes, status history,
  comments, photo previews, and a client directory with logos.
- **Email notifications** (Gmail SMTP) — admins emailed on each new CR; the client
  emailed on every status change.
- **Exports** — Excel, PDF, Word and CSV, respecting active filters.
- Row Level Security throughout: clients see only their own requests; admins see all.

## Tech

- Frontend: a single `index.html` (vanilla JS, no framework)
- Backend: [Supabase](https://supabase.com) — Postgres, Auth, Storage, Edge Functions
- Edge Functions (Deno/TypeScript) in `supabase/functions/`
- Libraries (CDN): supabase-js, SheetJS, jsPDF + autotable

## Setup

### 1. Database

In the Supabase SQL Editor run, in order:

1. [`supabase-setup.sql`](./supabase-setup.sql) — base tables, RLS, triggers, storage.
2. [`supabase-v2.sql`](./supabase-v2.sql) — client fields, per-client numbering,
   logos bucket, first-run detector.

### 2. Edge Functions

Deploy the three functions in [`supabase/functions/`](./supabase/functions):

```bash
supabase functions deploy bootstrap-admin --no-verify-jwt
supabase functions deploy admin-create-client --no-verify-jwt
supabase functions deploy send-notification --no-verify-jwt
```

(They implement their own auth checks internally.)

### 3. Email (Gmail) secrets

In **Dashboard → Edge Functions → Manage secrets**, add:

| Secret | Value |
|--------|-------|
| `SMTP_USER` | your Gmail address |
| `SMTP_PASS` | a Gmail **App Password** (16 chars — requires 2-Step Verification) |

Until these are set, the app still works; notification emails are simply skipped.

### 4. Configure the app

In `index.html`, set `SUPABASE_URL` and `SUPABASE_KEY` (anon/publishable key) to your
project's values (Dashboard → Project Settings → API). The anon key is safe in
client-side code; never put the service-role key here.

### 5. First run

Open the app — it will prompt you to create the admin account. After that, log in and
use the **Clients** tab to create client accounts.

## How login works

- **Admin** logs in with their email + password.
- **Clients** log in with the username + password the admin set. Behind the scenes the
  username maps to an internal address (`<username>@clients.crportal.app`) used purely as
  the auth identity; the client's real email is stored separately for notifications.

## Data model

| Table | Purpose |
|-------|---------|
| `cr_profiles` | Users + role, client business details, username, logo |
| `cr_requests` | Change requests (per-client `CR-<code>-<n>` refs) |
| `cr_client_seq` | Per-client counters for ref numbers |
| `cr_status_history` | Audit trail of status changes |
| `cr_comments` | Comments on a request |
| `cr_attachments` | CR photos/files (private `cr-attachments` bucket) |

Logos live in the public `cr-logos` bucket.

## Security notes

- Access is enforced by Postgres Row Level Security, not just the UI.
- Client accounts are created server-side via the `admin-create-client` Edge Function
  (service-role key stays on the server, never in the browser).
- Only the anon/publishable key belongs in the client. Keep the service-role key secret.
- CR photos are private (served via short-lived signed URLs); logos are public.
