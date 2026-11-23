# Harold connector

A hosted remote MCP server. It lets any AI tool that supports remote MCP servers (chat apps such as Claude or ChatGPT, coding agents such as Claude Code, Codex, Cursor or VS Code, and scheduled jobs) read and write your Harold from the web, desktop, phone or a server, without the workspace folder on that device:

- the **knowledge base**, in your private GitHub repository (`HAROLD_REPO`), through the GitHub API;
- optionally, the **CRM**, in your Supabase project (the schema in `tools/harold-mcp/schema.sql`).

You deploy it once, to a host you control, and add its URL in each tool ([Connect your tool](#connect-your-tool)). Nothing in it is tied to one computer: it runs wherever you deploy it, and every write is a commit to your repository.

- **Transport:** MCP Streamable HTTP at `/mcp` (2026-07-28 protocol and 2025-era clients). Stateless: each request is answered and closed, with no long-lived streams (the server does not advertise `tools.listChanged` and refuses `subscriptions/listen`), so it stays inside Vercel's free tier.
- **Sign-in:** a small OAuth 2.1 server in the same deployment, with GitHub as the identity provider. Any MCP client can sign in; exactly one GitHub account is accepted. Tools that cannot do OAuth use a personal access token.
- **Runtime:** Node.js 22 or later. A Hono app (`server.ts`) that runs on Vercel with zero configuration, or on any Node host through `local.ts`.

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `harold_today` | read | Today's date in `HAROLD_TZ`, today's morning brief draft (`harold/briefs/<date>.md`, if you use the scheduled brief), the Current Alerts section of `harold/alerts.md`, the critical lessons from `harold/learnings.jsonl`, the housekeeping notes waiting under `## New` in `harold/briefs/housekeeping-notes.md`, the active projects that have gone quiet (as `harold_pulse`), Harold's open tasks that are overdue or due today (when the task list is configured), the five latest daily notes, and the brief's Step 0: show the draft, ask what came in overnight, then the day's priorities. |
| `harold_search` | read | Searches the repository (GitHub code search; falls back to matching file names). |
| `harold_read` | read | Reads one text file by repo path. Refuses binaries, truncates very long files. |
| `harold_list` | read | Lists a folder. |
| `harold_where` | read | Resolves a topic to a project from `harold/projects.md`, with the same scoring as `bin/harold where`. |
| `harold_related` | read | Follows the links from a note (a path, a title, or a topic found with the same search as `harold_search`): the linked notes 1 to 2 hops out, each with how it is linked and its `last_updated` date, then a gaps line (not updated in 30+ days, broken links, orphans, no meeting notes; archived notes are never stale). Reads `harold/graph.json`, which `bin/harold close` writes; the same ranking as `bin/harold related`. A workspace without that file gets a plain message saying how to produce it. |
| `harold_pulse` | read | Which projects have gone quiet: for each active project in `harold/projects.md`, its newest activity (its newest heartbeat when it posts them, since a project that posts heartbeats is judged by them alone; otherwise a note linked to its card, a note in its folder, a daily or meeting note that names it, or a commit touching its folder) with what it was and its date, its next step (`next_step:` in the map entry or the card, or a `Next step:` line in the card or the folder README), and a quiet flag after `HAROLD_PULSE_DAYS` days (default 14) without any. The same answer as `bin/harold pulse`, from `harold/graph.json`, the project map and the commit history; `all: true` adds every next step and the projects that are not active. |
| `harold_heartbeat_latest` | read | The newest `n` (1 to 10, default 1) heartbeats of a project, newest first by date and time, read from the project's live heartbeat file in full. Text plus structured data (`project`, `path`, `heartbeats`). Archive files under `heartbeats/` are ignored. |
| `harold_person` | read | A person's card in `vault/people/` (fuzzy name match) plus, when the CRM is configured, their CRM record. |
| `crm_search_contacts` | read | Filters CRM contacts (type, warmth, stage, purpose, project, keyword, ...). |
| `crm_get_contact` | read | One contact's full record: interactions, open tasks, stage history. |
| `crm_stale` | read | Who has gone quiet: active or pending contacts whose last interaction is older than their cadence (the tightest stage cadence among their open pipeline entries, else warmth: Hot 7 days, Warm 14, Lukewarm 28; Cold or unset warmth is never flagged). The same rule as `harold_cadence_check` in `tools/harold-mcp`. Types in `HAROLD_NO_CADENCE_TYPES` are skipped, by the contact's type only. |
| `harold_capture` | write | "Remember this": a timestamped line in `vault/daily/<date>-chat.md`. |
| `harold_heartbeat` | write | A short heartbeat for one project (what finished, what is running, what waits on the owner with due dates, the repo file with the detail), appended to `heartbeats.jsonl` in the project's own folder from `harold/projects.md` (`harold/heartbeats/<project>.jsonl` when the map gives no folder), the same file `bin/harold` reads. `harold_pulse` reads heartbeats first. |
| `harold_note` | write | A new note in `vault/intel`, `vault/decisions`, `vault/meetings`, `vault/companies` or `vault/projects`. Never overwrites. |
| `harold_update` | write | Appends to (optionally under a heading) and/or sets simple frontmatter fields of an existing `.md` under `vault/` or `harold/`. |
| `harold_learning` | write | Appends a lesson to `harold/learnings.jsonl` with the next free id, in the same format as `bin/harold file learning` (`source: connector`). |
| `harold_person_create` | write | Creates a person's card `vault/people/<Name>.md` in the person template shape - the third record of contact filing, next to the CRM contact and the interaction. Refuses when a card for the name exists (`harold_update` changes cards) and names similar cards. `warmth` stays unset unless you rated the person; `status` defaults to `pending`. Refuses secrets. |
| `crm_log_interaction` | write | Logs a touchpoint with a contact and freshens their vault card. Every contact is logged the same way, whatever its type. |
| `crm_upsert_contact` | write | Creates or updates a contact. The type is free text from your own list (as in `dashboard/people.md`). Never places anyone in the pipeline. |
| `crm_pipeline` | write | The one pipeline: add (a purpose is required), move, close, list. |
| `crm_task` | write | The same task list, filtered to a contact: create, update, complete, cancel, list. Kept for compatibility; `task_id` takes a ref, an outside key or a task id. |
| `task_list` | read | Open tasks in Harold's own task list (the Supabase `tasks` table), by due date, with ref (`H-12`), project, contact, status, due date, priority, and the key and URL of the same work in an outside tool when it is linked (`task_links`, for example `ENG-123`). Optional text, `project` and `include_done` filters. The model calls it before `task_create` so nothing is created twice. |
| `task_create` | write | One task in Harold's task list: title, optional description, due date (`YYYY-MM-DD`), priority, `contact_name` or `contact_id` (CRM lookup) and `project`. The project is checked against `harold/projects.md` and stored under its canonical name; an unknown project is refused with the close matches. An open task with the same title in the same project is returned instead of a duplicate. Returns the ref. Refuses secrets. The instructions tell the model to create one per commitment whenever you paste meeting notes, a transcript or a forwarded email, without being asked, and to write each ref into the meeting note's `## Action items`. The database sets `changed_by`; the connector never writes it. |
| `task_update` | write | Update one task by ref (`H-12`), by outside key (`ENG-123`, through `task_links`) or by task id. State: `todo` or `pending`, `start` or `in progress`, `done` or `complete`, `cancel`. All of them are reversible and nothing is ever deleted. Also title, description, priority, due date (`none` clears it) and project. Only the fields you pass change, and the reply shows the before and after of each. Refuses secrets. |
| `sync_setup_notion` | write | Sets up the Notion task sync: lists the Notion databases shared with the integration, proposes which property holds each of Harold's fields (and which option means each status and priority) in plain English, checks it against the real properties, and saves it only with `confirm: true`. Also the owner's half of the Notion webhook handshake (`webhook: expect` or `reveal_token`). Writes nothing to Notion. See "Notion" under the task sync below. |
| `calendar_list` | read | The calendars the connector's own Google Calendar access can read: name, id, primary, access role, time zone. Configured once on the connector, so every connected tool reads the same calendars. |
| `calendar_events` | read | Events from your Google calendars, today through the next 7 days by default (`from`/`to` `YYYY-MM-DD`, at most 31 days; `calendar` narrows to one), as a day-by-day table in your time zone (`HAROLD_TZ`). All-day and multi-day events are labeled, recurring events expanded per day, cancelled ones omitted. For the morning brief, meeting prep and scheduling. A calendar outside Google is not included; read its export file in the vault, if there is one. |

Without `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, the CRM tools answer "not configured" and everything else works. The same two settings carry Harold's task list, so without them `task_list`, `task_create`, `task_update` and `crm_task` say that the task list is not configured. Before the task-list migration is applied (`tools/harold-mcp/migrations/2026-11-18-task-list.sql`), the tools fall back to the old `tasks` columns (no refs, projects or outside keys) and say so. The two-way sync with Linear, Todoist, Asana or Notion is optional and has its own settings: without them the task list works on its own and nothing syncs. Without `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN`, `calendar_list` and `calendar_events` say "not configured" and point at the chat's own calendar connector or a calendar export file in the vault.

## Security model

- **One account.** Exactly one GitHub account gets in. By default, on Vercel, it is the owner of the repository the connector is deployed from: at sign-in the connector looks that repository up by its numeric id, with the signed-in person's own GitHub token, and accepts them only if they are its owner, compared by numeric user id. Renaming the account or the repository changes nothing, and someone who later registers the old name does not get in. A repository owned by an organization is refused (several people can administer one, and the connector is for one person); name the owner instead with `ALLOWED_GITHUB_LOGIN` **and** `ALLOWED_GITHUB_ID`, which both must match and which always win when set. Either way the identity is checked at sign-in, at every token refresh, and once per access token on `/mcp` (and once per personal access token when the owner is the repository's owner). A refused account's GitHub grant is revoked.
- **No database, encrypted state.** Client ids, sign-in state, authorization codes, access tokens (24 hours) and refresh tokens (90 days) are AES-256-GCM blobs sealed with one key, each bound to its purpose, so one kind cannot be replayed as another. The key is `TOKEN_KEY` when set; otherwise it is derived from `GITHUB_CLIENT_SECRET` (HKDF-SHA256 with a fixed, versioned label), so the client secret is then as sensitive as the key itself. Changing the key (`TOKEN_KEY`, or the client secret when `TOKEN_KEY` is unset) signs every client out and revokes every personal access token and the sealed Google token.
- **Redirects any tool can use.** OAuth redirects may go to loopback (`http://127.0.0.1`, `http://[::1]`, `http://localhost`, any port and path, RFC 8252 §7.3; a loopback redirect may differ from the registered one in its port only), to an app's own scheme such as `cursor://` or `com.example.app:/cb` (RFC 8252 §7.1; never `javascript:`, `data:`, `file:`, `blob:`, `about:`, `vbscript:`, `ws:`, `wss:`, `ftp:` or a few other meaningless ones), or to `https` on any host. Never with userinfo, a fragment, whitespace, or plain `http` to anything but loopback. `ALLOWED_REDIRECT_HOSTS`, when set, narrows https hosts and app schemes and is re-checked on every use, so narrowing it also cuts off existing registrations.
- **Why that is safe.** Once any tool may connect, a redirect list cannot tell a real tool from an impostor anyway. What protects your Harold is the one-account GitHub gate above, PKCE (S256, required), which binds each code to the client that started the flow so a code intercepted on its way to a loopback port or an app scheme is useless, and the consent page. That page (with a nonce cookie, so another site cannot press its button) stands between every request and GitHub, and shows the client's name and, in large type, exactly where the sign-in will be sent, with the full redirect address underneath. It is the one thing a phishing link has to get past: anyone can register their own client and send you an `/authorize` link, and the page will name their destination. If that is too much trust in one click, set `ALLOWED_REDIRECT_HOSTS`.
- **Client ID Metadata Documents** (an `https://` client_id whose JSON lists its redirect URIs) are fetched from public hosts only: default port, no redirects followed, at most 64 KB, and a host that is or resolves to a private, loopback or link-local address is refused, so the connector cannot be used to reach internal services. A hostile DNS server that answers differently a moment after the check (DNS rebinding) is not excluded.
- **Personal access tokens** are sealed with the same key as their own kind (never accepted as a client id, code or refresh token, nor the reverse), last at most 365 days, and are revoked by id (`REVOKED_TOKEN_IDS`) or all at once (change the key).
- **No deletes.** There is no delete tool. Read tools declare `readOnlyHint: true`; write tools `readOnlyHint: false, destructiveHint: false`.
- **Secret scan on every write.** Content that looks like a key or token (the same patterns as `bin/harold`, plus GitHub OAuth tokens and plain `password: ...` phrases) is refused and nothing is committed.
- **Writes are commits.** Each write is one commit on `HAROLD_BRANCH` with the message `chore(connector): ...`, authored by "Harold (connector)" with a neutral email (`harold-connector@users.noreply.github.com`, or `HAROLD_COMMIT_EMAIL`). Writes use the file's current sha and retry up to 3 times on a conflict, so a concurrent session's commit is never overwritten.
- **GitHub scope.** The connector asks GitHub for the `repo` scope, because it reads and writes a private repository. GitHub OAuth Apps cannot be limited to one repository: the grant covers every repository the account can reach, and the connector only ever touches `HAROLD_REPO`. Revoke it at github.com → Settings → Applications → Authorized OAuth Apps.

## Deploy

On Vercel you type two settings by hand, both from a GitHub OAuth App you create after the first deploy, because that form needs the deployment's address. Everything else has a default (see the table below).

### 1. Deploy

**Vercel, starting fresh** (you have no Harold repository yet): this button copies the starter into a new repository in your GitHub account, which becomes your Harold workspace, and deploys the connector from its `tools/harold-connector` folder. Make the new repository private.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdswinder-repo%2Fharold-template&root-directory=tools%2Fharold-connector&project-name=harold-connector&repository-name=harold)

**Vercel, with your Harold repository already set up:** in the Vercel dashboard, import that repository and set the project's **Root Directory** to `tools/harold-connector` (or, with the CLI, `cd tools/harold-connector && vercel link`). Do not use the button: it would create a second repository.

Either way, ask for no settings yet. Keep production publicly reachable (Vercel's default *Standard Protection* protects previews only): every tool must reach `/mcp` without a Vercel login. The connector does its own authentication.

**Any other Node 22+ host** that can run a long-lived HTTP server: `npm ci`, then `PORT=8787 npx tsx local.ts` (this is what `npm run dev` does) behind HTTPS. Off Vercel there are no defaults to fall back on: set `HAROLD_REPO`, `PUBLIC_BASE_URL`, `ALLOWED_GITHUB_LOGIN` and `ALLOWED_GITHUB_ID` as well. `local.ts` serves the same Hono app through `@hono/node-server`.

### 2. Create the GitHub OAuth App

Open the deployment's address (on Vercel, the production domain: `https://<project>.vercel.app`, or your own domain). The connector's home page says exactly what to enter at github.com → Settings → Developer settings → OAuth Apps → New OAuth App:

- Application name: anything, e.g. `Harold connector`
- Homepage URL: the deployment's address
- Authorization callback URL: **the deployment's address followed by `/github/callback`**
- Leave Device Flow off. Register, then *Generate a new client secret*.

### 3. Add the two settings and redeploy

On Vercel: Project → Settings → Environment Variables (or `vercel env add <NAME> production`, which prompts for the value so it never lands in your shell history). Add `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, then redeploy (Deployments → the latest one → Redeploy). Also set `HAROLD_TZ`: otherwise "today", the chat-log file name and note dates are UTC dates.

For the CRM and the task list, add Supabase: either connect Vercel's Supabase integration to the project ([vercel.com/marketplace/supabase](https://vercel.com/marketplace/supabase)), which sets `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, or set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` yourself. The database still needs Harold's schema (`playbook/core/setup.md`, step 8).

The home page now names the `/mcp` address to add in each tool ([Connect your tool](#connect-your-tool)), or says what is still missing.

### Settings

`.env.example` lists the same set. A setting you set always wins over its default, so a deployment that sets everything keeps working unchanged.

| Variable | Required | Default or example | Purpose |
|---|---|---|---|
| `GITHUB_CLIENT_ID` | yes | from the OAuth App | GitHub sign-in. |
| `GITHUB_CLIENT_SECRET` | yes | from the OAuth App | GitHub sign-in. Unless `TOKEN_KEY` is set, the encryption key is derived from it, so changing it signs everyone out. |
| `HAROLD_REPO` | on Vercel, no | default on Vercel: the repository the connector is deployed from | The private repository that holds your Harold workspace, as `owner/name`. Required on other hosts. |
| `HAROLD_BRANCH` | no | `main` (default) | The branch tools read and commit to. |
| `PUBLIC_BASE_URL` | on Vercel, no | default on Vercel: `https://` plus the project's production domain (your shortest custom domain, else `<project>.vercel.app`) | This deployment's public origin, no trailing slash. Preview deployments use the production address too, so sign-in always goes through production. After adding a domain, update the OAuth App's two URLs (the home page shows them) or set this explicitly; tools then reconnect once. Required on other hosts. |
| `ALLOWED_GITHUB_LOGIN` | on Vercel, no | default on Vercel: the owner of the deployment's repository | The only GitHub account accepted. Set it together with `ALLOWED_GITHUB_ID` when the repository belongs to an organization, when `HAROLD_REPO` names another repository, or on other hosts. |
| `ALLOWED_GITHUB_ID` | with the login | `12345678` (`gh api user --jq .id`) | That account's numeric id. Must match too. |
| `TOKEN_KEY` | no | default: derived from `GITHUB_CLIENT_SECRET` | 64 hex characters (`openssl rand -hex 32`); encrypts every token and code. Set it to keep sessions alive across a change of client secret. |
| `ALLOWED_REDIRECT_HOSTS` | no | unset (default: any tool) | Optional narrowing: exact https hosts and app schemes, e.g. `claude.ai,claude.com,cursor:`. Unset, empty or `*`: any. Loopback is always accepted. |
| `REVOKED_TOKEN_IDS` | no | `k3J9...,Xq2...` | Ids of revoked personal access tokens, comma-separated. |
| `HAROLD_TZ` | no | `America/Chicago` | Your IANA time zone. Unset: dates are UTC. An invalid name also falls back to UTC, and `harold_today` says so. |
| `HAROLD_NO_CADENCE_TYPES` | no | `other` | Contact types `crm_stale` never checks. Default `other`; set it empty to check every type. Same setting as in `~/.harold/env`. |
| `HAROLD_HUB_DEGREE` | no | `40` (default) | `harold_related`: a note with more links than this is a hub and no longer makes its neighbours related. Same setting as in `~/.harold/env`. |
| `HAROLD_PULSE_DAYS` | no | `14` (default) | `harold_pulse`: days without activity after which an active project is quiet. Unset, it uses the value the workspace wrote into `harold/graph.json` (its `HAROLD_PULSE_DAYS`), else 14. |
| `HAROLD_COMMIT_EMAIL` | no | `you@example.com` | Commit author email. Default `harold-connector@users.noreply.github.com`. |
| `SUPABASE_URL` | no | `https://<ref>.supabase.co` | The CRM and Harold's task list. Without it those tools say "not configured". Set by Vercel's Supabase integration. |
| `SUPABASE_SERVICE_ROLE_KEY` | no | the service_role key | The CRM and the task list (server side only; never in the repository). If unset, `SUPABASE_SECRET_KEY` (the name Vercel's Supabase integration uses) is read instead. |
| `SYNC_SECRET` | no | `openssl rand -hex 32` | The optional sync, every tool: the shared secret Supabase sends to `/sync/push` and `/sync/catchup`. The same value goes into Supabase Vault as `harold_sync_secret`. Asana's webhook also needs it. |
| `LINEAR_API_KEY` | no | a Linear personal API key | The optional Linear sync (server side only; never in the repository). |
| `LINEAR_TEAM_KEY` | no | `ENG` | The Linear team's issue prefix (`ENG` for `ENG-123`). Same setting as in `~/.harold/env`. |
| `LINEAR_WEBHOOK_SECRET` | no | the secret Linear shows for the webhook | The Linear sync: verifies the webhook Linear sends. |
| `TODOIST_API_TOKEN` | no | a Todoist API token | The optional Todoist sync (server side only). |
| `TODOIST_PROJECT`, `TODOIST_CLIENT_SECRET` | no | a project name; the Todoist app's client secret | Todoist: keep the sync to one project; verify Todoist's webhook. |
| `ASANA_ACCESS_TOKEN`, `ASANA_WORKSPACE` | no | a personal access token; a workspace name or gid | The optional Asana sync (both needed). `ASANA_PROJECT` keeps it to one project. |
| `NOTION_TOKEN` | no | an internal integration's secret | The optional Notion sync. The database and field mapping are saved with `sync_setup_notion`. `NOTION_WEBHOOK_SECRET` is optional. |
| `GOOGLE_CLIENT_ID` | no | from the Google OAuth client | The calendars, for `calendar_list` and `calendar_events` (server side only). Without it those two tools say "not configured". See "Optional: the calendars (Google)" below. |
| `GOOGLE_CLIENT_SECRET` | no | from the Google OAuth client | The calendars (server side only; never in the repository). |
| `ALLOWED_GOOGLE_EMAILS` | no | `you@example.com` | The only Google accounts the calendar connect flow will bind, comma-separated. Required with the pair above. |
| `GOOGLE_REFRESH_TOKEN` | no | the sealed value `/google/callback` shows once | The calendars. Without it the two tools say "not configured". |

To replace a single secret later on Vercel: `vercel env rm GITHUB_CLIENT_SECRET production`, `vercel env add GITHUB_CLIENT_SECRET production`, then redeploy (without `TOKEN_KEY`, this signs every tool out once).

### Verify

```bash
curl -s <PUBLIC_BASE_URL>/                                                        # names the /mcp URL; lists anything still missing as "Not ready"
curl -s <PUBLIC_BASE_URL>/.well-known/oauth-authorization-server | head -c 200    # JSON with "issuer"
curl -s <PUBLIC_BASE_URL>/.well-known/oauth-protected-resource/mcp                # "resource": "<PUBLIC_BASE_URL>/mcp"
curl -si -X POST <PUBLIC_BASE_URL>/mcp -H 'content-type: application/json' -d '{}' | grep -i www-authenticate   # 401 + resource_metadata
```

Here and below, `<PUBLIC_BASE_URL>` is the deployment's address, whether you set it or it is the default.

## Optional: two-way task sync (Linear, Todoist, Asana, Notion)

Harold's task list (Supabase `public.tasks`) is kept in step with each outside task tool that is configured: Linear, Todoist, Asana, Notion, or any mix. Every provider is optional. With none configured, the sync routes answer 503 and Harold's own task list works on its own. Code in `src/sync/` (one file per provider: `linear.ts`, `todoist.ts`, `asana.ts`, `notion.ts` with its setup step in `notion-setup.ts`; the list of configured providers in `registry.ts`); the Supabase side in `supabase/sync.sql`. This section is for the person who deploys the connector. The numbered setup steps for each tool are in `playbook/core/setup.md`, step 9.

| Route | Called by | Auth | What it does |
|---|---|---|---|
| `POST /webhooks/linear` | Linear's webhook (Issue events) | `Linear-Signature`: HMAC-SHA256 of the raw body with `LINEAR_WEBHOOK_SECRET`, hex, constant-time compare; `webhookTimestamp` must be within 60 s | create/update: re-reads the issue and upserts it into Harold (header `x-harold-origin: linear`). remove: an open task becomes `cancelled`; nothing is ever deleted. |
| `POST /webhooks/todoist` | Todoist's webhook (`item:*` events) | `X-Todoist-Hmac-SHA256`: HMAC-SHA256 of the raw body with `TODOIST_CLIENT_SECRET`, base64, constant-time compare; `triggered_at` must be within 60 minutes (Todoist retries a failed delivery up to three times, 15 minutes apart) | as for Linear, with origin `todoist`. `item:deleted` cancels an open task. |
| `POST /webhooks/asana` | Asana's webhooks (one per project) | the target URL carries `?t=<token>` (HMAC-SHA256 of `SYNC_SECRET`, hex); the first delivery of each webhook is a handshake with `X-Hook-Secret`, answered 200 with the same header and the secret stored in `sync_state` (row `asana`, `detail.hook_secrets`); later deliveries carry `X-Hook-Signature`: hex HMAC-SHA256 of the raw body with one of the stored secrets, constant-time compare | as for Linear, with origin `asana`. The event only names a task; the task is re-read. `deleted` cancels an open task. Heartbeats are acknowledged. |
| `POST /webhooks/notion` | Notion's webhook subscription (page events) | the one-time verification request (`{"verification_token": ...}`, recognised by its body; it cannot be checked yet, because it carries the token that signs later events) is accepted only within 30 minutes of the owner asking for it (`sync_setup_notion` webhook `expect`), and its token kept in `sync_state` (row `notion`, `detail.webhook`); later events carry `X-Notion-Signature: sha256=<hex HMAC-SHA256 of the raw body>` keyed with that token (or `NOTION_WEBHOOK_SECRET` when set), constant-time compare | as for Linear, with origin `notion`. The event only names a page; the page is re-read. `page.deleted` cancels an open task. Events whose parent names another data source are dropped. |
| `POST /sync/push` | the pg_net trigger on `tasks` | header `x-harold-sync-secret` = `SYNC_SECRET` | body `{"task_id": "<uuid>"}`: one Harold change out to **every** configured provider; creates the outside item and its `task_links` row when there is none. One provider failing is logged and the others still run. The answer lists each provider under `results`; with a single provider its result is also given at the top level, as before. |
| `POST /sync/catchup` | pg_cron, every 10 minutes | as above | for each provider in turn: pulls its changes since its own cursor, pushes Harold rows it has not seen yet (or open and never linked), stores the new cursor, and returns counts under `results`. Body `{"import": true}` runs the first import instead: every open item plus those completed in the last 30 days, logged as `import`; idempotent. Add `"provider": "linear"`, `"todoist"`, `"asana"` or `"notion"` to run or import one provider only. `npm run sync:import` (or `npm run sync:import -- asana`) does the same from a shell. |

A webhook is always verified before anything else (no GitHub call for a forged one; Asana's, and Notion's when `NOTION_WEBHOOK_SECRET` is not set, read their stored secret from `sync_state` first). An unknown provider name in the URL is a 404; a known provider that is not configured is a 503.

**Due dates** are calendar days: stored as midnight UTC and read as the first 10 characters, with no time-zone conversion. Only "today" uses `HAROLD_TZ`.

**Cursors.** Each provider keeps its own row in `sync_state`, keyed by its name, so Linear's existing row (`linear`) is untouched. Linear's cursor is a timestamp in `sync_state.cursor`. Todoist reads changes with its incremental sync, whose cursor is an opaque `sync_token`; that is kept in `sync_state.detail.cursor_token` (the `cursor` column is a timestamp, so there it records when the last catchup ran). Todoist's first catchup without a token does a full sync and takes only tasks changed in the last day; a token Todoist rejects is replaced the same way. Asana's cursor is a timestamp in `sync_state.cursor` like Linear's (its `detail.hook_secrets` holds the webhook secrets, see below).

**Several providers at once.** One engine runs per provider. A change one provider brings into Harold (`changed_by = 'linear'`) is new to the others: the webhook route passes it straight on to them, and each provider's catchup pushes every row whose last change came from anyone but itself. A provider never pushes its own change back to itself, so nothing echoes.

**Linear rules.** State types map backlog/unstarted → `pending`, started → `in_progress`, completed → `completed`, canceled → `cancelled`; priority 1–2 → `high`, 3 → `medium`, 4/0 → `low` (Harold `high` → 2, `medium` → 3, `low` → 4; only fields whose mapped value differs are sent, so an Urgent issue is never downgraded). A Linear project maps to the `harold/projects.md` entry whose `linear_project:` matches, else whose name or alias matches (case-insensitive); unmapped → project left empty and the Linear name kept in `sync_log`.

**Todoist rules.** A checked task is `completed`. Todoist has no in-progress or cancelled state, so those travel as labels: Harold `in_progress` adds the label `in-progress` to an open task; Harold `cancelled` completes the task and adds the label `cancelled`; the owner's other labels are left alone. A task deleted in Todoist cancels an open Harold task; the sync never deletes anything in Todoist. Priority: Todoist's API counts the other way from its apps (4 = p1, urgent): 4 and 3 → `high`, 2 → `medium`, 1 → `low`; Harold `high` → 3 (p2), `medium` → 2 (p3), `low` → 1 (p4); as with Linear, a p1 task is never downgraded. The due date is the day of `due.date` (a time of day is dropped; a recurring due date changed from Harold loses its recurrence). Notes are the task's description. Projects map through `todoist_project:` in a `harold/projects.md` entry, else the entry's name or aliases; a Harold task whose project Todoist lacks goes to the Inbox. With `TODOIST_PROJECT` set, only that project's tasks sync, new tasks go into it, and the sync never moves a task out of it. A task's key in Harold is `TD-<id>`, its link `https://app.todoist.com/app/task/<id>`.

**Asana rules.** A completed task is `completed`. Asana has no in-progress or cancelled state, so those travel as tags, found by name in the workspace and created there the first time they are needed: Harold `in_progress` adds the tag `in-progress` to an open task; Harold `cancelled` completes the task and adds the tag `cancelled`; the owner's other tags are left alone. (A section called "In progress" was the other option; it would have to exist in every project, and a task has a different section in each project it is in, while a tag is one thing for the whole workspace and works on every plan.) **Priority is not synced at all:** Asana has no priority on a task, only an optional custom field on paid plans that each workspace sets up its own way. Harold's priority is never sent and never changed by Asana. The due date is `due_on` (a task with only a due time is read as that UTC day). Notes are the task's plain-text notes. Projects map through `asana_project:` in a `harold/projects.md` entry, else the entry's name or aliases; for a task in several projects the first one Harold knows is used. With `ASANA_PROJECT` set, only that project's tasks sync, new tasks go into it, and the sync never moves a task out of it. Without it, a new task goes into the Asana project that matches its Harold project; if there is none it is made in the workspace and assigned to the token's owner. A Harold task whose project is cleared stays where it is in Asana (Asana has no inbox to move it to). A task's key in Harold is `AS-<gid>`, its link Asana's `permalink_url`.

**How Asana is read.** Asana can list tasks only for a project, a tag, or an assignee plus a workspace; the workspace-wide search is a paid-plan feature. So each catchup lists every non-archived project of the workspace (or just `ASANA_PROJECT`) and, when not kept to one project, the tasks assigned to the token's owner, which is where a task made without a project lives. A task in two projects is read once. That is one request per project every 10 minutes (Asana's free plan allows 150 a minute), so for a large workspace set `ASANA_PROJECT`. Changes since the cursor use Asana's `modified_since`; the first import uses `completed_since` (every open task plus those completed in the window). Subtasks are not synced.

**Deleting in Asana.** Asana's lists never include deleted tasks, so catchup cannot see a deletion. The webhook can: its `deleted` event cancels the open Harold task (nothing is ever deleted in Harold, and the sync never deletes in Asana). Without the webhook, a task deleted in Asana stays open in Harold until Harold next changes it, when the sync finds the task gone, logs a `skip` and leaves both alone. Checking every linked task on each catchup would cost one request per task every 10 minutes, so that was not chosen.

**Creating in Asana, which has no idempotency key.** Like Todoist, Asana picks its own ids, so the link row is written first under a placeholder and moved onto the task's gid once Asana answers. Unlike Todoist, Asana cannot be given a key that makes a repeated create return the first task. So if the connector crashes after Asana made the task but before the link was moved, a retry could make a second task. The engine closes most of that: catchup pulls Asana's changes before it retries anything, and a pulled task whose title matches a pending placeholder is adopted (the link moves onto it) instead of being imported twice; the retry waits two minutes. A twin appears only if Asana's copy was never seen by a pull in between. The sync never deletes a twin; the owner removes it.

**Asana's webhooks.** Asana sends task events only to a webhook on a project, so there is one webhook per project (a workspace webhook carries none). Create them with `npm run sync:asana-webhook -- https://<connector host>` (needs `ASANA_ACCESS_TOKEN`, `ASANA_WORKSPACE`, `SYNC_SECRET` in the shell; `ASANA_PROJECT` limits it to one project; run again after adding projects; it skips a project that already has one). The connector must already be deployed with the same variables: Asana calls `/webhooks/asana` during the request to complete the handshake, and each webhook gets its own secret, which the connector stores. Because anyone could send a handshake, the target URL carries a token made from `SYNC_SECRET` and every delivery without it is refused; without `SYNC_SECRET` the webhook answers 503. Asana deletes a webhook that has not answered for 24 hours; run the script again to restore it (catchup carries the changes meanwhile).

### Notion

**Setup lives in the database, not the environment.** `NOTION_TOKEN` (the secret of an internal integration, from notion.so/profile/integrations) is the only required variable. Which database holds the tasks and how its properties map to Harold's fields is saved by the MCP tool **`sync_setup_notion`** in `sync_state` row `notion`, `detail.setup` (`database_id`, `data_source_id`, `fields: {title, status, due, priority, notes, project}`, `status_map`, `status_in`, `priority_map`, `priority_in`), so choosing or changing the database needs no redeploy. Until a setup is saved, Notion is configured but **not set up**: `/sync/push` reports it as `skipped` with that reason, `/sync/catchup` as `{"skipped": "<reason>"}`, its webhook ignores events, and the other providers run as usual.

**Setting it up** (in any chat connected to Harold):
1. In Notion, share the task database with the integration (Notion's documentation describes it for a page: the ••• menu, then Add connections).
2. Ask Harold to set up the Notion task sync. With no arguments `sync_setup_notion` lists the databases shared with the integration (and proposes a mapping when only one is shared); name one (by name, id or URL) and it proposes which property holds each field, in plain English: the title property; a Status or Select property for the status, with which option means to do / in progress / done / cancelled (from the option names and Notion's status groups To-do / In progress / Complete); a Date property for the due date; a Select named like Priority (High / Medium / Low by name; a Priority select with no options yet is set up as High / Medium / Low, which Notion adds to the select the first time Harold writes each one); a Rich text property for notes (only a text property: with none, notes are not synced; the page body is never read or written); a Select for the project. Each proposal is checked against the database's real properties and options. Nothing is saved until the owner says yes (the same call with `confirm: true`); any choice can be changed with `fields`, `status_map` or `priority_map`.
3. Run the first import: `POST /sync/catchup` with `{"import": true, "provider": "notion"}` (or `npm run sync:import -- notion`).
4. Webhook (recommended): ask Harold to expect the Notion webhook (`webhook: "expect"`), create a subscription in the integration's Webhooks tab with the URL `<PUBLIC_BASE_URL>/webhooks/notion` and the page events, then ask Harold to reveal the token (`webhook: "reveal_token"`) and paste it into Notion's Verify form. Without the webhook, catchup carries Notion's edits within 10 minutes, but not a page moved to the trash: a data source query never returns trashed pages, so only the webhook's `page.deleted` event cancels the Harold task. Without it, the task stays open until Harold next changes it, when the sync reads the page as trashed, logs a `skip` and leaves both alone (as for a deletion in Asana).

**The webhook token, and why this flow.** Notion's verification request carries the very token that signs later events, so the connector cannot check it, and anyone who knows the URL could send one; it is therefore accepted only during a 30-minute window the owner opens, and the window closes when a token arrives. The token signs every later event, so it is a secret: it is kept only in `sync_state` (never in `sync_log` or the function log) and shown only when the owner asks for it in an authenticated session, because the owner has to paste it into Notion. Harold checks signatures with it straight away, so no redeploy is needed. Setting `NOTION_WEBHOOK_SECRET` to the same value is optional; then signatures are checked without a database read, and Harold erases its stored copy.

**Notion rules.** API version `2026-03-11` (pinned). Since 2025-09-03 a Notion database holds one or more *data sources*, which own the properties, the queries (`POST /v1/data_sources/{id}/query`) and the pages (parent `{type: "data_source_id"}`); the setup records both ids and runs against the data source. Status: Harold writes the option chosen for each status; a status with no option of its own is written as the nearest one (cancelled as done, in progress as to do). Reading, an option chosen in the setup counts as chosen; an unmapped option of a Status property counts by its group (To-do → `pending`, In progress → `in_progress`, Complete → `completed`); an unmapped Select option, or an option added after setup, counts as `pending` (run the setup again after adding options). Priority: the chosen High / Medium / Low options (other options by name, e.g. "Urgent" → `high`); an empty priority stays empty, and Harold never fills it with its own default. The due date is the day of the Date's start (a time or an end date set in Notion is dropped when Harold changes the date). Notes are plain text (formatting is lost when Harold changes them). Projects map through `notion_project:` in a `harold/projects.md` entry, else its name or aliases; writing a project Notion's select does not have adds the option. Fields not chosen in the setup are never pulled, so Harold's values stay. A page in the trash or archived cancels an open Harold task; a page moved out of the data source just stops syncing. The sync never deletes a page. A page's key in Harold is `NO-<last 8 hex of its id>` (pages of one workspace share the start of their ids), its link the page URL.

**Minute-granular timestamps.** Notion rounds `last_edited_time` to the minute. Catchup queries pages edited since one minute before its cursor (re-reading an unchanged page changes nothing), and the engine treats a page as changed when its timestamp equals the last agreed one but its fields differ from the agreed values (`SyncProvider.coarseTimestamps`), so an edit in the same minute as the previous sync is not lost. A conflict between two edits in the same minute goes to Harold (ties go to Harold).

**Creating in Notion, which has no idempotency key.** As with Todoist and Asana, the link row is written first under a placeholder and moved to the page id. To stop a retried create making a twin, the provider first looks for a page in the data source with the same title created since the placeholder was made (it carries its own time) and returns that page instead. The first import takes every open page plus finished pages edited in the last 30 days (Notion records no completion date).

**Creating in a tool that picks its own ids (Todoist).** Linear accepts an id chosen by Harold, so the link row is written under that id before the issue exists. Todoist assigns ids itself, so the link row is written first under a placeholder (`pending:<time>:<uuid>`) and moved onto the real id once Todoist answers. The placeholder is also sent as the create command's `uuid`, which Todoist uses to ignore a repeated command, so a create retried after a crash returns the task already made instead of a second one. A webhook or catchup that sees the new task before the link has moved finds a pending link whose task has the same title and waits rather than importing a twin. A placeholder left for more than two minutes counts as abandoned: catchup re-sends the create under the same key, or a pull of the matching task adopts the link. No database change was needed.

**Merging** (every provider). `task_links.synced_fields` holds the field values both sides last agreed on, written after every successful sync. A field changed on one side only is taken from that side; different fields changed on each side are merged with no conflict; the **same field** changed on both sides to different values is a **conflict**: the later timestamp wins (ties to Harold) and a `sync_log` `conflict` row keeps both values, the agreed value and the winner. A link with no `synced_fields` yet (its first sync) uses the whole-version rule: if both sides changed, the later version wins outright. Echo safety: sync writes carry `x-harold-origin`, so the trigger marks them `changed_by = '<provider>'` and the push trigger never fires for them; a webhook for our own push finds both sides equal and only refreshes the link.

**No GitHub token of its own.** The sync routes have no GitHub access. Authenticated MCP requests, which carry the owner's token, do two jobs in passing (`src/sync/housekeeping.ts`), alongside the request and never holding it more than 5 s:
- the **project-map cache**: `harold/projects.md` parsed into `sync_state` row `harold-projects` (`{projects: [{name, aliases, folder, linear_project, provider_projects?}], read_at}`; `provider_projects` holds any other `<provider>_project:` field, such as `todoist_project`), at most every 10 minutes. The sync routes read only this cache. **No cache: 503 and nothing syncs** (project mapping cannot be checked). A cache older than 7 days is still used, and a `skip` row is logged.
- **`harold/tasks-snapshot.md`**: the open tasks grouped Overdue / Due today / Due this week / In progress / Later (in your time zone, `HAROLD_TZ`), rewritten only when the list changed since the last write (hash in `sync_state` row `harold-snapshot`) and at most every 30 minutes. Never from cron or webhooks; the daily morning-brief job keeps it at least a day fresh.

**Environment.** Always `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SYNC_SECRET`; then the variables of each provider you want. A provider is on when its required variables are set.

| Variable | Provider | What it does |
|---|---|---|
| `SYNC_SECRET` | all | `openssl rand -hex 32`; the same value goes into Supabase Vault as `harold_sync_secret`. Guards `/sync/push` and `/sync/catchup`. |
| `LINEAR_API_KEY` | Linear (required) | a Linear personal API key. |
| `LINEAR_TEAM_KEY` | Linear (required) | the team's issue prefix (e.g. `ENG`); only that team's issues sync. |
| `LINEAR_WEBHOOK_SECRET` | Linear (for its webhook) | the signing secret Linear shows for the webhook (Settings, API, Webhooks; URL `<PUBLIC_BASE_URL>/webhooks/linear`, resource type Issues, your team). Without it the webhook answers 503 and catchup alone carries changes. |
| `TODOIST_API_TOKEN` | Todoist (required) | the personal API token from your Todoist account's integrations settings (or, with the webhook, the access token of your own Todoist app). |
| `TODOIST_PROJECT` | Todoist (optional) | the name of one Todoist project to keep the sync to. Unset: every project. |
| `TODOIST_CLIENT_SECRET` | Todoist (for its webhook) | the client secret of a Todoist app (App Management Console) whose webhook URL is `<PUBLIC_BASE_URL>/webhooks/todoist`, with the `item:*` events. Webhooks need that app with its webhook URL and events set, and the connector using that app's token (the access token you get by authorizing the app with your own account, as Todoist's webhook documentation requires); then changes made by any client on the account (the app, the web, another token) arrive within seconds. Without it, the 10-minute catchup is the only path from Todoist to Harold. |
| `NOTION_TOKEN` | Notion (required) | the secret of an internal Notion integration (created in Notion's developer portal; its **Configuration** tab shows the secret), with read, update and insert content capabilities; share the task database with it. The database and the field mapping are saved with `sync_setup_notion`, not here. |
| `NOTION_WEBHOOK_SECRET` | Notion (optional) | the webhook verification token, if you prefer it in the environment; without it the token received through the `sync_setup_notion` flow is used. |
| `ASANA_ACCESS_TOKEN` | Asana (required) | an Asana personal access token (created in Asana's developer console). |
| `ASANA_WORKSPACE` | Asana (required) | the workspace's gid or name. |
| `ASANA_PROJECT` | Asana (optional) | the gid or name of one project to keep the sync to. Unset: every project of the workspace. Its webhook also needs `SYNC_SECRET` (see "Asana's webhooks"). |

**Supabase pieces** (`supabase/sync.sql`, run by hand after the task-list migration and after the connector is deployed with the variables above; it is not applied automatically):

- Vault secrets `harold_connector_url` (the connector's origin) and `harold_sync_secret` (= `SYNC_SECRET`).
- `public.harold_sync_call(path, body, timeout)`: a `security definer` helper that reads both secrets and calls `net.http_post`; execute revoked from `anon`/`authenticated`.
- Trigger `tasks_sync_push`: `AFTER INSERT OR UPDATE ON public.tasks FOR EACH ROW WHEN (NEW.changed_by = 'harold')` → `POST /sync/push`. A failed enqueue never blocks the write; catchup covers it.
- pg_cron job `harold-sync-catchup`, `*/10 * * * *` → `POST /sync/catchup`.

## Connect your tool

Every tool uses the same address, **`<PUBLIC_BASE_URL>/mcp`** (MCP Streamable HTTP), and the same sign-in: the tool opens a browser, the connector's own **"Connect Harold?"** page shows the tool's name and exactly where the sign-in will be sent, you press *Continue to GitHub*, and only the owner's account is accepted there (the owner of the deployment's repository, or the account in `ALLOWED_GITHUB_LOGIN` / `ALLOWED_GITHUB_ID`). Any client that supports remote MCP servers with OAuth (dynamic client registration or Client ID Metadata Documents) should work: the connector accepts loopback redirects (`http://127.0.0.1`, `http://[::1]`, `http://localhost`, any port: command-line and desktop tools), app schemes such as `cursor://` and `vscode://`, and `https` redirects on any host. Leave any optional OAuth client id / secret fields empty: the connector registers the client itself.

| Tool | How to connect | Tested with this connector? |
|---|---|---|
| Claude (web, desktop, phone) | claude.ai in a browser: Settings → Connectors → Add custom connector | Yes (claude.ai in a browser) |
| Claude Code | `claude mcp add --transport http harold <PUBLIC_BASE_URL>/mcp`, then `/mcp` (or `claude mcp login harold`) | No; command from Claude Code's docs |
| Codex CLI | `codex mcp add harold --url <PUBLIC_BASE_URL>/mcp`, then `codex mcp login harold` | No; commands from Codex's docs |
| Cursor | `mcpServers` entry with a `url` in `~/.cursor/mcp.json` (below) | No; format from Cursor's docs |
| VS Code | `servers` entry with `"type": "http"` in `.vscode/mcp.json` (below) | No; format from VS Code's docs |
| ChatGPT | Developer mode → create an app for a remote MCP server, URL as above, OAuth | No; menus not verified |
| Any other MCP client (Hermes Agent, OpenClaw, ...) | Add a remote MCP server (Streamable HTTP) with the URL above, OAuth | No |
| Cron jobs, scripts, tools without OAuth | A personal access token in an `Authorization: Bearer` header ([below](#personal-access-tokens)) | Unit-tested only |

**Claude.** Name `Harold`, URL `<PUBLIC_BASE_URL>/mcp`, then **Connect**. The connector's own "Connect Harold?" page opens: press *Continue to GitHub*, sign in with the allowed account (GitHub asks for approval the first time only), and the browser returns to Claude. Once added, the connector is available in Claude on the web, desktop and mobile.

**Claude Code** ([docs](https://code.claude.com/docs/en/mcp)):

```bash
claude mcp add --transport http harold <PUBLIC_BASE_URL>/mcp
# then, inside Claude Code: /mcp, pick harold, sign in in the browser
```

**Codex CLI** ([docs](https://developers.openai.com/codex/mcp)): `codex mcp add harold --url <PUBLIC_BASE_URL>/mcp`, or in `~/.codex/config.toml`:

```toml
[mcp_servers.harold]
url = "<PUBLIC_BASE_URL>/mcp"
```

then `codex mcp login harold`.

**Cursor** ([docs](https://cursor.com/docs/mcp)): in `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{ "mcpServers": { "harold": { "url": "<PUBLIC_BASE_URL>/mcp" } } }
```

**VS Code** ([docs](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)): in `.vscode/mcp.json` (one workspace) or your user `mcp.json`:

```json
{ "servers": { "harold": { "type": "http", "url": "<PUBLIC_BASE_URL>/mcp" } } }
```

VS Code opens a browser to sign in the first time it connects.

**ChatGPT** ([help article](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)): developer mode has to be on (in a workspace an admin turns it on); then create an app for a remote MCP server with the URL above and OAuth authentication. The exact menu names change; follow the help article.

**Anything else:** add a remote MCP server with the URL above. If the tool asks for an authentication type, choose OAuth. If it can only send a fixed header, use a personal access token.

If a tool's sign-in is refused with `invalid_redirect_uri`, either the tool uses a redirect this connector refuses (plain `http` to a non-loopback host, a fragment, userinfo, or a scheme such as `javascript:`), or `ALLOWED_REDIRECT_HOSTS` is set and does not include the tool's redirect host (or its scheme, e.g. `cursor:`).

### Personal access tokens

For a cron job, a script, or an agent that can only be given a fixed `Authorization: Bearer ...` header. A token is sealed with the connector's key (only whoever holds it can mint one), carries the GitHub token the tools act with, and lasts at most 365 days.

```bash
# In a shell that has the deployment's values (never put them on the command line or in a committed file):
#   the key: TOKEN_KEY, or GITHUB_CLIENT_SECRET when the deployment has no TOKEN_KEY;
#   the owner: ALLOWED_GITHUB_LOGIN and ALLOWED_GITHUB_ID, or HAROLD_REPO when the deployment leaves them unset;
#   and GITHUB_TOKEN (or a signed-in `gh` CLI)
read -rs GITHUB_CLIENT_SECRET && export GITHUB_CLIENT_SECRET   # paste, Return; typing is hidden (or TOKEN_KEY)
export HAROLD_REPO=<your-login>/<your-repo>                    # or ALLOWED_GITHUB_LOGIN=... ALLOWED_GITHUB_ID=...
npm run token -- --name nightly-brief --days 90
```

The token is printed once (stdout); its id and expiry go to stderr. Nothing is stored. The GitHub token is checked to be the owner's when minting; a fine-grained GitHub token limited to `HAROLD_REPO` (contents: read and write) keeps a leaked PAT's reach small (not yet tested: whether GitHub code search, used by `harold_search`, works with a fine-grained token).

Use it as a header, for example `claude mcp add --transport http harold <PUBLIC_BASE_URL>/mcp --header "Authorization: Bearer $HAROLD_TOKEN"` (Claude Code), or `bearer_token_env_var = "HAROLD_TOKEN"` in the Codex server table.

- **Revoke one token:** add its id to `REVOKED_TOKEN_IDS` (comma-separated) in the deployment and redeploy.
- **Revoke all of them:** change the key: rotate `TOKEN_KEY`, or the OAuth App's client secret when `TOKEN_KEY` is unset (this also signs every OAuth client out).
- Treat a token like a password: it can read and write Harold until it expires. The connector refuses to write one into the knowledge base.

### Optional: the calendars (Google)

The connector can hold its own Google Calendar access, configured once, so every connected tool reads the same calendars - including chat apps with no calendar connector of their own. Read-only scopes only; managing events is a separate grant, described after the setup steps.

1. **Create a Google OAuth client** (console.cloud.google.com: APIs & Services - Credentials - Create OAuth client ID - Web application). Add `<PUBLIC_BASE_URL>/google/callback` under Authorized redirect URIs, and enable the Google Calendar API in the same project.
2. **Publish the consent screen** (APIs & Services - OAuth consent screen - Publish app). A consent screen left in "Testing" status issues refresh tokens that expire after 7 days, which would mean a weekly re-connect. The requested scopes are read-only (`calendar.readonly` and `calendar.calendarlist.readonly`).
3. **Set the variables** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `ALLOWED_GOOGLE_EMAILS` (your own Google email) in Production.
4. **Connect the account:** open `<PUBLIC_BASE_URL>/google/authorize` in a browser and approve. Google redirects back to the connector; the callback refuses any Google account whose email is not in `ALLOWED_GOOGLE_EMAILS`, then shows the sealed refresh token once. Store it as `GOOGLE_REFRESH_TOKEN` (Production) and redeploy.

Connecting more than one Google account: run the connect flow once per account. The connect page identifies the token setting to use: GOOGLE_REFRESH_TOKEN for the first account, then GOOGLE_REFRESH_TOKEN_2 through GOOGLE_REFRESH_TOKEN_8. calendar_list groups calendars by account, and calendar_events reads across connected accounts. Shared calendars and duplicate events are combined. If one account's authorization expires, the response reports that failure while continuing to read the other accounts.

Creating, editing and cancelling events: Harold can manage events after you grant Google's event-editing permission and reconnect the account. Each change requires your instruction. If more than one calendar could be the target, Harold asks you to specify which one before making a change. It reports permission problems, expired connections and usage-limit errors separately. Calendar sharing and deletion of whole calendars aren't supported.

The sealed token is encrypted with the connector's key and useless without it; changing the key (`TOKEN_KEY`, or the client secret when `TOKEN_KEY` is unset) revokes it (connect again the same way).

## Limits

- **Boot and close do not run through the connector.** No hook runs there, so `bin/harold boot` does not load context and `bin/harold close` does not check filing. The tools file directly (a chat log line, a note, a lesson, a CRM record), and the next workspace session's boot and close see whatever landed in the repository. Heavy work on Harold itself still belongs in a session in the workspace.
- **Search lags.** `harold_search` uses GitHub code search, which indexes the repository's default branch and can be a few minutes behind recent commits (including the connector's own). `harold_read` always returns the branch head.
- **No deletes**, by design. Remove things in a workspace session.
- **The Google calendar token lives in the environment.** The connector has no database: if the Google grant is revoked or rotated, re-run `/google/authorize` and update `GOOGLE_REFRESH_TOKEN`. A durable token store is a possible follow-up, deliberately not built in - it would make the CRM database a hard dependency of calendar reads.
- **Stateless sign-in.** An authorization code is refused on reuse only within the same server instance (PKCE still binds it to the client that started the flow); refresh tokens stay valid until they expire. To end every session at once, change the key (`TOKEN_KEY`, or the client secret when `TOKEN_KEY` is unset) or revoke the OAuth App's grant on GitHub. Personal access tokens cannot be listed, only revoked by id or all together.

## Tests

```bash
npm install
npm run typecheck
npm test                     # unit tests and an OAuth flow simulation with a mocked GitHub and CRM; no network, no credentials
```

The provider tests (`todoist-sync`, `asana-sync`, `notion-sync`, `sync-registry`) use recorded API response shapes in `test/unit/fixtures/`. Most are written from each vendor's documentation, and a few are recorded from throwaway accounts (each folder's `README.md` says which). They prove the provider's logic against those shapes, not that the live service still matches them.

`npm run sync:live-test -- todoist|asana|notion` (add `--scoped` to keep Todoist or Asana to one project) runs a provider and the sync engine against a real account, with an in-memory stand-in for Harold's task list: it never touches Supabase and refuses to run if `SUPABASE_URL` is set. It needs `LIVE_TEST=1` (the script sets it) and the provider's credentials. **Use a throwaway account or workspace, never your real one.** It creates, edits and deletes tasks there, and cleans up after itself. It is not part of `npm test`.

`npm test` also runs `bin/harold where` from the surrounding workspace (read-only) to check that `harold_where` resolves topics the same way; those cases skip when the connector is used outside a Harold workspace.

End-to-end scripts (not part of `npm test`) run a real local server against your repository. Each exits 0 with a `skipped: set ...` line when its variables are missing:

```bash
HAROLD_REPO=you/harold npm run test:e2e:read                        # read-only; token from GITHUB_TOKEN or `gh auth token`
HAROLD_REPO=you/harold HAROLD_E2E_WRITE=1 npm run test:e2e:write    # write tools on a throwaway branch connector-test-<timestamp>, deleted afterwards
HAROLD_REPO=you/harold SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run test:e2e:crm   # CRM read tools only
```

Local server: `PORT=8787 npm run dev` with the variables from `.env.example` and `PUBLIC_BASE_URL=http://localhost:8787`.

## Files

- `server.ts`: Vercel entrypoint (exports the Hono app). `local.ts`: Node entry for any other host and for local runs.
- `src/app.ts`: routes. `src/oauth.ts`: the authorization server. `src/redirects.ts`: which redirect URIs and metadata URLs are accepted. `src/crypto.ts`: sealing and PKCE. `src/identity.ts`: the one-account check (a named account, or the owner of the deployment's repository).
- `src/pat.ts` and `scripts/mint-token.ts` (`npm run token`): personal access tokens.
- `src/tools.ts`: MCP tools. `src/instructions.ts`: what the client's model is told when the connector is on.
- `src/kb.ts`: knowledge-base reads and writes. `src/github.ts`: GitHub API. `src/text.ts`: dates, frontmatter, secret scan.
- `src/projects.ts`, `src/learnings.ts`: ports of `bin/harold where` and `bin/harold file learning`.
- `src/graph.ts`: `harold_related`, a port of `bin/harold related` over `harold/graph.json`. `src/stale.ts`: `crm_stale`. `src/pulse.ts`: `harold_pulse`, the same procedure as `bin/harold pulse` (`test/unit/pulse-fixture.json` is shared with the workspace's Python tests, so both give the same text for the same repository). `src/heartbeat.ts`: `harold_heartbeat` storage and `harold_heartbeat_latest`. `src/morning.ts`: the critical lessons, housekeeping notes and Step 0 in `harold_today`.
- `src/tasks.ts`: `task_list`, `task_create`, `task_update` and `crm_task`, over Harold's own task list in Supabase (with the old-schema fallback).
- `src/sync/`: the optional two-way task sync. `provider.ts` (the provider interface), one file per provider (`linear.ts`, `todoist.ts`, `asana.ts`, `notion.ts`, with Notion's setup tool in `notion-setup.ts`), `registry.ts` (which providers are configured), `projectmap.ts`, `engine.ts` (reconcile, field-level merge, conflicts, catch-up, import), `store.ts` (Supabase), `snapshot.ts`, `housekeeping.ts`, `routes.ts`. Also `scripts/linear-import.ts` (`npm run sync:import`), `scripts/asana-webhook.ts` (`npm run sync:asana-webhook`), `scripts/live-test.ts` and `supabase/sync.sql`.
- `src/crm.ts`: the CRM, ported from `tools/harold-mcp/server.js` against the same schema. `src/config.ts`: every setting and its default.
- `src/google.ts`: the connector's own Google sign-in for calendar access (`/google/authorize`, `/google/callback`). `src/calendar.ts`: `calendar_list` and `calendar_events`.

Library note: `mcp-handler` 2.x is built on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). The tests connect with both the 1.31 client (`@modelcontextprotocol/sdk`) and the v2 client (`@modelcontextprotocol/client`).

