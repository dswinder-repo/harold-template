-- ════════════════════════════════════════════════════════════════════════════
-- 007: retire the Focus Area field.
--
-- Contacts no longer carry a focus_area column: the app, Harold's MCP server
-- and the connector stopped reading and writing it. A new database never has
-- it (001 and tools/harold-mcp/schema.sql no longer create it). For a database
-- set up before this release, this migration replaces merge_contacts() with
-- the version that does not copy it, then drops the column. Anything worth
-- keeping from it belongs in the contact's notes or labels: copy it there
-- first if you need it, for example
--   update public.contacts set notes = trim(both from coalesce(notes, '') || E'\nFocus: ' || focus_area)
--    where coalesce(focus_area, '') <> '';
--
-- Safe to re-run, and safe on a database that never had the column.
-- ════════════════════════════════════════════════════════════════════════════

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

alter table public.contacts drop column if exists focus_area;
