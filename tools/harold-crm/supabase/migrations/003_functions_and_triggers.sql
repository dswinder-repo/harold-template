-- ════════════════════════════════════════════════════════════════════════════
-- 003: functions and triggers.
--
--   * a profile row for every new auth user (the first one becomes admin)
--   * the audit trail: contact field changes, custom field values, interactions,
--     tasks and pipeline entries all write to audit_log
--   * contacts.last_contacted_at kept current from interactions
--   * tasks.completed_at set and cleared with the status
--   * merge_contacts(): fold a duplicate into the record you keep
--   * archive_old_completed_tasks(): tidy completed tasks (call it, or schedule it)
--
-- These triggers fire for writes from Harold's MCP server too (it uses the
-- service role), so the audit trail covers both. Where a write has no signed-in
-- user, the audit row's user_id is null.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── profiles for new users ──────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    -- The first person to sign up administers the workspace. Everyone after is a member.
    case when exists (select 1 from public.profiles where role = 'admin') then 'member' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── audit: contact field changes ────────────────────────────────────────────
create or replace function public.log_contact_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (contact_id, user_id, action, new_value)
    values (new.id, new.created_by, 'create', new.name || ' (' || coalesce(new.org, '') || ')');
    return new;

  elsif tg_op = 'UPDATE' then
    if old.name is distinct from new.name then
      insert into public.audit_log (contact_id, user_id, action, field_changed, old_value, new_value)
      values (new.id, new.updated_by, 'update', 'name', old.name, new.name);
    end if;
    if old.org is distinct from new.org then
      insert into public.audit_log (contact_id, user_id, action, field_changed, old_value, new_value)
      values (new.id, new.updated_by, 'update', 'org', old.org, new.org);
    end if;
    if old.category is distinct from new.category then
      insert into public.audit_log (contact_id, user_id, action, field_changed, old_value, new_value)
      values (new.id, new.updated_by, 'update', 'type', old.category, new.category);
    end if;
    if old.warmth is distinct from new.warmth then
      insert into public.audit_log (contact_id, user_id, action, field_changed, old_value, new_value)
      values (new.id, new.updated_by, 'update', 'warmth', old.warmth, new.warmth);
    end if;
    if old.status is distinct from new.status then
      insert into public.audit_log (contact_id, user_id, action, field_changed, old_value, new_value)
      values (new.id, new.updated_by, 'status_change', 'status', old.status, new.status);
    end if;
    if old.priority is distinct from new.priority then
      insert into public.audit_log (contact_id, user_id, action, field_changed, old_value, new_value)
      values (new.id, new.updated_by, 'update', 'priority', old.priority, new.priority);
    end if;
    if old.email is distinct from new.email then
      insert into public.audit_log (contact_id, user_id, action, field_changed, old_value, new_value)
      values (new.id, new.updated_by, 'update', 'email', old.email, new.email);
    end if;
    if old.notes is distinct from new.notes then
      insert into public.audit_log (contact_id, user_id, action, field_changed, old_value, new_value)
      values (new.id, new.updated_by, 'note_added', 'notes', old.notes, new.notes);
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    -- AFTER DELETE: the row is gone, so the audit row cannot reference it.
    insert into public.audit_log (contact_id, user_id, action, old_value)
    values (null, old.updated_by, 'delete', old.name || ' (' || coalesce(old.org, '') || ')');
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists contact_audit_trigger on public.contacts;
create trigger contact_audit_trigger
  after insert or update or delete on public.contacts
  for each row execute function public.log_contact_change();

-- ── audit: custom field values ──────────────────────────────────────────────
create or replace function public.log_custom_field_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fname text;
begin
  select field_name into fname from public.custom_fields where id = new.field_id;
  if tg_op = 'INSERT' and new.value is not null then
    insert into public.audit_log (contact_id, user_id, action, field_changed, new_value)
    values (new.contact_id, new.updated_by, 'update', fname, new.value);
  elsif tg_op = 'UPDATE' and old.value is distinct from new.value then
    insert into public.audit_log (contact_id, user_id, action, field_changed, old_value, new_value)
    values (new.contact_id, new.updated_by, 'update', fname, old.value, new.value);
  end if;
  return new;
