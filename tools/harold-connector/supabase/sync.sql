-- Harold <-> Linear two-way sync: the Supabase side.
-- Install AFTER the task-list migration (2026-11-18-task-list.sql, including task_links.synced_fields) and after
-- the connector is deployed with LINEAR_API_KEY, LINEAR_TEAM_KEY, LINEAR_WEBHOOK_SECRET and SYNC_SECRET set, and
-- after one authenticated MCP request (any tool call) has cached harold/projects.md in sync_state
-- 'harold-projects': without that cache every sync route answers 503 and nothing syncs.
-- NOT applied by the connector; run it by hand.
--
-- Needs two Vault secrets (Dashboard -> Project Settings -> Vault, or SQL):
--   select vault.create_secret('https://<connector host>', 'harold_connector_url');
--   select vault.create_secret('<same value as the connector''s SYNC_SECRET>', 'harold_sync_secret');
--
-- 1. A trigger on public.tasks: every insert or update made by Harold itself (changed_by = 'harold') calls
--    POST <url>/sync/push {"task_id": ...} through pg_net (asynchronous, sent after the transaction commits).
--    Writes made by the sync carry x-harold-origin, so their changed_by is 'linear' and they never fire it:
--    that is the echo guard.
-- 2. A pg_cron job every 10 minutes: POST <url>/sync/catchup, which pulls Linear changes since the cursor,
--    and pushes any Harold change the trigger missed. (harold/tasks-snapshot.md is written by authenticated MCP
--    requests, never from here: the connector holds no GitHub token of its own.)

create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function public.harold_sync_call(path text, body jsonb, timeout_ms integer)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  base   text;
  secret text;
begin
  select decrypted_secret into base   from vault.decrypted_secrets where name = 'harold_connector_url'  limit 1;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'harold_sync_secret' limit 1;
  if base is null or secret is null then
    raise warning 'harold sync: vault secrets harold_connector_url / harold_sync_secret are not set; nothing sent';
    return null;
  end if;
  return net.http_post(
    url                  := rtrim(base, '/') || path,
    body                 := body,
    headers              := jsonb_build_object('Content-Type', 'application/json', 'x-harold-sync-secret', secret),
    timeout_milliseconds := timeout_ms
  );
end;
$$;

-- Only the database itself may call it (it reads Vault).
revoke all on function public.harold_sync_call(text, jsonb, integer) from public, anon, authenticated;

create or replace function public.harold_sync_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.harold_sync_call('/sync/push', jsonb_build_object('task_id', new.id), 10000);
  return new;
exception when others then
  -- A failed enqueue must never block the owner's write; catchup picks the row up within 10 minutes.
  raise warning 'harold sync push not queued for task %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function public.harold_sync_push() from public, anon, authenticated;

drop trigger if exists tasks_sync_push on public.tasks;
create trigger tasks_sync_push
  after insert or update on public.tasks
  for each row
  when (new.changed_by = 'harold')
  execute function public.harold_sync_push();

-- Every 10 minutes. A long catchup keeps running in the connector even if pg_net stops waiting.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'harold-sync-catchup') then
    perform cron.unschedule('harold-sync-catchup');
  end if;
end;
$$;

select cron.schedule(
  'harold-sync-catchup',
  '*/10 * * * *',
  $cron$ select public.harold_sync_call('/sync/catchup', '{}'::jsonb, 55000); $cron$
);

-- First import (once, by hand, after the webhook is live):
--   select public.harold_sync_call('/sync/catchup', '{"import": true}'::jsonb, 55000);
-- or from a shell with the environment set: npm run sync:import
--
-- Check:   select * from net._http_response order by created desc limit 5;
--          select * from public.sync_log order by at desc limit 20;
-- Remove:  drop trigger tasks_sync_push on public.tasks; select cron.unschedule('harold-sync-catchup');
