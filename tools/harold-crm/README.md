# Harold CRM (web app)

The web app for your own relationship CRM, one you own for your whole working
life. It comes with Harold: this folder, `tools/harold-crm`, is part of the
Harold starter workspace, and the app runs on the same Supabase database that
Harold's MCP tools (`tools/harold-mcp`) read and write. Your data lives in your
own Supabase project, never in the repository. The app is optional: Harold's
tools work from the database alone, and the app adds a screen on top.

- **Contacts** with exactly **one type** (from your own list: investor, partner,
  founder, team, other by default) and **any number of labels**.
- **Warmth**: Hot, Warm, Lukewarm, Cold, or not rated. Go quiet too long and you
  get a warning; longer and the warmth steps down (thresholds are yours to set).
- **One pipeline.** Every entry states its **purpose** ("raising the seed round",
  "distribution partner for the launch"), moves through seven stages with a
  follow-up cadence, and one person can hold several entries for different reasons.
- Interactions timeline (with attachments), tasks, a **full audit trail**, custom
  fields, duplicate detection and merge, a command palette (⌘K), bulk operations,
  CSV import and export, notifications, organizations, a relationship map, an
  activity log and an investors overview.
- Optional **AI**: contact research, field enrichment and meeting prep (Google
  Gemini with search grounding, on a free API key; see
  [AI features](#ai-features-free-gemini-key)), plus outreach drafts from templates.
- **Bug reports and feature requests** filed from any page with one button, so
  a later coding session can read them and fix the app (see [Bug reports](#bug-reports)).
- **Members-only by design**: being signed in is not enough. Only accounts listed
  in `crm_members` can see any data.
- **Demo mode** runs the whole UI on invented data with no database.

Stack: Next.js 15 (App Router), React 18, Tailwind 4, Supabase (Postgres, Auth,
Realtime, Storage).

## Try it in demo mode

Running it on your own computer needs Node 20 or later and
[pnpm](https://pnpm.io/installation). (A host such as Vercel brings its own.)

```bash
cd tools/harold-crm
pnpm install
pnpm dev:demo        # http://localhost:3000, invented data, nothing saved
```

Demo mode swaps the Supabase client for an in-memory one loaded with fictional
contacts (`src/lib/demo/fixtures.ts`, all on `.example` domains). Writes only
change the copy in your browser tab. A normal build leaves the demo code out
entirely.

## Deploy your own

You need the Supabase project you created when setting up Harold's CRM, and
somewhere to host Next.js (Vercel is the simplest). About fifteen minutes.

### 1. The database

If you set up Harold's CRM, you already have a Supabase project with
`tools/harold-mcp/schema.sql` applied. Use that same project, so Harold and the
app share one database. (No Harold CRM yet? Create a project in **your own**
Supabase account first.)

### 2. Run the migrations

In the Supabase dashboard open **SQL Editor** and run each file in
`supabase/migrations/`, in order:

| File | What it does |
|------|--------------|
| `001_harold_core.sql` | Harold's core CRM schema: a byte-for-byte copy of `tools/harold-mcp/schema.sql`. Already applied if you ran that file; running it again changes nothing |
| `002_app_tables.sql` | What the app adds: profiles, members, contact types, organizations, custom fields, audit log, notifications, settings, preferences, pick lists |
| `003_functions_and_triggers.sql` | Audit trail triggers, `last_contacted_at`, task completion, `merge_contacts()`, profile creation for new users |
| `004_security.sql` | Members-only row-level security on every table, and the private attachments bucket |
| `005_realtime.sql` | Adds the tables to Supabase Realtime |
| `006_bug_reports.sql` | Bug reports and feature requests, members-only like everything else |
| `007_drop_focus_area.sql` | Retires a contact field that older databases still have; does nothing on a new one |

Every file is safe to run again. With the Supabase CLI you can instead link the
project from this folder and run `supabase db push`.

There is one schema and one source for it: `tools/harold-mcp/schema.sql`. If you
change it, copy it over `001_harold_core.sql`; the workspace test
`tests/crm.test.js` fails while the two differ.

To check the migrations without touching any database, run
`pnpm test:migrations` in this folder: it applies them to a throwaway in-memory
Postgres (PGlite, with Supabase's `auth` schema, roles and realtime publication
stubbed), checks the security rules and upgrades a database set up before 007.
The workspace test `tests/crm.test.js` runs it too, once `pnpm install` has run here.

### 3. Create your account

**Authentication > Users > Add user > Create new user**: enter your email and a
password, and tick *Auto Confirm User*. (The app has no public sign-up page.)
The first account created becomes the workspace admin.

### 4. Add yourself as the first member

Nobody sees any data until they are listed in `crm_members`. In the SQL Editor:

```sql
insert into public.crm_members (user_id)
select id from auth.users where email = 'you@example.com';
```

Add anyone else the same way, after creating their account. `crm_members` has
row-level security on and no policies, so only the SQL Editor or the service
role can change who is a member.

### 5. Turn off sign-ups

**Authentication > Sign In / Providers**: turn off **Allow new users to sign up**.
Members-only access already hides all data from strangers; this stops strangers
from creating accounts at all.

### 6. Deploy to Vercel (or any Next.js host)

1. In Vercel, import your Harold workspace repository (the private one you made
   from the starter) and set **Root Directory** to `tools/harold-crm`. The
   framework is detected as Next.js; there are no build settings to change.
   Vercel builds only this folder.
2. Add the environment variables (see `.env.example`):

   | Variable | Value |
   |----------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL, from Project Settings > API |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (or the legacy anon key) |
   | `GEMINI_API_KEY` | Optional. Turns on research, enrichment and meeting prep (see [AI features](#ai-features-free-gemini-key)) |
   | `NEXT_PUBLIC_HAROLD_NO_LOG_TYPES` | Optional. Contact types whose conversations you never log (see [Using it with Harold](#using-it-with-harold)) |

3. Deploy, then in Supabase **Authentication > URL Configuration** set the Site
   URL to your deployment's URL.
4. Recommended: Harold commits and pushes the workspace at the end of every
   turn, and each push would rebuild the app. In Vercel, **Project Settings >
   Git > Ignored Build Step**, run the custom command
   `git diff HEAD^ HEAD --quiet -- .` (it runs inside `tools/harold-crm`), so
   only pushes that change the app redeploy it.

Never add the service role / secret key to the app. It does not need it.

Any other host that runs Next.js 15 works the same way: build from
`tools/harold-crm` (`pnpm install && pnpm build`, then `pnpm start`) with the
same environment variables.

### AI features: free Gemini key

Contact research, field enrichment and meeting prep use Google Gemini
(`gemini-2.5-flash` with Google Search grounding), because Gemini's free tier
covers them. They are optional.

1. Open [Google AI Studio](https://aistudio.google.com/apikey), sign in with a
   Google account and create an API key. The free tier is enough for one
   person's CRM.
2. Set it as `GEMINI_API_KEY` in your host's environment variables (in Vercel:
   Project Settings > Environment Variables), then redeploy. For local
   development, put it in `.env.local`.

Without the key everything else works; the AI buttons just say that AI is off.
The key stays on the server: never give it a `NEXT_PUBLIC_` name.

### Run locally against your database

```bash
cd tools/harold-crm
cp .env.example .env.local   # fill in the Supabase URL and publishable key (and GEMINI_API_KEY if you have one)
pnpm install
pnpm dev
```

## Using it with Harold

Harold's MCP server (`tools/harold-mcp`) talks to the same tables the app uses:
migration 001 *is* Harold's schema, and the app only adds tables and columns
around it. Point both at one Supabase project and a contact Harold files from a
chat shows up in the app, live, and the other way round.

- `bin/harold-setup-crm` (run during Harold's setup) stores the project URL and
  the **service role** key in `~/.harold/env` on your machine.
- The service role key bypasses row-level security. Keep it server-side only:
  in that env file or a server's secret store, never in this app, a
  `NEXT_PUBLIC_` variable, or a repository.
- The audit trail records each change with the contact's `updated_by`, which is
  whoever last edited that contact in the app. Harold's tool writes are not
  attributed: a change Harold makes appears under the last app editor (or under
  no one, for a contact never edited in the app). Logging an interaction from
  Harold updates `last_contacted_at` like the app does.
- Optional: if you never log conversations with some contact types (some people
  choose this for their own team), list them in `HAROLD_NO_LOG_TYPES` for Harold
  (see "CRM Filing Protocol" in the workspace's `AGENTS.md`) and in
  `NEXT_PUBLIC_HAROLD_NO_LOG_TYPES` for the app, whose warmth decay then skips
  them. Both are empty by default.

## Bug reports

The app is yours to change, so it comes with a way to note what to change while
you use it.

**Filing.** Press **Feedback** at the bottom right of any page. Pick *Bug Report*
(with a severity) or *Feature Request* (with a priority), write a title and,
if you like, the details. The page you were on is saved with it. Rows go to
`bug_reports` and `feature_requests` in your Supabase project.

**Fixing.** Later, open a coding session on your Harold workspace (any AI
coding tool, or just you) and have it read the open reports. In the Supabase
**SQL Editor**:

```sql
select id, severity, page_context, url, title, description, created_at
from public.bug_reports
where status in ('open', 'triaged', 'in_progress')
order by case severity when 'critical' then 0 when 'high' then 1
                       when 'normal' then 2 else 3 end, created_at;

select id, priority, page_context, title, description
from public.feature_requests
where status in ('open', 'reviewing', 'planned', 'in_progress')
order by created_at;
```

Paste the result into the session, or give the session read access to the
database the way you already do for your other tools (a Supabase MCP server, or
the service role key kept in a local, uncommitted env file; never in the app).
`url` and `page_context` say where to look in `tools/harold-crm/src/app/`.

When a fix ships, mark it so it drops off the list:

```sql
update public.bug_reports
set status = 'resolved', resolution = 'What was wrong and what changed'
where id = '...';
-- feature_requests: status = 'shipped' (or 'declined')
```

Statuses: bugs go `open`, `triaged`, `in_progress`, `resolved`, `closed`;
requests go `open`, `reviewing`, `planned`, `in_progress`, `shipped`,
`declined`.

## Configuration inside the app

**Settings** covers your account, which notifications you get, the **sender
profile** (who "we" are in outreach drafts and meeting briefs), your **types**,
your **labels**, **warmth rules** (decay thresholds), investor types and regions.
Warmth levels, statuses and priorities are fixed by Harold's schema.

## Notes

- AI calls send the contact's details, recent interactions and your sender
  profile to Google's Gemini API when you press a research, enrich or prep
  button. Nothing is sent otherwise. On the free tier, Google may use what is
  sent to improve its products (see the Gemini API terms).
- Completed tasks can be archived with `select public.archive_old_completed_tasks(30);`,
  or schedule that with `pg_cron` if your plan has it.
- Interaction attachments go to a private Storage bucket readable only by members.

## License

MIT, as part of the Harold starter. See `LICENSE` at the workspace root.