end;
$$;

drop trigger if exists on_custom_value_change on public.contact_custom_values;
create trigger on_custom_value_change
  after insert or update on public.contact_custom_values
  for each row execute function public.log_custom_field_change();

-- ── audit: interactions ─────────────────────────────────────────────────────
create or replace function public.log_interaction_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (contact_id, user_id, action, field_changed, new_value)
  values (
    new.contact_id, new.user_id, 'update', 'interaction',
    new.type || ': ' || coalesce(nullif(new.subject, ''), left(new.body, 80))
  );
  return new;
end;
$$;

drop trigger if exists on_interaction_created on public.interactions;
create trigger on_interaction_created
  after insert on public.interactions
  for each row execute function public.log_interaction_created();

-- ── contacts.last_contacted_at follows the latest real touchpoint ───────────
-- Notes are not contact with the person, so they do not count.
create or replace function public.update_last_contacted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type <> 'note' then
    update public.contacts
       set last_contacted_at = greatest(coalesce(last_contacted_at, new.occurred_at), new.occurred_at)
     where id = new.contact_id;
  end if;
  return new;
end;
$$;

drop trigger if exists interactions_last_contacted on public.interactions;
create trigger interactions_last_contacted
  after insert or update of occurred_at, type on public.interactions
  for each row execute function public.update_last_contacted();

-- ── tasks: completed_at follows status, and the audit trail ─────────────────
create or replace function public.set_task_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    new.completed_at = coalesce(new.completed_at, now());
  elsif new.status <> 'completed' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_completed_at on public.tasks;
create trigger tasks_completed_at
  before insert or update on public.tasks
  for each row execute function public.set_task_completed_at();

create or replace function public.log_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.contact_id is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into public.audit_log (contact_id, user_id, action, field_changed, new_value)
    values (new.contact_id, new.created_by, 'update', 'task', 'Created task: ' || new.title);
  elsif old.status is distinct from new.status and new.status = 'completed' then
    insert into public.audit_log (contact_id, user_id, action, field_changed, old_value, new_value)
    values (new.contact_id, coalesce(new.assigned_to, new.created_by), 'update', 'task', new.title, 'Completed');
  end if;
  return new;
end;
$$;

drop trigger if exists on_task_change on public.tasks;
create trigger on_task_change
  after insert or update on public.tasks
  for each row execute function public.log_task_change();

-- ── audit: pipeline entries (one pipeline, purpose-bound entries) ───────────
create or replace function public.log_pipeline_entry_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (contact_id, action, field_changed, new_value, metadata)
    values (new.contact_id, 'stage_change', 'pipeline', new.stage || ': ' || new.purpose,
            jsonb_build_object('entry_id', new.id, 'purpose', new.purpose));
  elsif old.stage is distinct from new.stage then
    insert into public.audit_log (contact_id, action, field_changed, old_value, new_value, metadata)
    values (new.contact_id, 'stage_change', 'pipeline', old.stage, new.stage,
            jsonb_build_object('entry_id', new.id, 'purpose', new.purpose));
  elsif old.closed_at is null and new.closed_at is not null then
    insert into public.audit_log (contact_id, action, field_changed, old_value, new_value, metadata)
    values (new.contact_id, 'update', 'pipeline', new.purpose,
            'Closed' || case when coalesce(new.outcome, '') <> '' then ': ' || new.outcome else '' end,
            jsonb_build_object('entry_id', new.id, 'purpose', new.purpose));
  end if;
  return new;
end;
$$;

drop trigger if exists contact_pipelines_audit on public.contact_pipelines;
create trigger contact_pipelines_audit
  after insert or update on public.contact_pipelines
  for each row execute function public.log_pipeline_entry_change();

