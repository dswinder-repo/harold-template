# Harold connector

A hosted remote MCP server. It lets any AI tool that supports remote MCP servers (chat apps such as Claude or ChatGPT, coding agents such as Claude Code, Codex, Cursor or VS Code, and scheduled jobs) read and write your Harold from the web, desktop, phone or a server, without the workspace folder on that device:

- the **knowledge base**, in your private GitHub repository (`HAROLD_REPO`), through the GitHub API;
- optionally, the **CRM**, in your Supabase project (the schema in `tools/harold-mcp/schema.sql`).

You deploy it once, to a host you control, and add its URL in each tool ([Connect your tool](#connect-your-tool)). Nothing in it is tied to one computer: it runs wherever you deploy it, and every write is a commit to your repository.

- **Transport:** MCP Streamable HTTP at `/mcp` (2026-07-28 protocol and 2025-era clients).
- **Sign-in:** a small OAuth 2.1 server in the same deployment, with GitHub as the identity provider. Any MCP client can sign in; exactly one GitHub account is accepted. Tools that cannot do OAuth use a personal access token.
- **Runtime:** Node.js 22 or later. A Hono app (`server.ts`) that runs on Vercel with zero configuration, or on any Node host through `local.ts`.

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `harold_today` | read | Today's date in `HAROLD_TZ`, today's morning brief draft (`harold/briefs/<date>.md`, if you use the scheduled brief), the Current Alerts section of `harold/alerts.md`, the critical lessons from `harold/learnings.jsonl`, the housekeeping notes waiting under `## New` in `harold/briefs/housekeeping-notes.md`, the active projects that have gone quiet (as `harold_pulse`), the five latest daily notes, and the brief's Step 0: show the draft, ask what came in overnight, then the day's priorities. |
| `harold_search` | read | Searches the repository (GitHub code search; falls back to matching file names). |
| `harold_read` | read | Reads one text file by repo path. Refuses binaries, truncates very long files. |
| `harold_list` | read | Lists a folder. |
| `harold_where` | read | Resolves a topic to a project from `harold/projects.md`, with the same scoring as `bin/harold where`. |
| `harold_related` | read | Follows the links from a note (a path, a title, or a topic found with the same search as `harold_search`): the linked notes 1 to 2 hops out, each with how it is linked and its `last_updated` date, then a gaps line (not updated in 30+ days, broken links, orphans, no meeting notes; archived notes are never stale). Reads `harold/graph.json`, which `bin/harold close` writes; the same ranking as `bin/harold related`. A workspace without that file gets a plain message saying how to produce it. |
| `harold_pulse` | read | Which projects have gone quiet: for each active project in `harold/projects.md`, its newest activity (a note linked to its card, a note in its folder, a daily or meeting note that names it, or a commit touching its folder) with what it was and its date, its next step (`next_step:` in the map entry or the card, or a `Next step:` line in the card or the folder README), and a quiet flag after `HAROLD_PULSE_DAYS` days (default 14) without any. The same answer as `bin/harold pulse`, from `harold/graph.json`, the project map and the commit history; `all: true` adds every next step and the projects that are not active. |
| `harold_person` | read | A person's card in `vault/people/` (fuzzy name match) plus, when the CRM is configured, their CRM record. |
| `crm_search_contacts` | read | Filters CRM contacts (type, warmth, stage, purpose, project, keyword, ...). |
| `crm_get_contact` | read | One contact's full record: interactions, open tasks, stage history. |
| `crm_stale` | read | Who has gone quiet: active or pending contacts whose last interaction is older than their cadence (the tightest stage cadence among their open pipeline entries, else warmth: Hot 7 days, Warm 14, Lukewarm 28; Cold or unset warmth is never flagged). The same rule as `harold_cadence_check` in `tools/harold-mcp`. Types in `HAROLD_NO_CADENCE_TYPES` and `HAROLD_NO_LOG_TYPES` are skipped, by the contact's type only. |
| `harold_capture` | write | "Remember this": a timestamped line in `vault/daily/<date>-chat.md`. |
| `harold_note` | write | A new note in `vault/intel`, `vault/decisions`, `vault/meetings`, `vault/companies` or `vault/projects`. Never overwrites. |
| `harold_update` | write | Appends to (optionally under a heading) and/or sets simple frontmatter fields of an existing `.md` under `vault/` or `harold/`. |
| `harold_learning` | write | Appends a lesson to `harold/learnings.jsonl` with the next free id, in the same format as `bin/harold file learning` (`source: connector`). |
| `crm_log_interaction` | write | Logs a touchpoint with a contact and freshens their vault card. Refused for contact types in `HAROLD_NO_LOG_TYPES`. |
| `crm_upsert_contact` | write | Creates or updates a contact. The type is free text from your own list (as in `dashboard/people.md`). Never places anyone in the pipeline. |
| `crm_pipeline` | write | The one pipeline: add (a purpose is required), move, close, list. |
| `crm_task` | write | Contact follow-up tasks: create, update, complete, cancel, list. |
| `task_list` | read | Open tasks in your task manager (Linear, team `LINEAR_TEAM_KEY`), most recently updated first, with ID, project, state, due date and URL; optional text filter. The model calls it before `task_create` so nothing is created twice. |
| `task_create` | write | One task in your task manager: title, optional description, due date (`YYYY-MM-DD`), project (by name) and priority, the same calls as `bin/harold-linear create`. An open task with the same title is returned instead of a duplicate. Refuses secrets. The instructions tell the model to create one per commitment whenever you paste meeting notes, a transcript or a forwarded email, without being asked, and to write each task ID into the meeting note's `## Action items`. |

Without `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, the CRM tools answer "not configured" and everything else works. Without `LINEAR_API_KEY` and `LINEAR_TEAM_KEY`, `task_list` and `task_create` say so plainly and point the model at `crm_task` for contact follow-ups.

## Security model

- **One account.** Only the GitHub account named by `ALLOWED_GITHUB_LOGIN` **and** `ALLOWED_GITHUB_ID` gets in; both must match (a login can be renamed and re-registered by someone else, the numeric id cannot). The identity is checked at sign-in, at every token refresh, and once per access token on `/mcp`. A refused account's GitHub grant is revoked.
- **No database, encrypted state.** Client ids, sign-in state, authorization codes, access tokens (24 hours) and refresh tokens (90 days) are AES-256-GCM blobs sealed with `TOKEN_KEY`, each bound to its purpose, so one kind cannot be replayed as another. Changing `TOKEN_KEY` signs every client out.
- **Redirects any tool can use.** OAuth redirects may go to loopback (`http://127.0.0.1`, `http://[::1]`, `http://localhost`, any port and path, RFC 8252 §7.3; a loopback redirect may differ from the registered one in its port only), to an app's own scheme such as `cursor://` or `com.example.app:/cb` (RFC 8252 §7.1; never `javascript:`, `data:`, `file:`, `blob:`, `about:`, `vbscript:`, `ws:`, `wss:`, `ftp:` or a few other meaningless ones), or to `https` on any host. Never with userinfo, a fragment, whitespace, or plain `http` to anything but loopback. `ALLOWED_REDIRECT_HOSTS`, when set, narrows https hosts and app schemes and is re-checked on every use, so narrowing it also cuts off existing registrations.
- **Why that is safe.** Once any tool may connect, a redirect list cannot tell a real tool from an impostor anyway. What protects your Harold is the one-account GitHub gate above, PKCE (S256, required), which binds each code to the client that started the flow so a code intercepted on its way to a loopback port or an app scheme is useless, and the consent page. That page (with a nonce cookie, so another site cannot press its button) stands between every request and GitHub, and shows the client's name and, in large type, exactly where the sign-in will be sent, with the full redirect address underneath. It is the one thing a phishing link has to get past: anyone can register their own client and send you an `/authorize` link, and the page will name their destination. If that is too much trust in one click, set `ALLOWED_REDIRECT_HOSTS`.
- **Client ID Metadata Documents** (an `https://` client_id whose JSON lists its redirect URIs) are fetched from public hosts only: default port, no redirects followed, at most 64 KB, and a host that is or resolves to a private, loopback or link-local address is refused, so the connector cannot be used to reach internal services. A hostile DNS server that answers differently a moment after the check (DNS rebinding) is not excluded.
- **Personal access tokens** are sealed with `TOKEN_KEY` as their own kind (never accepted as a client id, code or refresh token, nor the reverse), last at most 365 days, and are revoked by id (`REVOKED_TOKEN_IDS`) or all at once (rotate `TOKEN_KEY`).
- **No deletes.** There is no delete tool. Read tools declare `readOnlyHint: true`; write tools `readOnlyHint: false, destructiveHint: false`.
- **Secret scan on every write.** Content that looks like a key or token (the same patterns as `bin/harold`, plus GitHub OAuth tokens and plain `password: ...` phrases) is refused and nothing is committed.
- **Writes are commits.** Each write is one commit on `HAROLD_BRANCH` with the message `chore(connector): ...`, authored by "Harold (connector)" with a neutral email (`harold-connector@users.noreply.github.com`, or `HAROLD_COMMIT_EMAIL`). Writes use the file's current sha and retry up to 3 times on a conflict, so a concurrent session's commit is never overwritten.
- **GitHub scope.** The connector asks GitHub for the `repo` scope, because it reads and writes a private repository. GitHub OAuth Apps cannot be limited to one repository: the grant covers every repository the account can reach, and the connector only ever touches `HAROLD_REPO`. Revoke it at github.com → Settings → Applications → Authorized OAuth Apps.

## Deploy

Pick the public address first: the GitHub OAuth App and every token depend on it. That origin, with no trailing slash, is `PUBLIC_BASE_URL`.

### 1. Create the deployment

**Vercel** (zero-config Hono; `vercel.json` is included). Either:

- with the CLI, from this folder:
  ```bash
  cd tools/harold-connector
  vercel link        # create a new project; the framework (Hono) is detected
  ```
- or in the Vercel dashboard: import your repository and set the project's **Root Directory** to `tools/harold-connector`.

The production address is `https://<project>.vercel.app` unless you add a domain. Keep production publicly reachable (Vercel's default *Standard Protection* protects previews only): every tool must reach `/mcp` without a Vercel login. The connector does its own authentication.

**Any other Node 22+ host** that can run a long-lived HTTP server: `npm ci`, then `PORT=8787 npx tsx local.ts` (this is what `npm run dev` does) behind HTTPS, with the variables below in the environment. `local.ts` serves the same Hono app through `@hono/node-server`.

### 2. Create a GitHub OAuth App

github.com → Settings → Developer settings → OAuth Apps → New OAuth App:

- Application name: anything, e.g. `Harold connector`
- Homepage URL: `<PUBLIC_BASE_URL>`
- Authorization callback URL: **`<PUBLIC_BASE_URL>/github/callback`**
- Leave Device Flow off. Register, then *Generate a new client secret*.

### 3. Find your numeric GitHub id and generate a key

```bash
gh api user --jq .id                 # or open https://api.github.com/users/<your-login> and read "id"
openssl rand -hex 32                 # TOKEN_KEY
```

### 4. Set the environment variables

On Vercel: Project → Settings → Environment Variables, or `vercel env add <NAME> production` for each (it prompts for the value, so it never lands in your shell history). `.env.example` lists the same set.

| Variable | Required | Example | Purpose |
|---|---|---|---|
| `HAROLD_REPO` | yes | `your-login/harold` | The private repository that holds your Harold workspace. No default. |
| `HAROLD_BRANCH` | no | `main` (default) | The branch tools read and commit to. |
| `ALLOWED_GITHUB_LOGIN` | yes | `your-login` | The only GitHub account accepted. |
| `ALLOWED_GITHUB_ID` | yes | `12345678` | That account's numeric id. Must match too. |
| `GITHUB_CLIENT_ID` | yes | from the OAuth App | GitHub sign-in. |
| `GITHUB_CLIENT_SECRET` | yes | from the OAuth App | GitHub sign-in. |
| `TOKEN_KEY` | yes | `openssl rand -hex 32` | 64 hex characters; encrypts every token and code. |
| `PUBLIC_BASE_URL` | yes | `https://<project>.vercel.app` | This deployment's public origin, no trailing slash. |
| `ALLOWED_REDIRECT_HOSTS` | no | unset (default: any tool) | Optional narrowing: exact https hosts and app schemes, e.g. `claude.ai,claude.com,cursor:`. Unset, empty or `*`: any. Loopback is always accepted. |
| `REVOKED_TOKEN_IDS` | no | `k3J9...,Xq2...` | Ids of revoked personal access tokens, comma-separated. |
| `HAROLD_TZ` | no | `America/Chicago` | Your IANA time zone. Unset: dates are UTC. An invalid name also falls back to UTC, and `harold_today` says so. |
| `HAROLD_NO_LOG_TYPES` | no | `team` | Contact types whose conversations are never logged as interactions. Empty by default. Same setting as in `~/.harold/env`. |
| `HAROLD_NO_CADENCE_TYPES` | no | `other` | Contact types `crm_stale` never checks. Default `other`; set it empty to check every type. Same setting as in `~/.harold/env`. |
| `HAROLD_HUB_DEGREE` | no | `40` (default) | `harold_related`: a note with more links than this is a hub and no longer makes its neighbours related. Same setting as in `~/.harold/env`. |
| `HAROLD_PULSE_DAYS` | no | `14` (default) | `harold_pulse`: days without activity after which an active project is quiet. Unset, it uses the value the workspace wrote into `harold/graph.json` (its `HAROLD_PULSE_DAYS`), else 14. |
| `HAROLD_COMMIT_EMAIL` | no | `you@example.com` | Commit author email. Default `harold-connector@users.noreply.github.com`. |
| `SUPABASE_URL` | no | `https://<ref>.supabase.co` | The CRM. Without it the CRM tools say "not configured". |
| `SUPABASE_SERVICE_ROLE_KEY` | no | the service_role key | The CRM (server side only; never in the repository). |
| `LINEAR_API_KEY` | no | a Linear personal API key | The task manager, for `task_list` and `task_create` (server side only; never in the repository). Without it those two tools say "not configured". |
| `LINEAR_TEAM_KEY` | no | `ENG` | Your Linear team's issue prefix (`ENG` for `ENG-123`). Same settings as in `~/.harold/env`. |

Set `HAROLD_TZ`: otherwise "today", the chat-log file name and note dates are UTC dates. To replace a single secret later on Vercel: `vercel env rm GITHUB_CLIENT_SECRET production`, `vercel env add GITHUB_CLIENT_SECRET production`, then redeploy.

### 5. Deploy and verify

```bash
vercel deploy --prod
curl -s <PUBLIC_BASE_URL>/                                                        # names the /mcp URL; says "Not ready" if HAROLD_REPO is missing
curl -s <PUBLIC_BASE_URL>/.well-known/oauth-authorization-server | head -c 200    # JSON with "issuer"
curl -s <PUBLIC_BASE_URL>/.well-known/oauth-protected-resource/mcp                # "resource": "<PUBLIC_BASE_URL>/mcp"
curl -si -X POST <PUBLIC_BASE_URL>/mcp -H 'content-type: application/json' -d '{}' | grep -i www-authenticate   # 401 + resource_metadata
```

## Connect your tool

Every tool uses the same address, **`<PUBLIC_BASE_URL>/mcp`** (MCP Streamable HTTP), and the same sign-in: the tool opens a browser, the connector's own **"Connect Harold?"** page shows the tool's name and exactly where the sign-in will be sent, you press *Continue to GitHub*, and only the account in `ALLOWED_GITHUB_LOGIN` / `ALLOWED_GITHUB_ID` is accepted there. Any client that supports remote MCP servers with OAuth (dynamic client registration or Client ID Metadata Documents) should work: the connector accepts loopback redirects (`http://127.0.0.1`, `http://[::1]`, `http://localhost`, any port: command-line and desktop tools), app schemes such as `cursor://` and `vscode://`, and `https` redirects on any host. Leave any optional OAuth client id / secret fields empty: the connector registers the client itself.

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

For a cron job, a script, or an agent that can only be given a fixed `Authorization: Bearer ...` header. A token is sealed with `TOKEN_KEY` (only whoever holds the key can mint one), carries the GitHub token the tools act with, and lasts at most 365 days.

```bash
# In a shell that has the deployment's values (never put them on the command line or in a committed file):
#   TOKEN_KEY, ALLOWED_GITHUB_LOGIN, ALLOWED_GITHUB_ID, and GITHUB_TOKEN (or a signed-in `gh` CLI)
read -rs TOKEN_KEY && export TOKEN_KEY        # paste, Return; typing is hidden
export ALLOWED_GITHUB_LOGIN=<your-login> ALLOWED_GITHUB_ID=<your-numeric-id>
npm run token -- --name nightly-brief --days 90
```

The token is printed once (stdout); its id and expiry go to stderr. Nothing is stored. The GitHub token is checked to be the owner's when minting; a fine-grained GitHub token limited to `HAROLD_REPO` (contents: read and write) keeps a leaked PAT's reach small (not yet tested: whether GitHub code search, used by `harold_search`, works with a fine-grained token).

Use it as a header, for example `claude mcp add --transport http harold <PUBLIC_BASE_URL>/mcp --header "Authorization: Bearer $HAROLD_TOKEN"` (Claude Code), or `bearer_token_env_var = "HAROLD_TOKEN"` in the Codex server table.

- **Revoke one token:** add its id to `REVOKED_TOKEN_IDS` (comma-separated) in the deployment and redeploy.
- **Revoke all of them:** rotate `TOKEN_KEY` (this also signs every OAuth client out).
- Treat a token like a password: it can read and write Harold until it expires. The connector refuses to write one into the knowledge base.

## Limits

- **Boot and close do not run through the connector.** No hook runs there, so `bin/harold boot` does not load context and `bin/harold close` does not check filing. The tools file directly (a chat log line, a note, a lesson, a CRM record), and the next workspace session's boot and close see whatever landed in the repository. Heavy work on Harold itself still belongs in a session in the workspace.
- **Search lags.** `harold_search` uses GitHub code search, which indexes the repository's default branch and can be a few minutes behind recent commits (including the connector's own). `harold_read` always returns the branch head.
- **No deletes**, by design. Remove things in a workspace session.
- **Stateless sign-in.** An authorization code is refused on reuse only within the same server instance (PKCE still binds it to the client that started the flow); refresh tokens stay valid until they expire. To end every session at once, change `TOKEN_KEY` or revoke the OAuth App's grant on GitHub. Personal access tokens cannot be listed, only revoked by id or all together.
- **Optional `HAROLD_NO_LOG_TYPES`.** When set, `crm_log_interaction` refuses contacts whose CRM type, or whose vault card's `type` (or older `category`), is listed. Records can still be created and updated; those cards are not freshened by CRM writes.

## Tests

```bash
npm install
npm run typecheck
npm test                     # unit tests and an OAuth flow simulation with a mocked GitHub and CRM; no network, no credentials
```

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
- `src/app.ts`: routes. `src/oauth.ts`: the authorization server. `src/redirects.ts`: which redirect URIs and metadata URLs are accepted. `src/crypto.ts`: sealing and PKCE. `src/identity.ts`: the one-account check.
- `src/pat.ts` and `scripts/mint-token.ts` (`npm run token`): personal access tokens.
- `src/tools.ts`: MCP tools. `src/instructions.ts`: what the client's model is told when the connector is on.
- `src/kb.ts`: knowledge-base reads and writes. `src/github.ts`: GitHub API. `src/text.ts`: dates, frontmatter, secret scan.
- `src/projects.ts`, `src/learnings.ts`: ports of `bin/harold where` and `bin/harold file learning`.
- `src/graph.ts`: `harold_related`, a port of `bin/harold related` over `harold/graph.json`. `src/stale.ts`: `crm_stale`. `src/pulse.ts`: `harold_pulse`, the same procedure as `bin/harold pulse` (`test/unit/pulse-fixture.json` is shared with the workspace's Python tests, so both give the same text for the same repository). `src/morning.ts`: the critical lessons, housekeeping notes and Step 0 in `harold_today`.
- `src/tasks.ts`: `task_list` and `task_create`, Linear's GraphQL API as `bin/harold-linear` calls it.
- `src/crm.ts`: the CRM, ported from `tools/harold-mcp/server.js` against the same schema. `src/config.ts`: every setting.

Library note: `mcp-handler` 2.x is built on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). The tests connect with both the 1.31 client (`@modelcontextprotocol/sdk`) and the v2 client (`@modelcontextprotocol/client`).
