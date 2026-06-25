-- =====================================================================
--  CR Portal — v3 schema additions
--  Run AFTER supabase-setup.sql and supabase-v2.sql. Idempotent.
--  Adds: in-portal notifications, login resolver, client reopen,
--  expected/needed-by date, and actor-aware status notifications.
-- =====================================================================

-- ---- CR expected date ----
alter table public.cr_requests add column if not exists due_date date;

-- ---- In-portal notifications ----
create table if not exists public.cr_notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  request_id uuid references public.cr_requests(id) on delete cascade,
  title      text,
  body       text,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_cr_notifications_user on public.cr_notifications (user_id, is_read, created_at desc);
alter table public.cr_notifications enable row level security;

drop policy if exists p_notif_select on public.cr_notifications;
create policy p_notif_select on public.cr_notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists p_notif_update on public.cr_notifications;
create policy p_notif_update on public.cr_notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- Actor-aware status-change notifications ----
--   admin changes status  -> notify client (request owner)
--   client changes status -> notify all admins (e.g. a reopen)
create or replace function public.cr_notify_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  if new.created_by is not null and new.status is distinct from old.status then
    actor := auth.uid();
    if actor = new.created_by then
      insert into public.cr_notifications (user_id, request_id, title, body)
      select p.id, new.id, 'Request reopened by client',
             'Client reopened ' || new.ref_no || ' (' || coalesce(new.title,'') || '). It is now ' || new.status || '.'
      from public.cr_profiles p where p.role = 'admin';
    else
      insert into public.cr_notifications (user_id, request_id, title, body)
      values (new.created_by, new.id,
        case when new.status = 'Done' then 'Change request completed' else 'Status updated' end,
        case when new.status = 'Done'
          then 'Your change request ' || new.ref_no || ' (' || coalesce(new.title,'') || ') has been completed.'
          else 'Your change request ' || new.ref_no || ' (' || coalesce(new.title,'') || ') is now ' || new.status || '.'
        end);
    end if;
  end if;
  return new;
end; $$;
revoke execute on function public.cr_notify_status() from public, anon, authenticated;

drop trigger if exists trg_cr_notify_status on public.cr_requests;
create trigger trg_cr_notify_status after update on public.cr_requests
  for each row execute function public.cr_notify_status();

-- ---- Notify admins in-portal on new CR ----
create or replace function public.cr_notify_new()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.cr_notifications (user_id, request_id, title, body)
  select p.id, new.id, 'New change request',
         'New request ' || new.ref_no || ' from ' || coalesce(new.client_name,'a client') || ': ' || coalesce(new.title,'')
  from public.cr_profiles p where p.role = 'admin';
  return new;
end; $$;
revoke execute on function public.cr_notify_new() from public, anon, authenticated;

drop trigger if exists trg_cr_notify_new on public.cr_requests;
create trigger trg_cr_notify_new after insert on public.cr_requests
  for each row execute function public.cr_notify_new();

-- ---- Login resolver (username / notification email / login email -> auth email) ----
create or replace function public.cr_resolve_login(identifier text)
returns text language sql security definer set search_path = '' as $$
  select email from public.cr_profiles
  where lower(username) = lower(identifier)
     or lower(notify_email) = lower(identifier)
     or lower(email) = lower(identifier)
  limit 1;
$$;
grant execute on function public.cr_resolve_login(text) to anon, authenticated;

-- ---- Client reopen (mark completed CR as not completed) ----
create or replace function public.cr_reopen(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare r record; nm text;
begin
  select * into r from public.cr_requests where id = p_id;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.created_by <> auth.uid() then raise exception 'You can only reopen your own requests'; end if;
  if r.status <> 'Done' then raise exception 'Only completed requests can be reopened'; end if;
  update public.cr_requests set status = 'In Review' where id = p_id;
  select coalesce(full_name, username, 'Client') into nm from public.cr_profiles where id = auth.uid();
  insert into public.cr_status_history (request_id, old_status, new_status, changed_by, changed_by_name, note)
    values (p_id, 'Done', 'In Review', auth.uid(), nm, 'Reopened by client (marked as not completed)');
  return 'In Review';
end; $$;
grant execute on function public.cr_reopen(uuid) to authenticated;

-- Edge function added in this round: admin-create-cr (admin raises a CR for a client).
