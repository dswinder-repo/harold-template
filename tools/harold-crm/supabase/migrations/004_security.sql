-- ════════════════════════════════════════════════════════════════════════════
-- 004: members-only access.
--
-- Every table has row-level security on, and the only policy on each lets a
-- signed-in user in when their auth id is listed in crm_members:
--
--   for all to authenticated
--     using (public.is_crm_member()) with check (public.is_crm_member())
--
-- Being signed in is not enough. Someone who manages to create an account sees
-- nothing until you add them to crm_members. The anon (publishable) key sees
-- nothing at all. Harold's MCP server uses the service role key, which bypasses
-- RLS, so it is unaffected; keep that key on servers only.
--
-- Two tables are additionally scoped to their owner: notifications and
-- user_preferences belong to one user each.
--
-- AFTER YOU SIGN UP, add yourself as the first member (SQL editor):
--
--   insert into public.crm_members (user_id)
--   select id from auth.users where email = 'you@example.com';
--
-- Then turn off "Allow new users to sign up" in Supabase Auth settings.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- crm_members: RLS on, deliberately NO policies. Only the service role can read
-- or change who is a member.
alter table public.crm_members enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    -- Harold core (001)
    'contacts', 'contact_categories', 'pipeline_stages', 'contact_pipelines',
    'stage_changes', 'interactions', 'tasks',
    -- web app (002)
    'profiles', 'categories', 'organizations', 'custom_fields',
    'contact_custom_values', 'audit_log', 'crm_settings', 'enum_options'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_members_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (public.is_crm_member()) with check (public.is_crm_member())',
      t || '_members_all', t
    );
  end loop;
end $$;

-- Per-user tables: members only, and only your own rows.
alter table public.notifications enable row level security;
drop policy if exists notifications_members_own on public.notifications;
create policy notifications_members_own on public.notifications
  for all to authenticated
  using (public.is_crm_member() and user_id = (select auth.uid()))
  with check (public.is_crm_member() and user_id = (select auth.uid()));

alter table public.user_preferences enable row level security;
drop policy if exists user_preferences_members_own on public.user_preferences;
create policy user_preferences_members_own on public.user_preferences
  for all to authenticated
  using (public.is_crm_member() and user_id = (select auth.uid()))
  with check (public.is_crm_member() and user_id = (select auth.uid()));

-- Functions that run with elevated rights are callable by signed-in users only;
-- each checks membership itself.
revoke all on function public.merge_contacts(uuid, uuid, uuid) from public;
revoke all on function public.merge_contacts(uuid, uuid, uuid) from anon;
grant execute on function public.merge_contacts(uuid, uuid, uuid) to authenticated, service_role;

revoke all on function public.archive_old_completed_tasks(integer) from public;
revoke all on function public.archive_old_completed_tasks(integer) from anon;
grant execute on function public.archive_old_completed_tasks(integer) to authenticated, service_role;

-- ── storage: private bucket for interaction attachments ─────────────────────
insert into storage.buckets (id, name, public)
values ('interaction-attachments', 'interaction-attachments', false)
on conflict (id) do nothing;

drop policy if exists interaction_attachments_members on storage.objects;
create policy interaction_attachments_members on storage.objects
  for all to authenticated
  using (bucket_id = 'interaction-attachments' and public.is_crm_member())
  with check (bucket_id = 'interaction-attachments' and public.is_crm_member());
