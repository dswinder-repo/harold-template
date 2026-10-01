-- ════════════════════════════════════════════════════════════════════════════
-- 005: realtime.
--
-- Adds the tables the web app listens to into Supabase's realtime publication,
-- so a change made anywhere (another tab, or Harold logging an interaction from
-- the terminal) shows up in the open app without a refresh. Realtime respects
-- RLS, so only members receive changes.
--
-- Safe to re-run: tables already in the publication are skipped.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping (not a Supabase database?)';
    return;
  end if;

  foreach t in array array[
    'contacts', 'contact_categories', 'contact_pipelines', 'stage_changes',
    'interactions', 'tasks', 'categories', 'organizations', 'custom_fields',
    'contact_custom_values', 'audit_log', 'notifications', 'crm_settings',
    'user_preferences', 'enum_options'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
