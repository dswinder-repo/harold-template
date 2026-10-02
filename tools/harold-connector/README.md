# Harold connector (optional)

An optional hosted remote MCP server. It lets any chat app that supports remote MCP connectors (often called custom connectors) read and write your Harold from the web, desktop or phone, without the workspace folder on that device:

- the **knowledge base**, in your private GitHub repository (`HAROLD_REPO`), through the GitHub API;
- optionally, the **CRM**, in your Supabase project (the schema in `tools/harold-mcp/schema.sql`).

You deploy it once, to a host you control, and add its URL in your chat app. Nothing in it is tied to one computer: it runs wherever you deploy it, and every write is a commit to your repository.

- **Transport:** MCP Streamable HTTP at `/mcp` (2026-07-28 protocol and 2025-era clients).
- **Sign-in:** a small OAuth 2.1 server in the same deployment, with GitHub as the identity provider. Exactly one GitHub account is accepted.
- **Runtime:** Node.js 22 or later. A Hono app (`server.ts`) that runs on Vercel with zero configuration, or on any Node host through `local.ts`.

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `harold_today` | read | Today's date in `HAROLD_TZ`, today's morning brief draft (`harold/briefs/<date>.md`, if you use the scheduled brief), the Current Alerts section of `harold/alerts.md`, the five latest daily notes. |
| `harold_search` | read | Searches the repository (GitHub code search; falls back to matching file names). |
| `harold_read` | read | Reads one text file by repo path. Refuses binaries, truncates very long files. |
| `harold_list` | read | Lists a folder. |
| `harold_where` | read | Resolves a topic to a project from `harold/projects.md`, with the same scoring as `bin/harold where`. |
| `harold_person` | read | A person's card in `vault/people/` (fuzzy name match) plus, when the CRM is configured, their CRM record. |
| `crm_search_contacts` | read | Filters CRM contacts (type, warmth, stage, purpose, project, keyword, ...). |
| `crm_get_contact` | read | One contact's full record: interactions, open tasks, stage history. |
| `harold_capture` | write | "Remember this": a timestamped line in `vault/daily/<date>-chat.md`. |
| `harold_note` | write | A new note in `vault/intel`, `vault/decisions`, `vault/meetings`, `vault/companies` or `vault/projects`. Never overwrites. |
| `harold_update` | write | Appends to (optionally under a heading) and/or sets simple frontmatter fields of an existing `.md` under `vault/` or `harold/`. |
| `harold_learning` | write | Appends a lesson to `harold/learnings.jsonl` with the next free id, in the same format as `bin/harold file learning` (`source: connector`). |
| `crm_log_interaction` | write | Logs a touchpoint with a contact and freshens their vault card. Refused for contact types in `HAROLD_NO_LOG_TYPES`. |
| `crm_upsert_contact` | write | Creates or updates a contact. The type is free text from your own list (as in `dashboard/people.md`). Never places anyone in the pipeline. |
| `crm_pipeline` | write | The one pipeline: add (a purpose is required), move, close, list. |
| `crm_task` | write | Contact follow-up tasks: create, update, complete, cancel, list. |

Without `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, the CRM tools answer "not configured" and everything else works.

## Security model

- **One account.** Only the GitHub account named by `ALLOWED_GITHUB_LOGIN` **and** `ALLOWED_GITHUB_ID` gets in; both must match (a login can be renamed and re-registered by someone else, the numeric id cannot). The identity is checked at sign-in, at every token refresh, and once per access token on `/mcp`. A refused account's GitHub grant is revoked.
- **No database, encrypted state.** Client ids, sign-in state, authorization codes, access tokens (24 hours) and refresh tokens (90 days) are AES-256-GCM blobs sealed with `TOKEN_KEY`, each bound to its purpose, so one kind cannot be replayed as another. Changing `TOKEN_KEY` signs every client out.
- **Redirect allowlist.** OAuth redirects go only to `https` URLs on the exact hosts in `ALLOWED_REDIRECT_HOSTS`, checked at registration and on every use. PKCE (S256) is required. A consent page with a nonce cookie stands between a client's request and GitHub, so a crafted link cannot complete sign-in silently.
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

The production address is `https://<project>.vercel.app` unless you add a domain. Keep production publicly reachable (Vercel's default *Standard Protection* protects previews only): the chat app must reach `/mcp` without a Vercel login. The connector does its own authentication.

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
| `ALLOWED_REDIRECT_HOSTS` | no | `claude.ai,claude.com` (default) | Exact hosts a chat app may receive the sign-in on. Add other chat apps' OAuth redirect hosts here. |
| `HAROLD_TZ` | no | `America/Chicago` | Your IANA time zone. Unset: dates are UTC. An invalid name also falls back to UTC, and `harold_today` says so. |
| `HAROLD_NO_LOG_TYPES` | no | `team` | Contact types whose conversations are never logged as interactions. Empty by default. Same setting as in `~/.harold/env`. |
| `HAROLD_COMMIT_EMAIL` | no | `you@example.com` | Commit author email. Default `harold-connector@users.noreply.github.com`. |
| `SUPABASE_URL` | no | `https://<ref>.supabase.co` | The CRM. Without it the CRM tools say "not configured". |
| `SUPABASE_SERVICE_ROLE_KEY` | no | the service_role key | The CRM (server side only; never in the repository). |

