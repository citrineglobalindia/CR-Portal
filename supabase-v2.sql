-- =====================================================================
--  CR Portal — v2 schema additions
--  Run AFTER supabase-setup.sql. Adds admin-provisioned clients,
--  per-client CR numbering (CR-<code>-<n>), client logos, and the
--  first-run setup detector. Idempotent / safe to re-run.
-- =====================================================================

-- ---- Profile fields for admin-provisioned clients ----
alter table public.cr_profiles
  add column if not exists username     text,
  add column if not exists notify_email text,
  add column if not exists phone        text,
  add column if not exists address      text,
  add column if not exists gst_no       text,
  add column if not exists website      text,
  add column if not exists client_code  text,
  add column if not exists cr_prefix    text,   -- admin-defined, e.g. 'CR-BHO' -> CR-BHO-1, CR-BHO-2
  add column if not exists logo_path    text;

create unique index if not exists uq_cr_profiles_username    on public.cr_profiles (lower(username))    where username    is not null;
create unique index if not exists uq_cr_profiles_client_code on public.cr_profiles (lower(client_code)) where client_code is not null;

-- ---- Per-client CR numbering: CR-<client_code>-<n> ----
alter table public.cr_requests add column if not exists client_code text;

create table if not exists public.cr_client_seq (
  client_code text primary key,
  last_no     int not null default 0
);
-- RLS on, no policies: reachable only through the SECURITY DEFINER trigger below.
alter table public.cr_client_seq enable row level security;

create or replace function public.cr_set_ref_no()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare code text; pfx text; n int;
begin
  if new.ref_no is not null then return new; end if;
  select client_code, cr_prefix into code, pfx from public.cr_profiles where id = new.created_by;
  if code is null or code = '' then code := 'CLIENT'; end if;
  if pfx is null or pfx = '' then pfx := 'CR-' || code; end if;
  insert into public.cr_client_seq (client_code, last_no) values (code, 1)
    on conflict (client_code) do update set last_no = public.cr_client_seq.last_no + 1
    returning last_no into n;
  new.client_code := code;
  new.ref_no := pfx || '-' || n;   -- e.g. CR-BHO-1, CR-BHO-2 (per-client, starts at 1)
  return new;
end;
$$;
revoke execute on function public.cr_set_ref_no() from public, anon, authenticated;

-- ---- First-run setup detector (true when no admin exists) ----
create or replace function public.cr_needs_setup()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.cr_profiles where role = 'admin');
$$;
grant execute on function public.cr_needs_setup() to anon, authenticated;

-- ---- Public bucket for client logos ----
insert into storage.buckets (id, name, public)
values ('cr-logos', 'cr-logos', true)
on conflict (id) do nothing;

-- Public buckets serve objects by URL without a SELECT policy; only
-- authenticated users (admins) may upload/replace logos.
drop policy if exists p_logos_insert on storage.objects;
create policy p_logos_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'cr-logos');

drop policy if exists p_logos_update on storage.objects;
create policy p_logos_update on storage.objects
  for update to authenticated using (bucket_id = 'cr-logos');

-- =====================================================================
-- EDGE FUNCTIONS (deploy separately; see supabase/functions/ in repo)
--   bootstrap-admin      — creates the first admin (only while none exists)
--   admin-create-client  — admin provisions a client (username + password + details + logo + CR prefix)
--   admin-update-client  — admin edits client details/logo/CR prefix and resets the client password
--   send-notification    — emails admin on new CR / client on status change (Gmail SMTP)
--
-- Required Edge Function secrets (Dashboard → Edge Functions → Manage secrets):
--   SMTP_USER = your Gmail address
--   SMTP_PASS = a Gmail App Password (16 chars; requires 2-Step Verification)
-- =====================================================================
