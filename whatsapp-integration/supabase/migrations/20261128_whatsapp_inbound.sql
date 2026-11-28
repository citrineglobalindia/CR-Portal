-- StepStones CRM — Inbound Click-to-WhatsApp lead capture (additive, safe)
-- Scope: inbound capture + Meta ad attribution ONLY. Nothing existing altered.
-- Apply with the service role (SQL editor) on project kiwyasoqgsydpofaffyp.

create table if not exists cr_wa_numbers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references cr_profiles(id) on delete cascade,
  phone_number_id text not null unique,
  display_number text, label text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cr_wa_ad_map (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references cr_profiles(id) on delete cascade,
  meta_ad_id text not null,
  project_id uuid references cr_projects(id) on delete set null,
  campaign_id text, adset_id text, label text,
  created_at timestamptz not null default now(),
  unique (client_id, meta_ad_id)
);

create table if not exists cr_wa_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references cr_profiles(id) on delete cascade,
  wa_id text not null, display_name text, phone text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (client_id, wa_id)
);

create table if not exists cr_wa_enquiries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references cr_profiles(id) on delete cascade,
  contact_id uuid not null references cr_wa_contacts(id) on delete cascade,
  project_id uuid references cr_projects(id) on delete set null,
  lead_id uuid references cr_leads(id) on delete set null,
  source_type text, source_id text, ctwa_clid text,
  ad_id text, adset_id text, campaign_id text,
  ad_headline text, ad_body text, ad_media_url text,
  attribution text not null default 'unknown',
  status text not null default 'open',
  first_message_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists cr_wa_enq_client_idx  on cr_wa_enquiries(client_id);
create index if not exists cr_wa_enq_contact_idx on cr_wa_enquiries(contact_id);
create index if not exists cr_wa_enq_project_idx on cr_wa_enquiries(project_id);
create index if not exists cr_wa_enq_adid_idx    on cr_wa_enquiries(ad_id);

create table if not exists cr_wa_messages (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references cr_wa_enquiries(id) on delete cascade,
  client_id uuid not null references cr_profiles(id) on delete cascade,
  wa_message_id text not null unique,
  direction text not null default 'in',
  wa_from text, wa_timestamp timestamptz,
  msg_type text, body text, media_meta jsonb, referral jsonb,
  created_at timestamptz not null default now()
);
create index if not exists cr_wa_msg_enq_idx on cr_wa_messages(enquiry_id);

create table if not exists cr_wa_events (
  id uuid primary key default gen_random_uuid(),
  phone_number_id text,
  client_id uuid references cr_profiles(id) on delete set null,
  signature_valid boolean, status text, detail text, payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists cr_wa_events_created_idx on cr_wa_events(created_at desc);

alter table cr_leads add column if not exists wa_enquiry_id uuid references cr_wa_enquiries(id) on delete set null;
alter table cr_leads add column if not exists wa_contact_id uuid references cr_wa_contacts(id) on delete set null;
alter table cr_leads add column if not exists client_id     uuid references cr_profiles(id) on delete set null;
alter table cr_leads add column if not exists project_id    uuid references cr_projects(id) on delete set null;
alter table cr_leads add column if not exists meta_ad_id    text;

alter table cr_wa_numbers   enable row level security;
alter table cr_wa_ad_map    enable row level security;
alter table cr_wa_contacts  enable row level security;
alter table cr_wa_enquiries enable row level security;
alter table cr_wa_messages  enable row level security;
alter table cr_wa_events    enable row level security;

do $$
declare staff text[] := array['admin','super_admin','account_manager','manager','team_member'];
begin
  if not exists (select 1 from pg_policies where tablename='cr_wa_numbers' and policyname='wa_numbers_staff_read') then
    create policy wa_numbers_staff_read on cr_wa_numbers for select to authenticated
      using (exists (select 1 from cr_profiles p where p.id=auth.uid() and p.role=any(staff)) or client_id=auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='cr_wa_ad_map' and policyname='wa_admap_staff_read') then
    create policy wa_admap_staff_read on cr_wa_ad_map for select to authenticated
      using (exists (select 1 from cr_profiles p where p.id=auth.uid() and p.role=any(staff)) or client_id=auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='cr_wa_contacts' and policyname='wa_contacts_staff_read') then
    create policy wa_contacts_staff_read on cr_wa_contacts for select to authenticated
      using (exists (select 1 from cr_profiles p where p.id=auth.uid() and p.role=any(staff)) or client_id=auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='cr_wa_enquiries' and policyname='wa_enq_staff_read') then
    create policy wa_enq_staff_read on cr_wa_enquiries for select to authenticated
      using (exists (select 1 from cr_profiles p where p.id=auth.uid() and p.role=any(staff)) or client_id=auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='cr_wa_messages' and policyname='wa_msg_staff_read') then
    create policy wa_msg_staff_read on cr_wa_messages for select to authenticated
      using (exists (select 1 from cr_profiles p where p.id=auth.uid() and p.role=any(staff)) or client_id=auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='cr_wa_events' and policyname='wa_events_admin_read') then
    create policy wa_events_admin_read on cr_wa_events for select to authenticated
      using (exists (select 1 from cr_profiles p where p.id=auth.uid() and p.role in ('admin','super_admin')));
  end if;
  if not exists (select 1 from pg_policies where tablename='cr_wa_numbers' and policyname='wa_numbers_admin_write') then
    create policy wa_numbers_admin_write on cr_wa_numbers for all to authenticated
      using (exists (select 1 from cr_profiles p where p.id=auth.uid() and p.role in ('admin','super_admin')))
      with check (exists (select 1 from cr_profiles p where p.id=auth.uid() and p.role in ('admin','super_admin')));
  end if;
  if not exists (select 1 from pg_policies where tablename='cr_wa_ad_map' and policyname='wa_admap_admin_write') then
    create policy wa_admap_admin_write on cr_wa_ad_map for all to authenticated
      using (exists (select 1 from cr_profiles p where p.id=auth.uid() and p.role in ('admin','super_admin')))
      with check (exists (select 1 from cr_profiles p where p.id=auth.uid() and p.role in ('admin','super_admin')));
  end if;
  if not exists (select 1 from pg_policies where tablename='cr_wa_enquiries' and policyname='wa_enq_admin_update') then
    create policy wa_enq_admin_update on cr_wa_enquiries for update to authenticated
      using (exists (select 1 from cr_profiles p where p.id=auth.uid() and p.role in ('admin','super_admin','account_manager','manager')))
      with check (true);
  end if;
end $$;
