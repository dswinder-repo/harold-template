-- Harold's own task list: brings a database made before it up to date.
-- Run it once in the Supabase SQL editor (playbook/core/setup.md, step 8). A new database does not need it:
-- tools/harold-mcp/schema.sql already contains all of this.
-- Additive and idempotent: running it twice changes nothing.
-- Adds readable refs (H-1, H-2...), a project, origin tracking, links to outside tools and a sync log.
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

alter table public.task_links add column if not exists synced_fields jsonb;

create table if not exists public.sync_state (
  provider   text primary key,
  cursor     timestamptz,
  detail     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.task_links enable row level security;
alter table public.sync_log   enable row level security;
alter table public.sync_state enable row level security;
