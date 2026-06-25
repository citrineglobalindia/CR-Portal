-- =====================================================================
--  CR Portal — Supabase setup script
--  StudioAI Pro · Citrine Global India
--  Run this ONCE in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
--  Safe to re-run: it is idempotent (drops/recreates policies, uses IF NOT EXISTS).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

create table if not exists public.cr_profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  company    text,
  role       text not null default 'client',   -- 'client' | 'admin'
  created_at timestamptz not null default now()
);

create table if not exists public.cr_requests (
  id          uuid primary key default gen_random_uuid(),
  ref_no      text unique,                      -- auto-generated: CR-0001, CR-0002…
  title       text not null,
  area        text,
  type        text,
  priority    text,
  item_count  integer default 1,
  description text,
  status      text not null default 'New',
  created_by  uuid references auth.users(id) on delete set null,
  client_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.cr_status_history (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid references public.cr_requests(id) on delete cascade,
  old_status      text,
  new_status      text,
  changed_by      uuid references auth.users(id) on delete set null,
  changed_by_name text,
  note            text,
  created_at      timestamptz not null default now()
);

create table if not exists public.cr_comments (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid references public.cr_requests(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  author_name text,
  author_role text,
  body        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.cr_attachments (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid references public.cr_requests(id) on delete cascade,
  file_name   text,
  file_path   text,
  file_size   bigint,
  mime_type   text,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_cr_requests_created_by  on public.cr_requests(created_by);
create index if not exists idx_cr_requests_status      on public.cr_requests(status);
create index if not exists idx_cr_history_request      on public.cr_status_history(request_id);
create index if not exists idx_cr_comments_request     on public.cr_comments(request_id);
create index if not exists idx_cr_attachments_request  on public.cr_attachments(request_id);

-- ---------------------------------------------------------------------
-- 2. REF NUMBER GENERATION  (CR-0001, CR-0002, …)
-- ---------------------------------------------------------------------

create sequence if not exists public.cr_ref_seq start with 1;

create or replace function public.cr_set_ref_no()
returns trigger
language plpgsql
as $$
begin
  if new.ref_no is null then
    new.ref_no := 'CR-' || lpad(nextval('public.cr_ref_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cr_set_ref_no on public.cr_requests;
create trigger trg_cr_set_ref_no
  before insert on public.cr_requests
  for each row execute function public.cr_set_ref_no();

-- ---------------------------------------------------------------------
-- 3. updated_at AUTO-TOUCH
-- ---------------------------------------------------------------------

create or replace function public.cr_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_cr_touch_updated_at on public.cr_requests;
create trigger trg_cr_touch_updated_at
  before update on public.cr_requests
  for each row execute function public.cr_touch_updated_at();

-- ---------------------------------------------------------------------
-- 4. ADMIN HELPER  (SECURITY DEFINER avoids RLS recursion on cr_profiles)
-- ---------------------------------------------------------------------

create or replace function public.cr_is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.cr_profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Returns true if the current user can see a given request
create or replace function public.cr_can_see_request(req uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.cr_is_admin()
      or exists (
        select 1 from public.cr_requests
        where id = req and created_by = auth.uid()
      );
$$;

-- ---------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.cr_profiles       enable row level security;
alter table public.cr_requests        enable row level security;
alter table public.cr_status_history  enable row level security;
alter table public.cr_comments        enable row level security;
alter table public.cr_attachments     enable row level security;

-- ---- cr_profiles --------------------------------------------------
drop policy if exists p_profiles_select on public.cr_profiles;
create policy p_profiles_select on public.cr_profiles
  for select to authenticated
  using (id = auth.uid() or public.cr_is_admin());

drop policy if exists p_profiles_insert on public.cr_profiles;
create policy p_profiles_insert on public.cr_profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists p_profiles_update on public.cr_profiles;
create policy p_profiles_update on public.cr_profiles
  for update to authenticated
  using (id = auth.uid() or public.cr_is_admin())
  with check (id = auth.uid() or public.cr_is_admin());

-- ---- cr_requests --------------------------------------------------
drop policy if exists p_requests_select on public.cr_requests;
create policy p_requests_select on public.cr_requests
  for select to authenticated
  using (created_by = auth.uid() or public.cr_is_admin());

drop policy if exists p_requests_insert on public.cr_requests;
create policy p_requests_insert on public.cr_requests
  for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists p_requests_update on public.cr_requests;
create policy p_requests_update on public.cr_requests
  for update to authenticated
  using (public.cr_is_admin())
  with check (public.cr_is_admin());

-- ---- cr_status_history -------------------------------------------
drop policy if exists p_history_select on public.cr_status_history;
create policy p_history_select on public.cr_status_history
  for select to authenticated
  using (public.cr_can_see_request(request_id));

drop policy if exists p_history_insert on public.cr_status_history;
create policy p_history_insert on public.cr_status_history
  for insert to authenticated
  with check (changed_by = auth.uid() and public.cr_can_see_request(request_id));

-- ---- cr_comments --------------------------------------------------
drop policy if exists p_comments_select on public.cr_comments;
create policy p_comments_select on public.cr_comments
  for select to authenticated
  using (public.cr_can_see_request(request_id));

drop policy if exists p_comments_insert on public.cr_comments;
create policy p_comments_insert on public.cr_comments
  for insert to authenticated
  with check (author_id = auth.uid() and public.cr_can_see_request(request_id));

-- ---- cr_attachments ----------------------------------------------
drop policy if exists p_attachments_select on public.cr_attachments;
create policy p_attachments_select on public.cr_attachments
  for select to authenticated
  using (public.cr_can_see_request(request_id));

drop policy if exists p_attachments_insert on public.cr_attachments;
create policy p_attachments_insert on public.cr_attachments
  for insert to authenticated
  with check (uploaded_by = auth.uid() and public.cr_can_see_request(request_id));

-- ---------------------------------------------------------------------
-- 6. STORAGE BUCKET + POLICIES  (cr-attachments, private)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('cr-attachments', 'cr-attachments', false)
on conflict (id) do nothing;

drop policy if exists p_storage_cr_select on storage.objects;
create policy p_storage_cr_select on storage.objects
  for select to authenticated
  using (bucket_id = 'cr-attachments');

drop policy if exists p_storage_cr_insert on storage.objects;
create policy p_storage_cr_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cr-attachments');

-- =====================================================================
-- 7. MAKE YOURSELF ADMIN
--    Sign up in the portal first, THEN run the line below with your email.
-- =====================================================================
-- update public.cr_profiles set role = 'admin' where email = 'you@yourcompany.com';
