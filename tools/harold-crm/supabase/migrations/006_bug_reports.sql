-- ════════════════════════════════════════════════════════════════════════════
-- 006: bug reports and feature requests.
--
-- The Feedback button (bottom right of every page) files into these two tables
-- while you use the CRM: a title, optional details, and the page it came from.
-- They are a to-do list for whoever fixes the app later, usually an AI coding
-- session: read the open rows, fix the code, then set status and resolution.
-- The README's "Bug reports" section has the queries.
--
-- Members only, exactly like every other table (see 004). created_by defaults
-- to the signed-in user; rows written with the service role leave it empty.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── bug_reports ─────────────────────────────────────────────────────────────
create table if not exists public.bug_reports (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (btrim(title) <> ''),
  description   text,
  url           text,                   -- path the report was filed from
  page_context  text,                   -- readable page name, e.g. 'Pipeline'
  severity      text not null default 'normal'
                  check (severity in ('low', 'normal', 'high', 'critical')),
  status        text not null default 'open'
                  check (status in ('open', 'triaged', 'in_progress', 'resolved', 'closed')),
  resolution    text,                   -- what was done about it, set when fixed
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_bug_reports_status on public.bug_reports (status, created_at desc);

drop trigger if exists bug_reports_updated_at on public.bug_reports;
create trigger bug_reports_updated_at before update on public.bug_reports
  for each row execute function public.harold_set_updated_at();

-- ── feature_requests ────────────────────────────────────────────────────────
create table if not exists public.feature_requests (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (btrim(title) <> ''),
  description   text,
  url           text,
  page_context  text,
  priority      text not null default 'medium'
                  check (priority in ('low', 'medium', 'high')),
  status        text not null default 'open'
                  check (status in ('open', 'reviewing', 'planned', 'in_progress', 'shipped', 'declined')),
  resolution    text,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_feature_requests_status on public.feature_requests (status, created_at desc);

drop trigger if exists feature_requests_updated_at on public.feature_requests;
create trigger feature_requests_updated_at before update on public.feature_requests
  for each row execute function public.harold_set_updated_at();

-- ── members-only access, same rule as 004 ───────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['bug_reports', 'feature_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_members_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (public.is_crm_member()) with check (public.is_crm_member())',
      t || '_members_all', t
    );
  end loop;
end $$;