-- ── merge_contacts: fold secondary into primary, then delete secondary ──────
-- Empty fields on the primary are filled from the secondary; notes are joined;
-- interactions, tasks, pipeline entries, stage history, labels, custom values,
-- notifications and audit history move across. The primary keeps its own type.
create or replace function public.merge_contacts(
  primary_id     uuid,
  secondary_id   uuid,
  merge_user_id  uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.contacts%rowtype;
  s public.contacts%rowtype;
begin
  -- SECURITY DEFINER bypasses RLS, so check membership here. The service role
  -- (Harold's MCP server, the SQL editor) has no auth.uid() and is allowed.
  if auth.uid() is not null and not public.is_crm_member() then
    raise exception 'not a CRM member';
  end if;
  if primary_id = secondary_id then
    raise exception 'cannot merge a contact into itself';
  end if;

  select * into p from public.contacts where id = primary_id;
  select * into s from public.contacts where id = secondary_id;
  if p.id is null or s.id is null then
    raise exception 'one or both contacts not found';
  end if;

  update public.contacts set
    org               = case when coalesce(p.org, '') = ''           then s.org           else p.org end,
    email             = case when coalesce(p.email, '') = ''         then s.email         else p.email end,
    phone             = case when coalesce(p.phone, '') = ''         then s.phone         else p.phone end,
    location          = case when coalesce(p.location, '') = ''      then s.location      else p.location end,
    website           = case when coalesce(p.website, '') = ''       then s.website       else p.website end,
    warmth            = case when coalesce(p.warmth, '') = ''        then s.warmth        else p.warmth end,
    region            = case when coalesce(p.region, '') = ''        then s.region        else p.region end,
    focus_area        = case when coalesce(p.focus_area, '') = ''    then s.focus_area    else p.focus_area end,
    investor_type     = case when coalesce(p.investor_type, '') = '' then s.investor_type else p.investor_type end,
    organization_id   = coalesce(p.organization_id, s.organization_id),
    last_contacted_at = greatest(p.last_contacted_at, s.last_contacted_at),
    notes = case
      when coalesce(p.notes, '') = '' then s.notes
      when coalesce(s.notes, '') = '' then p.notes
      else p.notes || E'\n---\n' || s.notes
    end,
    updated_by = merge_user_id
  where id = primary_id;

  update public.interactions      set contact_id = primary_id where contact_id = secondary_id;
  update public.tasks             set contact_id = primary_id where contact_id = secondary_id;
  update public.contact_pipelines set contact_id = primary_id where contact_id = secondary_id;
  update public.stage_changes     set contact_id = primary_id where contact_id = secondary_id;
  update public.notifications     set contact_id = primary_id where contact_id = secondary_id;
  update public.audit_log         set contact_id = primary_id where contact_id = secondary_id;

  -- Labels: union. The secondary's type becomes a label only if it differs.
  insert into public.contact_categories (contact_id, category_name)
  select primary_id, category_name from public.contact_categories where contact_id = secondary_id
  on conflict (contact_id, category_name) do nothing;
  delete from public.contact_categories where contact_id = primary_id and category_name = p.category;

  -- Custom values: keep the primary's where both have one.
  update public.contact_custom_values v
     set contact_id = primary_id
   where v.contact_id = secondary_id
     and not exists (select 1 from public.contact_custom_values x
                      where x.contact_id = primary_id and x.field_id = v.field_id);

  insert into public.audit_log (contact_id, user_id, action, field_changed, old_value, new_value)
  values (primary_id, merge_user_id, 'update', 'merge',
          s.name || ' (' || coalesce(s.org, '') || ')', 'Merged into ' || p.name);

  delete from public.contacts where id = secondary_id;
end;
$$;

-- ── archive_old_completed_tasks: hide tasks completed long ago ──────────────
-- Not scheduled by default. Call it from the SQL editor, or schedule it with
-- pg_cron if your plan has it:
--   select cron.schedule('archive-completed-tasks', '0 3 * * *',
--                        'select public.archive_old_completed_tasks(30)');
create or replace function public.archive_old_completed_tasks(days_threshold integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  archived_count integer;
begin
  if auth.uid() is not null and not public.is_crm_member() then
    raise exception 'not a CRM member';
  end if;
  update public.tasks
     set archived_at = now()
   where status = 'completed'
     and completed_at is not null
     and completed_at < now() - make_interval(days => days_threshold)
     and archived_at is null;
  get diagnostics archived_count = row_count;
  return archived_count;
end;
$$;
