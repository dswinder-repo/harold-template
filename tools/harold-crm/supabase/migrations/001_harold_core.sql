-- ════════════════════════════════════════════════════════════════════════════
-- Harold CRM — database schema for tools/harold-mcp/server.js
--
-- Creates exactly the tables and columns the harold-mcp server reads and writes:
--   contacts, contact_categories, contact_pipelines, pipeline_stages,
--   stage_changes, interactions, tasks (Harold's own task list), task_links, sync_log, sync_state
-- (bin/harold close also reads contacts.name / contacts.updated_at to see which
-- contacts were written today.)
--
-- How to use: create a Supabase project in YOUR OWN account (the CRM is yours,
-- not your employer's), open the SQL editor, paste this whole file, run it once.
-- Then run bin/harold-setup-crm to store the project URL and service_role key in
-- ~/.harold/env. Nothing here contains a key.
--
-- One schema, one source: the CRM web app's first migration,
-- tools/harold-crm/supabase/migrations/001_harold_core.sql, is a byte-for-byte
-- copy of this file (tests/crm.test.js fails if they differ). Edit this
-- file, then copy it there.
--
-- The model:
--   * Type    — contacts.category: exactly one per contact, from YOUR list
--               (e.g. investor, partner, founder, team, other).
--   * Labels  — contact_categories: any number per contact, never a copy of the type.
--   * Warmth  — contacts.warmth: Hot, Warm, Lukewarm, Cold, or '' (not rated).
--   * Pipeline— contact_pipelines: ONE pipeline; each entry has a required
--               purpose and one of seven stages (pipeline_stages).
--
-- Security: row-level security is ON for every table and no policies are
-- created, so the anon/publishable key can read nothing. harold-mcp uses the
-- service_role key, which bypasses RLS. The web app in tools/harold-crm adds
-- members-only policies for the `authenticated` role in its migration 004.
--
-- Safe to re-run: every statement is IF NOT EXISTS / OR REPLACE / ON CONFLICT.
-- ════════════════════════════════════════════════════════════════════════════

-- gen_random_uuid() is built into Postgres 13+ (Supabase included).

-- ── shared trigger function: keep updated_at honest ─────────────────────────
create or replace function public.harold_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── contacts ────────────────────────────────────────────────────────────────
create table if not exists public.contacts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  org           text not null default '',
  category      text not null default 'other'           -- the contact's ONE type, from your own list
                check (btrim(category) <> ''),
  warmth        text not null default ''
                check (warmth in ('', 'Cold', 'Lukewarm', 'Warm', 'Hot')),
  status        text not null default 'pending'
                check (status in ('active', 'pending', 'cold', 'archived')),
  priority      text not null default 'medium'
                check (priority in ('high', 'medium', 'low')),
  email         text default '',
  phone         text default '',
  location      text default '',
  website       text default '',
  notes         text default '',
  region        text default '',
  investor_type text default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_contacts_name       on public.contacts (lower(name));
create index if not exists idx_contacts_category   on public.contacts (category);
create index if not exists idx_contacts_status     on public.contacts (status);
create index if not exists idx_contacts_updated_at on public.contacts (updated_at desc);

drop trigger if exists contacts_updated_at on public.contacts;
create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.harold_set_updated_at();

-- ── contact_categories (labels) ─────────────────────────────────────────────
create table if not exists public.contact_categories (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references public.contacts (id) on delete cascade,
  category_name text not null check (btrim(category_name) <> ''),
  created_at    timestamptz not null default now(),
  unique (contact_id, category_name)                    -- harold_upsert_contact upserts on this pair
);
create index if not exists idx_contact_categories_name on public.contact_categories (category_name);

-- ── pipeline_stages (the seven stages, in order, with follow-up cadence) ────
create table if not exists public.pipeline_stages (
  stage_name      text primary key,
  stage_order     int  not null unique,
  description     text not null default '',
  default_cadence text not null default ''
                  check (default_cadence in ('', 'weekly', 'biweekly', 'monthly', 'quarterly'))
);
insert into public.pipeline_stages (stage_name, stage_order, description, default_cadence) values
  ('Identified',      1, 'Worth knowing for this purpose. No contact made yet.',                              'monthly'),
  ('Reached Out',     2, 'Contact made, waiting on a reply.',                                                 'weekly'),
  ('In Conversation', 3, 'Live back and forth. Exploring whether there is something here.',                   'weekly'),
  ('Advancing',       4, 'Something concrete is in motion: a deal, a role, a scope, a proposal.',             'weekly'),
  ('Committed',       5, 'Agreed in substance: offer, term sheet, signed agreement, confirmed yes.',          'biweekly'),
  ('Active',          6, 'Live working relationship, delivering or invested.',                                'monthly'),
  ('Dormant',         7, 'Went quiet, passed, or parked. Kept for the record.',                               'quarterly')
on conflict (stage_name) do nothing;

-- ── contact_pipelines (ONE pipeline; every entry states its purpose) ────────
create table if not exists public.contact_pipelines (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.contacts (id) on delete cascade,
  stage       text not null default 'Identified'
              references public.pipeline_stages (stage_name) on update cascade,
  purpose     text not null check (btrim(purpose) <> ''),   -- why this person is in the pipeline; required
  project     text,                                          -- optional: project name/slug from harold/projects.md
  entered_at  timestamptz not null default now(),            -- when the current stage was entered
  outcome     text not null default '',                      -- how it ended (set on close)
  closed_at   timestamptz,                                   -- null = open entry
  created_at  timestamptz not null default now()
);
create index if not exists idx_contact_pipelines_contact on public.contact_pipelines (contact_id);
create index if not exists idx_contact_pipelines_open    on public.contact_pipelines (stage) where closed_at is null;
create index if not exists idx_contact_pipelines_project on public.contact_pipelines (project);

-- ── stage_changes (dated record of every stage move) ────────────────────────
create table if not exists public.stage_changes (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.contacts (id) on delete cascade,
  entry_id    uuid references public.contact_pipelines (id) on delete set null,
  from_stage  text,                                          -- null for the first placement
  to_stage    text not null,
  notes       text not null default '',
  changed_at  timestamptz not null default now()
);
create index if not exists idx_stage_changes_contact on public.stage_changes (contact_id, changed_at desc);

-- ── interactions (every meaningful touchpoint) ──────────────────────────────
create table if not exists public.interactions (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid not null references public.contacts (id) on delete cascade,
  type         text not null check (type in ('call', 'email', 'meeting', 'note', 'linkedin', 'other')),
  subject      text not null default '',
  body         text not null default '',
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_interactions_contact on public.interactions (contact_id, occurred_at desc);

-- Logging an interaction counts as writing the contact today. bin/harold close
-- checks contacts.updated_at to decide whether a touched contact was filed.
create or replace function public.harold_touch_contact()
returns trigger language plpgsql as $$
begin
  update public.contacts set updated_at = now() where id = new.contact_id;
  return new;
end;
$$;
drop trigger if exists interactions_touch_contact on public.interactions;
create trigger interactions_touch_contact after insert on public.interactions
  for each row execute function public.harold_touch_contact();

-- ── tasks: Harold's own task list ──────────────────────────────────────────
-- One table, read and written by boot, close, bin/harold task, the connector and the CRM web app. A task may
-- belong to a contact, a project, both or neither. Outside task managers (Linear first) are kept in step through
-- task_links and the sync; Harold works with none connected. The block after the table (ref, project, source,
-- changed_by, task_links, sync_log, sync_state) is also in migrations/2026-11-18-task-list.sql, which brings a
-- database made before it up to date. Both are idempotent: running either twice changes nothing.
create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid references public.contacts (id) on delete cascade,
  title         text not null,
  description   text not null default '',
  status        text not null default 'pending'
                check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  priority      text not null default 'medium'
                check (priority in ('high', 'medium', 'low')),
  due_date      timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_tasks_contact    on public.tasks (contact_id);
create index if not exists idx_tasks_open_due   on public.tasks (due_date) where status in ('pending', 'in_progress');

drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.harold_set_updated_at();

-- Task list additions: a readable ref (H-1, H-2, ...), a project, who made each change, links to outside tools
-- and a sync log.
-- A due date is a calendar day. It is stored as midnight UTC and read as the first 10 characters of the value,
-- with no time-zone conversion. Only "today" uses your time zone (HAROLD_TZ).
create sequence if not exists public.task_ref_seq;

alter table public.tasks
  add column if not exists ref        text,
  add column if not exists project    text,
  add column if not exists source     text not null default 'harold',
  add column if not exists changed_by text not null default 'harold';

update public.tasks set ref = 'H-' || nextval('public.task_ref_seq') where ref is null;
alter table public.tasks alter column ref set default ('H-' || nextval('public.task_ref_seq'));
alter table public.tasks alter column ref set not null;
create unique index if not exists idx_tasks_ref     on public.tasks (ref);
create index        if not exists idx_tasks_project on public.tasks (project);
create index        if not exists idx_tasks_updated on public.tasks (updated_at);

-- Who made this change. Default 'harold'. The sync engine sends the HTTP header
-- "x-harold-origin: <provider>" through PostgREST, so its own writes are marked and never echoed back.
create or replace function public.harold_task_origin() returns trigger
language plpgsql as $$
declare origin text;
begin
  begin
    origin := nullif(current_setting('request.headers', true)::json ->> 'x-harold-origin', '');
  exception when others then origin := null;
  end;
  new.changed_by := coalesce(origin, 'harold');
  if tg_op = 'INSERT' and origin is not null and new.source = 'harold' then new.source := origin; end if;
  if new.status = 'completed' and new.completed_at is null then new.completed_at := now(); end if;
  if new.status <> 'completed' then new.completed_at := null; end if;
  return new;
end;
$$;
drop trigger if exists tasks_origin on public.tasks;
create trigger tasks_origin before insert or update on public.tasks
  for each row execute function public.harold_task_origin();

create table if not exists public.task_links (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid not null references public.tasks (id) on delete cascade,
  provider            text not null,
  external_id         text not null,
  external_key        text,
  external_url        text,
  external_updated_at timestamptz,
  synced_at           timestamptz,
  synced_fields       jsonb,        -- the field values both sides last agreed on, for a field-level merge
  created_at          timestamptz not null default now(),
  unique (provider, external_id),
  unique (task_id, provider)
);

alter table public.task_links add column if not exists synced_fields jsonb;

create table if not exists public.sync_log (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  provider  text not null,
  task_id   uuid references public.tasks (id) on delete set null,
  kind      text not null check (kind in ('conflict', 'error', 'import', 'push', 'pull', 'skip')),
  detail    jsonb not null default '{}'::jsonb,
  seen      boolean not null default false
);
create index if not exists idx_sync_log_unseen on public.sync_log (at) where seen = false;

create table if not exists public.sync_state (
  provider   text primary key,
  cursor     timestamptz,
  detail     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ── row-level security: on everywhere, no policies (service_role only) ──────
alter table public.contacts           enable row level security;
alter table public.contact_categories enable row level security;
alter table public.pipeline_stages    enable row level security;
alter table public.contact_pipelines  enable row level security;
alter table public.stage_changes      enable row level security;
alter table public.interactions       enable row level security;
alter table public.tasks              enable row level security;
alter table public.task_links         enable row level security;
alter table public.sync_log           enable row level security;
alter table public.sync_state         enable row level security;
