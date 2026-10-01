-- ════════════════════════════════════════════════════════════════════════════
-- 002: tables and columns the web app adds on top of Harold's core schema.
--
-- 001 is Harold's own schema and is shared with Harold's MCP server. This file
-- only ADDS: new tables, and nullable or defaulted columns on Harold's tables.
-- Nothing in 001 is renamed or removed, so Harold's tools keep working against
-- the same database.
--
-- The model stays Harold's:
--   * contacts.category        the contact's ONE type, from the `categories` list
--   * contact_categories       labels: any number per contact, never the type
--   * contacts.warmth          Hot, Warm, Lukewarm, Cold, or '' (not rated)
--   * contact_pipelines        ONE pipeline; every entry has a required purpose
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── profiles: one row per signed-in user (mirrors auth.users) ───────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null default '',
  full_name   text not null default '',
  avatar_url  text,
  role        text not null default 'member' check (role in ('admin', 'member')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.harold_set_updated_at();

-- ── crm_members: who may see CRM data at all ────────────────────────────────
-- A signed-in user sees nothing unless their auth id is listed here. RLS is on
-- with NO policies (see 004), so only the service role (the SQL editor, or a
-- server holding the service key) can read or change the list.
create table if not exists public.crm_members (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  added_at  timestamptz not null default now()
);
alter table public.crm_members enable row level security;

-- True when the signed-in user is listed in crm_members. SECURITY DEFINER so it
-- can read crm_members, which no signed-in user can read directly.
create or replace function public.is_crm_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.crm_members where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_crm_member() from public;
revoke all on function public.is_crm_member() from anon;
grant execute on function public.is_crm_member() to authenticated;

-- ── categories: the owner's list of contact TYPES ───────────────────────────
-- contacts.category holds one of these names. (The table keeps the name
-- `categories` because Harold's schema calls the type column `category`.)
-- Labels are not listed here: they are free text in contact_categories, with
-- suggestions kept in enum_options under group 'label'.
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (btrim(name) <> ''),
  label       text not null,
  color       text not null default '#937860',
  sort_order  int  not null default 100,
  is_default  boolean not null default false,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

insert into public.categories (name, label, color, sort_order, is_default) values
  ('investor', 'Investors', '#DD8452', 1, true),
  ('partner',  'Partners',  '#F5D623', 2, true),
  ('founder',  'Founders',  '#55A868', 3, true),
  ('team',     'Team',      '#8172B3', 4, true),
  ('other',    'Other',     '#937860', 5, true)
on conflict (name) do nothing;

-- ── organizations: first-class companies that contacts can link to ──────────
create table if not exists public.organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (btrim(name) <> ''),
  name_normalized  text generated always as (lower(btrim(name))) stored,
  category         text not null default '',   -- optional type, from the same list as contacts
  industry         text not null default '',
  investor_type    text not null default '',
  region           text not null default '',
  website          text not null default '',
  location         text not null default '',
  notes            text not null default '',
  created_by       uuid references public.profiles (id) on delete set null,
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists idx_organizations_name_normalized on public.organizations (name_normalized);

drop trigger if exists organizations_updated_at on public.organizations;
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.harold_set_updated_at();

-- ── columns the app adds to Harold's tables ─────────────────────────────────
alter table public.contacts add column if not exists organization_id   uuid references public.organizations (id) on delete set null;
alter table public.contacts add column if not exists last_contacted_at timestamptz;   -- maintained by trigger (003)
alter table public.contacts add column if not exists created_by        uuid references public.profiles (id) on delete set null;
alter table public.contacts add column if not exists updated_by        uuid references public.profiles (id) on delete set null;
create index if not exists idx_contacts_organization      on public.contacts (organization_id);
create index if not exists idx_contacts_last_contacted_at on public.contacts (last_contacted_at);

alter table public.interactions add column if not exists user_id     uuid references public.profiles (id) on delete set null;
alter table public.interactions add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.interactions add column if not exists updated_at  timestamptz not null default now();

drop trigger if exists interactions_updated_at on public.interactions;
create trigger interactions_updated_at before update on public.interactions
  for each row execute function public.harold_set_updated_at();

alter table public.tasks add column if not exists assigned_to uuid references public.profiles (id) on delete set null;
alter table public.tasks add column if not exists created_by  uuid references public.profiles (id) on delete set null;
alter table public.tasks add column if not exists recurrence  text
  check (recurrence is null or recurrence in ('weekly', 'biweekly', 'monthly', 'quarterly'));
alter table public.tasks add column if not exists source      text not null default 'manual';
alter table public.tasks add column if not exists archived_at timestamptz;
create index if not exists idx_tasks_assigned_to on public.tasks (assigned_to);
create index if not exists idx_tasks_archived    on public.tasks (archived_at) where archived_at is not null;

alter table public.stage_changes add column if not exists changed_by uuid references public.profiles (id) on delete set null;

-- ── custom fields: owner-defined attributes on any contact ──────────────────
create table if not exists public.custom_fields (
  id          uuid primary key default gen_random_uuid(),
  field_name  text not null unique check (btrim(field_name) <> ''),
  field_type  text not null default 'text'
              check (field_type in ('text', 'number', 'date', 'select', 'textarea')),
  options     jsonb,                                  -- for 'select': ["Option A", "Option B"]
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.contact_custom_values (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.contacts (id) on delete cascade,
  field_id    uuid not null references public.custom_fields (id) on delete cascade,
  value       text,
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique (contact_id, field_id)
);
create index if not exists idx_contact_custom_values_field on public.contact_custom_values (field_id);

drop trigger if exists contact_custom_values_updated_at on public.contact_custom_values;
create trigger contact_custom_values_updated_at before update on public.contact_custom_values
  for each row execute function public.harold_set_updated_at();

-- ── audit_log: who changed what, when (written by triggers in 003) ──────────
create table if not exists public.audit_log (
  id             uuid primary key default gen_random_uuid(),
  contact_id     uuid references public.contacts (id) on delete set null,
  user_id        uuid references public.profiles (id) on delete set null,
  action         text not null
                 check (action in ('create', 'update', 'delete', 'status_change', 'note_added', 'stage_change')),
  field_changed  text,
  old_value      text,
  new_value      text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_audit_log_contact on public.audit_log (contact_id);
create index if not exists idx_audit_log_created on public.audit_log (created_at desc);

-- ── notifications: in-app alerts (overdue tasks, warmth decay, ...) ─────────
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text not null default '',
  contact_id  uuid references public.contacts (id) on delete cascade,
  task_id     uuid references public.tasks (id) on delete cascade,
  severity    text not null default 'info' check (severity in ('critical', 'warning', 'info')),
  read        boolean not null default false,
  dismissed   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_notifications_user_open on public.notifications (user_id, read) where not dismissed;

-- ── crm_settings: workspace-wide settings (warmth rules, sender profile) ────
create table if not exists public.crm_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ── user_preferences: per-user theme and notification switches ──────────────
create table if not exists public.user_preferences (
  user_id                uuid primary key references public.profiles (id) on delete cascade,
  theme                  text not null default 'dark' check (theme in ('dark', 'light')),
  notification_settings  jsonb not null default '{}'::jsonb,
  updated_at             timestamptz not null default now()
);

-- ── enum_options: editable pick lists (investor types, regions, labels) ─────
-- Warmth, status and priority are NOT here: Harold's schema fixes them with
-- CHECK constraints in 001, so they are constants in the app too.
create table if not exists public.enum_options (
  id          uuid primary key default gen_random_uuid(),
  group_name  text not null check (group_name in ('investor_type', 'region', 'label')),
  value       text not null check (btrim(value) <> ''),
  label       text not null,
  sort_order  int  not null default 0,
  is_default  boolean not null default false,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (group_name, value)
);

insert into public.enum_options (group_name, value, label, sort_order, is_default) values
  ('investor_type', 'VC',              'VC',              1, true),
  ('investor_type', 'Angel',           'Angel',           2, true),
  ('investor_type', 'Family Office',   'Family Office',   3, true),
  ('investor_type', 'PE',              'PE',              4, true),
  ('investor_type', 'Corporate',       'Corporate',       5, true),
  ('investor_type', 'Syndicate',       'Syndicate',       6, true),
  ('investor_type', 'Impact',          'Impact',          7, true),
  ('investor_type', 'Other',           'Other',           8, true),
  ('region',        'North America',   'North America',   1, true),
  ('region',        'Latin America',   'Latin America',   2, true),
  ('region',        'Europe',          'Europe',          3, true),
  ('region',        'Africa',          'Africa',          4, true),
  ('region',        'Middle East',     'Middle East',     5, true),
  ('region',        'Asia',            'Asia',            6, true),
  ('region',        'Oceania',         'Oceania',         7, true),
  ('region',        'Global',          'Global',          8, true)
on conflict (group_name, value) do nothing;