Set `HAROLD_TZ`: otherwise "today", the chat-log file name and note dates are UTC dates. To replace a single secret later on Vercel: `vercel env rm GITHUB_CLIENT_SECRET production`, `vercel env add GITHUB_CLIENT_SECRET production`, then redeploy.

### 5. Deploy and verify

```bash
vercel deploy --prod
curl -s <PUBLIC_BASE_URL>/                                                        # names the /mcp URL; says "Not ready" if HAROLD_REPO is missing
curl -s <PUBLIC_BASE_URL>/.well-known/oauth-authorization-server | head -c 200    # JSON with "issuer"
curl -s <PUBLIC_BASE_URL>/.well-known/oauth-protected-resource/mcp                # "resource": "<PUBLIC_BASE_URL>/mcp"
curl -si -X POST <PUBLIC_BASE_URL>/mcp -H 'content-type: application/json' -d '{}' | grep -i www-authenticate   # 401 + resource_metadata
```

## Add it to a chat app

Claude is the example here, and the only client the author has exercised. Any client that supports remote MCP servers with OAuth (dynamic client registration or client ID metadata documents) should work the same way, once its OAuth redirect host is in `ALLOWED_REDIRECT_HOSTS`.

In Claude (claude.ai in a browser): **Settings → Connectors → Add custom connector**.

- Name: `Harold`
- URL: **`<PUBLIC_BASE_URL>/mcp`**
- Leave any optional OAuth client id / secret fields empty: the connector registers the client itself.

Click **Connect**. The connector's own "Connect Harold?" page opens: press *Continue to GitHub*, sign in with the allowed account (GitHub asks for approval the first time only), and the browser returns to the chat app. Once added, the connector is available in Claude on the web, desktop and mobile.

For another chat app: find the host its OAuth flow redirects to (the `redirect_uris` it registers; a refused registration names the allowed hosts), add that host to `ALLOWED_REDIRECT_HOSTS`, redeploy, and add `<PUBLIC_BASE_URL>/mcp` as a remote MCP server there.

## Limits

- **Boot and close do not run in connector chats.** No hook runs there, so `bin/harold boot` does not load context and `bin/harold close` does not check filing. The tools file directly (a chat log line, a note, a lesson, a CRM record), and the next workspace session's boot and close see whatever landed in the repository. Heavy work on Harold itself still belongs in a session in the workspace.
- **Search lags.** `harold_search` uses GitHub code search, which indexes the repository's default branch and can be a few minutes behind recent commits (including the connector's own). `harold_read` always returns the branch head.
- **No deletes**, by design. Remove things in a workspace session.
- **Stateless sign-in.** An authorization code is refused on reuse only within the same server instance (PKCE still binds it to the client that started the flow); refresh tokens stay valid until they expire. To end every session at once, change `TOKEN_KEY` or revoke the OAuth App's grant on GitHub.
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
- `src/app.ts`: routes. `src/oauth.ts`: the authorization server. `src/crypto.ts`: sealing and PKCE. `src/identity.ts`: the one-account check.
- `src/tools.ts`: MCP tools. `src/instructions.ts`: what the chat app's model is told when the connector is on.
- `src/kb.ts`: knowledge-base reads and writes. `src/github.ts`: GitHub API. `src/text.ts`: dates, frontmatter, secret scan.
- `src/projects.ts`, `src/learnings.ts`: ports of `bin/harold where` and `bin/harold file learning`.
- `src/crm.ts`: the CRM, ported from `tools/harold-mcp/server.js` against the same schema. `src/config.ts`: every setting.

Library note: `mcp-handler` 2.x is built on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). The tests connect with both the 1.31 client (`@modelcontextprotocol/sdk`) and the v2 client (`@modelcontextprotocol/client`).
