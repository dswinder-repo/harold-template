#!/usr/bin/env node
/**
 * Applies supabase/migrations/*.sql, in order, to a throwaway in-memory Postgres
 * (PGlite) and runs a few checks against the result. Nothing touches a real
 * database.
 *
 * PGlite is plain Postgres, not Supabase, so the pieces Supabase provides are
 * stubbed first: the auth schema (auth.users, auth.uid(), auth.role()), the
 * anon / authenticated / service_role roles, the storage schema and the
 * supabase_realtime publication.
 *
 *   pnpm test:migrations
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'supabase', 'migrations')
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select nullif(current_setting('request.jwt.claim.role', true), '')
  $$;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (id text primary key, name text not null, public boolean default false);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;

  create publication supabase_realtime;
`

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}

const db = new PGlite()
const run = (sql) => db.exec(sql)

/** Run a statement as a signed-in user, the way PostgREST would. */
async function asUser(userId, sql, params = []) {
  await run(`select set_config('request.jwt.claim.sub', '${userId}', false); select set_config('request.jwt.claim.role', 'authenticated', false); set role authenticated;`)
  try {
    return await db.query(sql, params)
  } finally {
    await run(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);`)
  }
}

await run(SUPABASE_STUB)

// Apply every migration twice: the second pass proves they are safe to re-run.
for (const pass of [1, 2]) {
  for (const f of files) {
    try {
      await run(readFileSync(join(dir, f), 'utf8'))
      if (pass === 1) check(`apply ${f}`, true)
    } catch (e) {
      check(`apply ${f} (pass ${pass})`, false, e.message)
      process.exit(1)
    }
  }
}
check('all migrations re-run cleanly', true)

// ── schema shape ────────────────────────────────────────────────────────────
const { rows: tables } = await db.query(
  `select tablename from pg_tables where schemaname = 'public' order by 1`
)
console.log(`      public tables (${tables.length}): ${tables.map((t) => t.tablename).join(', ')}`)

const { rows: noRls } = await db.query(
  `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`
)
check('RLS is on for every public table', noRls.length === 0, noRls.map((r) => r.relname).join(', '))

const { rows: memberPolicies } = await db.query(
  `select polname from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = 'crm_members'`
)
check('crm_members has no policies', memberPolicies.length === 0)

const { rows: stages } = await db.query(`select stage_name from pipeline_stages order by stage_order`)
check('seven pipeline stages seeded', stages.length === 7, stages.map((s) => s.stage_name).join(' > '))

const { rows: types } = await db.query(`select name from categories order by sort_order`)
check('five default types seeded', types.length === 5, types.map((t) => t.name).join(', '))

// ── behaviour ───────────────────────────────────────────────────────────────
const owner = (await db.query(
  `insert into auth.users (email, raw_user_meta_data) values ('owner@example.com', '{"full_name":"Owner Example"}') returning id`
)).rows[0].id
const outsider = (await db.query(
  `insert into auth.users (email) values ('outsider@example.com') returning id`
)).rows[0].id

const profiles = (await db.query(`select id, role from profiles order by created_at`)).rows
check('a profile is created for each new user', profiles.length === 2)
check('the first user becomes admin', profiles.find((p) => p.id === owner)?.role === 'admin')
check('later users are members', profiles.find((p) => p.id === outsider)?.role === 'member')

// Service-role style writes (no signed-in user), the way harold-mcp makes them.
const c1 = (await db.query(
  `insert into contacts (name, org, category, warmth) values ('Ada Example', 'Example Co', 'investor', 'Warm') returning id`
)).rows[0].id
const c2 = (await db.query(
  `insert into contacts (name, org, category, email) values ('Ada Exampel', '', 'founder', 'ada@example.com') returning id`
)).rows[0].id
await db.query(`insert into contact_categories (contact_id, category_name) values ($1, 'board'), ($2, 'advisor')`, [c1, c2])
const entry = (await db.query(
  `insert into contact_pipelines (contact_id, purpose) values ($1, 'raising the seed round') returning id`, [c1]
)).rows[0].id
await db.query(`update contact_pipelines set stage = 'Reached Out', entered_at = now() where id = $1`, [entry])
await db.query(`insert into interactions (contact_id, type, subject) values ($1, 'call', 'Intro call')`, [c2])
await db.query(`insert into tasks (contact_id, title) values ($1, 'Send the deck')`, [c2])

let threw = false
try { await db.query(`insert into contact_pipelines (contact_id, purpose) values ($1, '  ')`, [c1]) } catch { threw = true }
check('a pipeline entry without a purpose is rejected', threw)
threw = false
try { await db.query(`update contacts set warmth = 'Strategic' where id = $1`, [c1]) } catch { threw = true }
check('retired warmth values are rejected', threw)

const lc = (await db.query(`select last_contacted_at from contacts where id = $1`, [c2])).rows[0]
check('logging an interaction sets last_contacted_at', lc.last_contacted_at !== null)

const audit = (await db.query(`select action, field_changed from audit_log`)).rows
check('audit trail records creates', audit.filter((a) => a.action === 'create').length === 2)
check('audit trail records pipeline stage changes', audit.some((a) => a.action === 'stage_change'))
check('audit trail records interactions and tasks',
  audit.some((a) => a.field_changed === 'interaction') && audit.some((a) => a.field_changed === 'task'))

// Members-only: a signed-in user who is not a member sees nothing.
let seen = (await asUser(outsider, `select count(*)::int as n from contacts`)).rows[0].n
check('a signed-in non-member sees no contacts', seen === 0, `saw ${seen}`)
threw = false
try { await asUser(outsider, `insert into contacts (name) values ('Intruder')`) } catch { threw = true }
check('a signed-in non-member cannot insert', threw)
const seenMembers = (await asUser(outsider, `select count(*)::int as n from crm_members`)).rows[0].n
check('crm_members is not readable by signed-in users', seenMembers === 0)

// Add the owner as the first member, as the README says.
await db.query(`insert into crm_members (user_id) select id from auth.users where email = 'owner@example.com'`)
seen = (await asUser(owner, `select count(*)::int as n from contacts`)).rows[0].n
check('a member sees every contact', seen === 2, `saw ${seen}`)
const created = (await asUser(owner,
  `insert into contacts (name, category, created_by) values ('Bo Example', 'partner', $1) returning id`, [owner]
)).rows[0]
check('a member can insert', !!created?.id)
seen = (await asUser(outsider, `select count(*)::int as n from contacts`)).rows[0].n
check('the non-member still sees nothing', seen === 0)

// Merge, as a member, through the RPC.
await asUser(owner, `select merge_contacts($1, $2, $3)`, [c1, c2, owner])
const after = (await db.query(`select * from contacts where id in ($1, $2)`, [c1, c2])).rows
check('merge deletes the secondary', after.length === 1 && after[0].id === c1)
check('merge fills empty fields from the secondary', after[0]?.email === 'ada@example.com')
check('merge keeps the primary type', after[0]?.category === 'investor')
const moved = (await db.query(
  `select (select count(*) from interactions where contact_id = $1)::int as i,
          (select count(*) from tasks where contact_id = $1)::int as t,
          (select count(*) from contact_categories where contact_id = $1)::int as l`, [c1]
)).rows[0]
check('merge moves interactions, tasks and labels', moved.i === 1 && moved.t === 1 && moved.l === 2, JSON.stringify(moved))
threw = false
try { await asUser(outsider, `select merge_contacts($1, $2, $3)`, [c1, created.id, outsider]) } catch { threw = true }
check('a non-member cannot call merge_contacts', threw)

// Bug reports and feature requests (006): members only, like everything else.
for (const t of ['bug_reports', 'feature_requests']) {
  const meta = (await db.query(
    `select c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = $1`, [t]
  )).rows[0]
  check(`${t} exists`, !!meta)
  check(`${t} has RLS on`, meta?.rls === true)
}
await db.query(`insert into bug_reports (title, url, page_context) values ('Filed by Harold', '/tasks', 'Tasks')`)
seen = (await asUser(outsider, `select count(*)::int as n from bug_reports`)).rows[0].n
check('a non-member cannot read bug reports', seen === 0, `saw ${seen}`)
threw = false
try { await asUser(outsider, `insert into bug_reports (title) values ('Intruder bug')`) } catch { threw = true }
check('a non-member cannot file a bug report', threw)
threw = false
try { await asUser(outsider, `insert into feature_requests (title) values ('Intruder idea')`) } catch { threw = true }
check('a non-member cannot file a feature request', threw)
const bug = (await asUser(owner,
  `insert into bug_reports (title, description, url, page_context, severity)
   values ('Save button does nothing', 'On the contact page', '/contacts/x', 'Contact Detail', 'high')
   returning id, created_by, status`
)).rows[0]
check('a member can file a bug report', !!bug?.id)
check('a bug report defaults to open and records who filed it', bug?.status === 'open' && bug?.created_by === owner)
const feat = (await asUser(owner, `insert into feature_requests (title, priority) values ('Sort by warmth', 'high') returning id`)).rows[0]
check('a member can file a feature request', !!feat?.id)
seen = (await asUser(owner, `select count(*)::int as n from bug_reports where status = 'open'`)).rows[0].n
check('a member reads every open bug report', seen === 2, `saw ${seen}`)
await asUser(owner, `update bug_reports set status = 'resolved', resolution = 'Fixed the handler' where id = $1`, [bug.id])
const fixed = (await db.query(`select status from bug_reports where id = $1`, [bug.id])).rows[0]
check('a member can mark a bug resolved', fixed?.status === 'resolved')
threw = false
try { await db.query(`update bug_reports set status = 'done' where id = $1`, [bug.id]) } catch { threw = true }
check('unknown bug statuses are rejected', threw)

// Per-user tables.
await db.query(`insert into crm_members (user_id) values ($1)`, [outsider])
await db.query(`insert into notifications (user_id, type, title) values ($1, 'overdue_task', 'Mine'), ($2, 'overdue_task', 'Theirs')`, [owner, outsider])
const notes = (await asUser(owner, `select title from notifications`)).rows
check('members only see their own notifications', notes.length === 1 && notes[0].title === 'Mine')

const pub = (await db.query(`select count(*)::int as n from pg_publication_tables where pubname = 'supabase_realtime'`)).rows[0].n
check('realtime publication populated', pub >= 10, `${pub} tables`)

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
