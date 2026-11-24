# Playbook: Setup

**Purpose:** Walk a new operator through choosing where Harold lives, making their own private copy and setting it up, in conversation, to a clean first close.

**Trigger:** "set up Harold", "install Harold", "help me get started with Harold", a first run in a fresh copy of the starter, or boot opening with `⚠ NOT SET UP YET`. Also when the operator points their AI tool at harold.works or the starter repository and asks for Harold.

---

## How to run this playbook

- **You do the work; the operator answers questions.** Ask for each detail in conversation, then write it into the files yourself. Never ask the operator to open or edit a file, and never guess a detail they have not given you. If an answer is unclear, ask again.
- **One step at a time, in order.** Say what the step is for in one sentence, ask what you need, do it, confirm it in one line, and move on. Steps 1 to 9 are required, the connector and the CRM included. Step 10 offers the optional parts, each with a plain "skip for now" path, and step 11 checks the result.
- **Say this early, in plain words:** Harold saves the operator's work by committing it with git and pushing it to their own private repository at the end of every turn. That repository will hold their working life (people, meetings, decisions), so it must be private, and it must be theirs.
- **If the operator stops partway,** the next session picks up where this one left off: boot names what is still missing in its `⚠ NOT SET UP YET` notice, and this playbook resumes at the first unfinished step.
- **Starting from one pasted line.** The docs at harold.works give the operator one line to paste into their AI tool, which points it at this playbook. If that is how you got here and the operator has no copy of Harold yet, start at step 1: it asks where Harold will live, then makes the copy. You need to be able to run shell commands, on the operator's computer or in a cloud session. On their computer, git, Node 22+, Python 3.8+ and curl must be installed (help the operator install whichever is missing); cloud sessions usually have them already. If the tool you are running in can only chat and cannot run commands, say so, and ask the operator to paste the same line into an AI tool that can: one that works in a folder on their computer, or one that runs cloud sessions from a GitHub repository.
- **Working in Cowork (the Claude desktop app).** Cowork works in a folder on the operator's computer, so Harold lives on their computer (step 1, the second way), and the desktop app must be open for Cowork to reach the folder. Setup needs a shell, git, Node 22+, Python and network access to GitHub, and Cowork's task may not allow all of them. Check before relying on it: run `node --version`, `git --version` and `git ls-remote origin` in the connected folder. The plugin's hooks need `bash` and `node` (boot) and `git` plus network access to GitHub (close pushes). If one of them cannot run there, say which, and run the shell-heavy steps (1 to 3 and 8) from another tool on the same folder, such as a terminal or a coding agent, then come back to Cowork for the plugin (the "Optional: Cowork" section in step 10). Do not assume; report what the checks print.
- **Working in a cloud session.** Three things differ from a computer. *Network:* many cloud tools limit which sites a session can reach, and setup needs GitHub, Vercel and Supabase (`github.com`, `api.github.com`, `vercel.com`, `api.vercel.com`, `supabase.com`, the project's own `<ref>.supabase.co` address, and the npm registry for `npx`). If a command is refused by the network, tell the operator which sites to allow in the cloud tool's settings for this environment and wait for them; if they would rather not, do that part from a temporary copy on their computer (step 1). *Signing in:* a command that would open a browser on a computer prints a link or a code in a cloud session instead; give it to the operator to open. *Branch:* the cloud tool should start sessions on the repository's main branch, which is where the connector reads and writes. A session on a separate branch is saved to that branch only, and reaches Harold when it is merged.
- **Do it yourself wherever you can.** Run the commands, generate values, use the command-line tools of GitHub, Vercel and Supabase once the operator has signed in, and check every result yourself. Ask the operator only for what a person must do: creating accounts, signing in when a browser opens, filling in a form no tool can fill (GitHub's OAuth app form), and answering questions. When they must click, tell them exactly what to click, one screen at a time.
- **Read the documentation as plain text** when you need more detail than this playbook gives: `https://harold.works/llms-full.txt` holds the full docs.

> **Visualizer, first action:** if boot has run, update `harold/active-sessions/{session}.json`: set `ops` to `"working"`, task = "Setting up Harold", progress = 0.

---

## Step 1: Where Harold lives, and a private copy of the operator's own

**First, ask where the operator wants to keep Harold.** Before making anything, explain the two ways in plain words, say what each means day to day, and let them choose. They can change their mind later: either way, everything is in their private GitHub repository.

> **1. In the cloud (recommended).** Harold lives only in your private GitHub repository. When you want to work with it, you start a session in your AI tool's cloud, from that repository (for example Claude Code on the web or in the Claude app, Codex cloud tasks or Cursor background agents). The session copies Harold at the start and saves back to your repository at the end of every turn. Chat apps on your phone and on the web reach Harold through the connector. Nothing stays on your computer, and you can pick up from any device. You need an AI tool that can run cloud sessions from a GitHub repository.
>
> **2. On your own computer.** Harold is a folder on your computer, which you open in your AI tool there. It is still saved to your private GitHub repository at the end of every turn, and chat apps still reach it through the connector. Your computer needs a few free programs (git, Node, Python), which I can install for you.

Both ways need the connector (step 8). Installing git, Node and Python on the operator's computer is needed only for the second way, or to run this setup from their computer.

**Then decide where this setup runs:**

- **Already in a cloud session.** Do everything here. If the session was started on the public starter itself, make the private copy (below, from the template), then ask the operator to start a new cloud session on their own repository and carry on there from step 2.
- **In a tool on their computer, and they chose the cloud.** Create their private repository on GitHub (below, from the template). Then either finish setup here, in a temporary copy on this computer that you push to their repository every turn (this needs git, Node, Python and curl here), or, if they would rather install nothing, have them start a cloud session on their new repository and carry on there from step 2. Step 11 tells them how to open Harold in the cloud from then on.
- **In a tool on their computer (a terminal, a coding agent, Cowork), and they chose their computer.** Clone the copy into the folder they want Harold to live in, outside iCloud, Dropbox or other synced folders, which can evict files.

**Making the copy.** Harold must never push to the public starter, and `bin/harold close` refuses to: while `origin` still points at it, close commits locally and stops with "NOT PUSHED: origin is the public Harold starter".

Ask whether the operator has a GitHub account (or another git host) and whether they have already made their own copy. If they have no GitHub account yet, help them create one first; Harold needs somewhere private to save to. Then take one of two paths:

- **From the template (simplest).** If the GitHub CLI is installed, have the operator sign in (`gh auth login`, in the browser when asked) and create the copy yourself: `gh repo create <name> --private --template dswinder-repo/harold-template`, adding `--clone` to put a working copy here. Otherwise, on the starter's GitHub page, the operator chooses **Use this template → Create a new repository**, sets it to **Private**, and gives you the new repository's URL. To work from a copy here, clone it (`git clone <their URL> <folder>`) and work from that folder.
- **From a clone you already have.** Ask the operator to create an empty **private** repository (no README, no licence) and give you its URL. Then re-point `origin` and push:
  ```bash
  git remote set-url origin <their private repository URL>
  git push -u origin HEAD
  ```

Check it with `git remote get-url origin`: it must be the operator's repository.

## Step 2: Git identity

Git records who saved each change. Run `git config user.name` and `git config user.email`. If either is empty, ask the operator which name and email to use and set them for this repository:

```bash
git config user.name "<their name>"
git config user.email "<their email>"
```

Write the same name, email and GitHub account into the **Git & GitHub Workflow** section of `AGENTS.md`, and the repository (`<account>/<repository>`) into its opening paragraph. Ask which of their repositories, if any, are live projects that must use branches and pull requests, and list them there; with none, write "none yet".

## Step 3: Check the workspace

Run `bin/harold check`. It only reads, and it should end with `RESULT: PASS`. Warnings about the time zone and `origin` (and a missing search index) are expected at this point; this playbook clears them. Placeholders are not checked here: boot's NOT SET UP YET notice lists them. If it fails, read the failure to the operator in plain words and fix it before going on.

## Step 4: Time zone and settings

Ask for the operator's city or time zone and turn it into an IANA name (for example America/Chicago, Europe/London, Asia/Singapore). Write it into `harold/settings.env` by uncommenting the `HAROLD_TZ` line:

```bash
HAROLD_TZ="Europe/London"
```

Then offer the other settings in that file, each with its default, and change only those the operator wants changed:

- `HAROLD_BRIEF_TIME`: the weekday time the scheduled morning brief is due (default 06:30).
- `HAROLD_STALE_DAYS`: days after which a note counts as stale (default 30).
- `HAROLD_PULSE_DAYS`: days without activity after which a project counts as quiet (default 14).

`harold/settings.env` is committed, so it must only ever hold non-secret settings. Credentials go in `~/.harold/env`, never in the repository.

## Step 5: The operator's details

Ask, in conversation and a few questions at a time: their name, role, organisation (or "independent"), what they are accountable for, how they like to work (for example short answers, drafts for review), the city they want weather for, the calendars they use, the markets and news topics they follow, and any extra sections they want in the morning brief.

Then replace every bracketed placeholder that starts with `YOUR` with what they said. Find them all with:

```bash
grep -rn "\[YOUR\|\[LIST YOUR" AGENTS.md memory dashboard playbook harold vault --include=*.md
```

They sit in `AGENTS.md`, `memory/working-memory.md`, `dashboard/people.md`, `dashboard/strategy.md`, `harold/facts.md`, `harold/brief-prompt.md`, the configuration table at the top of `playbook/core/morning-brief.md`, and a few other playbooks and vault notes. Leave `vault/templates/` alone: its placeholders are filled each time a template is used. Where the operator has no answer for one (for example no newsletter yet), write a short honest value such as "none yet" rather than leaving the bracket. Finally, delete the last line of `AGENTS.md`, which asks for exactly this.

Show the operator a short summary of what you wrote and correct anything they change.

## Step 6: Contact types

Every contact in the CRM has exactly one type. Show the operator the default list in `dashboard/people.md` (investor, partner, founder, team, other) and what each covers, and ask whether it fits their work. Keep the list short. Replace the bracketed examples in its table with who each type covers for them, and add or rename types only if they ask. Labels (for example `board`, `advisor`, `press`) cover everything else, any number per contact.

## Step 7: First projects

Ask what the operator is working on now, and take the one to three that matter most. For each, follow `playbook/core/project-intake.md`: a folder, an entry in `harold/projects.md` (folder, status `active`, type, the names they actually call it as aliases, and its next step) and a card in `vault/projects/`. Ask for the next step of each; `bin/harold pulse` shows it every day.

Then ask whether to remove the starter's example content (Jane Doe, Acme Corp, "Example Project", blocker B001, the example lesson L001, the example event) now or once real content has replaced it. It is inert either way: it carries no dates, so nothing in it falls due.

## Step 8: The connector

The connector (`tools/harold-connector`) is a required part of Harold. It is a small server, hosted in the operator's own free Vercel account, that lets them reach Harold from their phone, from the Claude website and from any AI tool on any device that supports remote MCP servers. It carries the CRM and the task list: every AI tool writes contacts and tasks through it. It also needs the CRM database, so this step creates that too.

**Tell the operator first, in plain words,** what they will do themselves and what you will do. They will create two free accounts (Vercel and Supabase), sign in when a command opens a browser, and fill in one form on GitHub. You do everything else: the deployment, the settings, the checks. Then work through the items below in order, one at a time, and wait for the operator to confirm each thing only they can do.

1. **The accounts.** Ask the operator to create a free account at vercel.com (the simplest way is **Continue with GitHub**, which also lets Vercel see their private repository) and a free account at supabase.com (also possible with GitHub). If they already have them, use those.
2. **Deploy the connector.** Create a Vercel project from the operator's private repository, with **Root Directory** `tools/harold-connector`, and deploy it to production. It must be imported from the repository, not uploaded as a folder, so that the connector can work out which repository it serves and later pushes to its folder redeploy it.
   - Do it yourself with the Vercel CLI: run `npx vercel login` and let the operator sign in when the browser opens, then create and link the project and deploy it (`npx vercel --prod`). Set the project's **Ignored Build Step** to `git diff HEAD^ HEAD --quiet -- .`: Harold pushes the workspace at the end of every turn, and this keeps those pushes from redeploying the connector unless its own folder changed.
   - If the CLI cannot do a part, give the operator the exact clicks: in Vercel, **Add New**, then **Project**, then **Import** next to their Harold repository; open **Root Directory**, choose `tools/harold-connector`, and press **Deploy**. The connector's README (`tools/harold-connector/README.md`) also has a **Deploy with Vercel** button that does the same.
   - The connector works out the rest of its own settings on Vercel: the repository, the one GitHub account allowed in (the operator's), its encryption key and its public address. On a host other than Vercel, follow the connector README instead.
3. **Open the connector's home page.** Its address is the project's production address, `https://<project>.vercel.app` (Vercel shows it on the project page). Fetch it with `curl -s <address>/` and read it. The page shows the two addresses GitHub's form needs (the homepage and the callback address) and says which settings are still missing. Use the production address, never the address of one particular deployment.
4. **The CRM database.** If Vercel offers its Supabase integration for the project (the project's **Storage** tab, or **Integrations**), let the operator use it: it creates the Supabase project and fills in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on Vercel by itself. Otherwise the operator creates a project at supabase.com (**New project**: a name, a database password they keep in their password manager, a region near them) and you note its address and service role key (Supabase: **Project Settings**, then **API**). Either way, create the tables from `tools/harold-mcp/schema.sql`: run it yourself if you can reach the database (the Supabase CLI, or `psql` with the connection string the operator gives you), or have the operator open **SQL Editor**, then **New query**, paste the whole file (paste it for them) and press **Run**. "Done" looks like **Success. No rows returned**.
5. **The GitHub OAuth app.** This is the one form no tool can fill in, so the operator does it. Tell them, step by step: open `https://github.com/settings/applications/new` (GitHub: **Settings**, then **Developer settings**, then **OAuth Apps**, then **New OAuth App**); Application name `Harold`; Homepage URL and Authorization callback URL exactly as the connector's home page shows them; leave **Enable Device Flow** unticked; press **Register application**. On the next page, copy the **Client ID**, then press **Generate a new client secret** and copy the secret straight away (GitHub shows it once).
6. **Give Vercel the codes.** Four settings go on the project (Vercel: **Settings**, then **Environment Variables**, Production): `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` from the form, and `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` unless the Supabase integration already filled them in. The client secret and the service role key are secrets: the safest path is for the operator to paste them into Vercel's screen themselves. If they give them to you, set them with `npx vercel env add <NAME> production` (it asks for the value) and never repeat them back. Also set `HAROLD_TZ` to the time zone from step 4, so the connector's dates are the operator's. Nothing goes into the repository.
7. **Redeploy and check.** Redeploy so the connector reads its settings (`npx vercel --prod`, or Vercel: **Deployments**, the latest, **Redeploy**). Then check it yourself, never on trust:
   ```bash
   curl -s <address>/                                                           # names the /mcp address; no "Not ready"
   curl -s <address>/.well-known/oauth-authorization-server | head -c 200       # JSON with "issuer"
   curl -si -X POST <address>/mcp -H 'content-type: application/json' -d '{}' | grep -i www-authenticate   # a 401 that names resource_metadata
   ```
   The connector README's "Deploy and verify" section has the full list. **If `curl` gets a Vercel login page or a Vercel 401 instead of the connector,** Vercel's deployment protection is in the way: use the production address, and if that is still blocked, turn off **Vercel Authentication** for production (project **Settings**, then **Deployment Protection**). The connector does its own sign-in.
8. **Add the connector to the operator's AI tools.** The address is `<address>/mcp`. Add it to the tool you are running in now, then to each other tool the operator uses: chat apps on the web and phone (in Claude, for example, **Settings**, then **Connectors**, then **Add custom connector**), coding agents and editors. The connector README's "Connect your tool" section has each tool's command or menu. Signing in opens a browser: the connector's own **Connect Harold?** page names the tool, the operator presses **Continue to GitHub** and approves, and only their GitHub account is accepted. Leave any client id or secret fields in the tool empty.
9. **Check it from the tool.** Call `harold_today` through the connector, then search the CRM for any name with `crm_search_contacts`. An answer with no error (an empty search is fine) means the connector, the knowledge base and the CRM all work.

**Only for a tool that cannot connect to a remote MCP server,** use the local fallback, harold-mcp, on that computer: run `bin/harold-setup-crm` (it stores the Supabase address and service role key in `~/.harold/env` and tests the connection), then `(cd tools/harold-mcp && npm install)`, and add `bin/harold-mcp` to that tool's MCP servers by its absolute path (`.mcp.example.json` shows the shape). When Harold lives on the operator's computer, `bin/harold-setup-crm` is also worth running there even with the connector: with those two values in `~/.harold/env`, `bin/harold` writes tasks and CRM records directly, and boot and close can apply any queued write themselves. In the cloud there is no computer to keep `~/.harold/env` on. If the cloud tool can store secret environment variables for its sessions, the same two values can go there; otherwise `bin/harold`'s task and CRM writes are queued and applied through the connector, as `AGENTS.md` describes.

## Step 9: The CRM and the task list

Harold has its own CRM, and it is part of Harold, not an add-on: every person the operator deals with is filed there as well as in the vault, and `bin/harold close` checks that each contact touched was filed. The database from step 8 holds it, and the same database holds Harold's own task list.

1. **Bring in existing contacts.** Offer to import the operator's contacts from a CSV export: another CRM, Google Contacts, Apple Contacts or LinkedIn's connections export. If they want it:
   - Read the CSV and map its columns to Harold's contact fields: name, email, phone, organisation (`org`), title, type (`category`, one of their contact types) and labels (`categories`). Title has no column of its own unless their database added one (`HAROLD_CRM_EXTRA_FIELDS`), so put it in the notes.
   - Show the operator the mapping and three to five rows as they would be created, and ask which type to give contacts the file does not classify (usually `other`). Change the mapping if they ask.
   - Create each contact with the connector's `crm_upsert_contact`. Skip duplicates by email: before creating a contact, search for its email and leave an existing match untouched.
   - Report how many were created, how many were skipped as duplicates, and how many rows could not be read and why.

   The optional CRM web app (step 10) also has a CSV import screen, if the operator prefers to do it there.
2. **Harold's task list.** It lives in the same database, in a table called `tasks`; every task gets a ref such as `H-12`. It works with no outside tool connected.
   - **A database made just now** from `tools/harold-mcp/schema.sql` already has everything the task list needs. Nothing more to do.
   - **A database made before the task list existed** needs one more script. Tell the operator these steps in plain words:
     1. Open the Supabase project and choose **SQL Editor** in the left menu, then **New query**.
     2. Open the file `tools/harold-mcp/migrations/2026-11-18-task-list.sql` (you can paste its contents for them), copy all of it, and paste it into the editor.
     3. Press **Run**. Supabase may ask you to confirm a query that changes existing tables: confirm.
     4. "Done" looks like this: the result area says **Success. No rows returned**. Running it a second time is safe and changes nothing.
   - **Check it.** Create a test task with the connector's `task_create` (title "Test task", due tomorrow), see it in `task_list` with a ref such as `H-1`, then cancel it with `task_update` so it does not stay on the list. Where the Supabase values are in `~/.harold/env`, `bin/harold task create "Test task" --due <tomorrow, YYYY-MM-DD>`, `bin/harold task list` and `bin/harold task cancel H-1` do the same.
3. **Say what happens next:** from now on the CRM grows on its own. Each meeting debrief, conversation and new name Harold hears is filed there as part of normal work, so the operator never has to maintain it by hand.

## Step 10: The optional parts

Offer each in turn, with one sentence on what it gives. "Skip for now" is always a good answer; each can be set up at any time by asking for it.

- **The CRM web app** (`tools/harold-crm`): the CRM in a browser, with contacts, a pipeline, tasks and CSV import and export, on the same database. Steps: `tools/harold-crm/README.md`. Skip: the CRM works fully through the AI tool.
- **Two-way sync with the task tool the operator already uses.** Harold's task list (step 9) is already the task system and needs no outside tool. Ask whether the operator uses Linear, Todoist, Asana or Notion. If they do, they keep using it: the hosted connector syncs Harold's task list with it in both directions, and any mix of the four works at once. Steps: the sections "Optional: two-way sync with Linear", "... with Todoist", "... with Asana" and "... with Notion" below. Skip: tasks stay in Harold's task list only.
- **Scheduled jobs**: the morning brief written before the operator sits down, and the weekly, monthly and month-end housekeeping, run on GitHub Actions or any scheduler (README, "Scheduled jobs in the cloud"); turning one on means copying its file from `.github/workflows-optional/` into `.github/workflows/` and committing. Skip: the brief runs live when the operator says good morning, and housekeeping runs in sessions when it is due.
- **More AI tools.** Harold already works in every harness listed in `AGENTS.md`; some need a one-time step (trusting the hooks, or copying a snippet into the operator's own configuration). Ask which tools they use besides this one and do that step for each (for Cowork, the "Optional: Cowork" section below). Skip: the tool they are using now is enough.

### Optional: Cowork

For an operator who uses Cowork in the Claude desktop app, the Harold plugin boots Harold there and saves at the end of every turn. They need the desktop app, with Harold on their computer (step 1, the second way). Take these in order:

1. In Cowork, open **Customize**, then **Plugins**, choose **Add marketplace**, and enter their private repository as `owner/repo`. The repository is private, so the app must be signed in to GitHub with access to it; if it asks, say so.
2. Install **harold** from that marketplace.
3. Connect their Harold folder to a Cowork task (Cowork asks which folder to work in).
4. Start a new task and check that Harold boots: boot's output appears, or say "boot Harold". If it refuses, read what it says: the usual cause is that the folder is not connected.
5. Add the connector to Cowork too, if it is not there yet (step 8, item 8).

New versions of the plugin arrive through the marketplace when the operator chooses **Check for updates** (or turns on automatic sync) on the Plugins page. If the marketplace route is not available, zip the `tools/harold-plugin` folder and upload it from the Plugins page instead.

### Optional: two-way sync with Linear

Do this only if the operator uses Linear and wants the same tasks in both places. It needs the connector (step 8) and its Supabase settings. You do the typing; the operator clicks in Linear and Supabase when you ask. Keep the steps in this order. Say what each one is for, and wait for the operator to confirm before the next.

**Tell the operator first, in plain words:**
- Every task in the chosen Linear team is copied into Harold's task list, and every Harold task is copied into that team. A change on either side reaches the other within seconds. Changes to different fields on the two sides are both kept. If the same field changed on both sides, the later change wins and Harold logs the conflict (`bin/harold task conflicts` lists them).
- Linear's free plan has no private teams. Anyone in the Linear workspace can see the team's tasks. An operator who wants them private should use a Linear workspace of their own.

1. **Create a Linear personal API key.** In Linear: click the workspace name (top left), choose **Settings**, then **Account**, then **Security & access**, then **Personal API keys**, then **Create key**. Name it "Harold". Copy the key. It starts with `lin_api_`. It is a secret: it goes only into the places in step 3, never into a file in the repository or the chat.
2. **Find the team key.** In Linear: **Settings**, then **Teams**, then the team to sync. Its **Identifier** is the team key, for example `ENG` (tasks in that team look like `ENG-12`). Write it into `LINEAR_TEAM_KEY` in `harold/settings.env`.
3. **Generate a sync secret.** Run `openssl rand -hex 32` and keep the 64-character result. This is `SYNC_SECRET`: a password only the connector and the database share.
4. **Set three settings on the connector host.** In the connector's project settings (on Vercel: **Settings**, then **Environment Variables**), add `LINEAR_API_KEY`, `LINEAR_TEAM_KEY` and `SYNC_SECRET` with the values from steps 1 to 3. Add the same `LINEAR_API_KEY` to `~/.harold/env` on the operator's computer so `bin/harold-linear` and the first import can use it. `LINEAR_WEBHOOK_SECRET` comes in step 6.
5. **Redeploy the connector** so it reads the new settings. On Vercel: **Deployments**, the latest one, **Redeploy**. Then check that the routes exist: `curl -s -X POST <connector address>/sync/catchup` should answer with a JSON message (a 401 or 503 is fine here), not "Not found".
6. **Create the Linear webhook.** In Linear: **Settings**, then **API**, then **Webhooks**, then **New webhook**. Set the URL to `<connector address>/webhooks/linear`. Under data change events, tick **Issues** only. Under teams, choose the team from step 2. Save. Linear then shows a **signing secret**. Copy it, add it to the connector host as `LINEAR_WEBHOOK_SECRET`, and redeploy again (step 5).
7. **Let the connector read the project list.** Ask the operator's AI tool to call `harold_today` once through the connector. This makes the connector read `harold/projects.md`, which it needs to match Linear projects to Harold projects. Without it, every sync route answers 503. If a Linear project name differs from a Harold project name, add `linear_project: <exact Linear name>` to that project's entry in `harold/projects.md`.
8. **Run the sync script in Supabase.** In the Supabase **SQL Editor**:
   1. New query. Paste these two lines, replacing the placeholders with the connector address (no trailing slash) and the `SYNC_SECRET` from step 3, and press **Run**:
      ```sql
      select vault.create_secret('<connector address>', 'harold_connector_url');
      select vault.create_secret('<SYNC_SECRET>', 'harold_sync_secret');
      ```
   2. New query. Paste the whole of `tools/harold-connector/supabase/sync.sql` and press **Run**. If Supabase asks you to confirm a query with destructive operations, confirm: it only replaces Harold's own sync trigger and schedule.
   3. "Done" looks like this: the result area does not show **Success. No rows returned**. It shows one row with a job number instead (the last line schedules the 10-minute catch-up job). That is normal.
9. **Run the first import.** In a new query, run:
   ```sql
   select public.harold_sync_call('/sync/catchup', '{"import": true}'::jsonb, 55000);
   ```
   It returns a number straight away. The import then runs in the connector: every open task in the Linear team, plus those finished in the last 30 days, is copied into Harold's task list. Running it twice is safe. (From a terminal, `cd tools/harold-connector && npm run sync:import` does the same.)
10. **Check that it works.**
    - Run `bin/harold task list`. The Linear tasks appear, each with its Linear key (for example `ENG-12`) beside its `H-` ref.
    - Create a test task: `bin/harold task create "Sync test" --due <tomorrow>`. Within a few seconds it appears in the Linear team. Rename it in Linear and run `bin/harold task list` again: the new title appears. Then run `bin/harold task cancel <ref>` and check it shows as canceled in Linear.
    - If something is missing, run `select * from public.sync_log order by at desc limit 20;` in the SQL editor. Each failed or skipped step is logged there with the reason. `bin/harold task conflicts` lists changes that clashed.

### Optional: two-way sync with Todoist

Do this only if the operator uses Todoist and wants the same tasks in both places. It needs the connector (step 8) and its Supabase settings. You do the typing; the operator clicks in Todoist and Supabase when you ask. Keep the steps in this order. Say what each one is for, and wait for the operator to confirm before the next.

**Tell the operator first, in plain words:**
- Every open Todoist task is copied into Harold's task list, and every Harold task is copied into Todoist. A change in Harold reaches Todoist within seconds. A change in Todoist reaches Harold within seconds if you set up the webhook (step 5), otherwise within 10 minutes.
- Changes to different fields on the two sides are both kept. If the same field changed on both sides, the later change wins and Harold logs the conflict (`bin/harold task conflicts` lists them).
- Todoist has no "in progress" or "cancelled" state. Harold marks them with the labels `in-progress` and `cancelled` (a cancelled task is also completed). The operator's other labels are left alone.
- The sync never deletes anything in Todoist. A task deleted in Todoist cancels the open Harold task.
- The sync can cover every project, or one project only (step 2).

1. **Get a Todoist API token.** Todoist's developer documentation says the personal API token is in the account's integrations settings (`https://app.todoist.com/app/settings/integrations`). Copy it. It is a secret: it goes only into the places in step 3, never into a file in the repository or the chat. If you set up the webhook in step 5, you will replace it with your Todoist app's token.
2. **Choose the scope.** By default every project syncs. To keep the sync to one project, note its exact name: it becomes `TODOIST_PROJECT`. New Harold tasks then go into that project, and the sync never moves a task out of it.
3. **Set the settings on the connector host.** In the connector's project settings (on Vercel: **Settings**, then **Environment Variables**), add `TODOIST_API_TOKEN` and, if you chose one in step 2, `TODOIST_PROJECT`. Also add `SYNC_SECRET` if it is not there yet: run `openssl rand -hex 32` and keep the 64-character result (it is a password only the connector and the database share, and one value serves every sync tool). Nothing goes into the repository. Todoist needs nothing in `~/.harold/env`.
4. **Redeploy the connector** so it reads the new settings (as in the Linear section, step 5). Then check that the webhook route exists: `curl -s -X POST <connector address>/webhooks/todoist` should answer with a JSON message such as `401` or `503`, not "Not found".
5. **Set up the webhook (recommended).** Without it the 10-minute catch-up still carries every Todoist change to Harold. With it, changes arrive within seconds. Todoist's webhook documentation says:
   - Webhooks are configured on an app in Todoist's App Management Console (`https://app.todoist.com/app/settings/integrations/app-management`). Create an app there. It has a client id and a **client secret**.
   - Set the app's webhook callback URL to `<connector address>/webhooks/todoist`. Todoist accepts only `https` URLs with no port. Subscribe to these events: `item:added`, `item:updated`, `item:completed`, `item:uncompleted` and `item:deleted`.
   - The connector must use that app's token instead of the personal token from step 1: either the app's test token, shown in the console, or an OAuth token for the app. Replace `TODOIST_API_TOKEN` on the connector host with it. Once that is done, changes made from any Todoist client on the account (the web, the phone, another token) arrive within seconds. This was tested live with the test token; Todoist's documentation describes only the OAuth route.
   - Add the app's client secret to the connector host as `TODOIST_CLIENT_SECRET`, then redeploy again (step 4). The connector uses it to check the `X-Todoist-Hmac-SHA256` header of every delivery.

   Todoist's documentation does not name the console's screens or fields (where the callback URL and the event list are entered), so go through them with the operator as they appear rather than by name.
6. **Let the connector read the project list.** Ask the operator's AI tool to call `harold_today` once through the connector. This makes the connector read `harold/projects.md`, which it needs to match Todoist projects to Harold projects. Without it, every sync route answers 503. If a Todoist project name differs from a Harold project name, add `todoist_project: <exact Todoist name>` to that project's entry in `harold/projects.md`. A Harold task whose project Todoist lacks goes to the Inbox.
7. **Run the Supabase script, once.** If the Linear section's step 8 (or this step for another tool) is already done, skip this. Otherwise do that step now: it stores the connector address and `SYNC_SECRET` in Supabase and installs the trigger and the 10-minute schedule. It is the same for every sync tool.
8. **Run the first import.** In a new query in the Supabase **SQL Editor**, run:
   ```sql
   select public.harold_sync_call('/sync/catchup', '{"import": true, "provider": "todoist"}'::jsonb, 55000);
   ```
   It returns a number straight away. The import then runs in the connector: every open Todoist task, plus those finished in the last 30 days, is copied into Harold's task list. Running it twice is safe.
9. **Check that it works.**
   - Run `bin/harold task list`. The Todoist tasks appear, each with its Todoist key (`TD-` and an id) beside its `H-` ref.
   - Create a test task: `bin/harold task create "Sync test" --due <tomorrow>`. Within a few seconds it appears in Todoist. Rename it in Todoist and run `bin/harold task list` again: the new title appears (within seconds with the webhook, within 10 minutes without). Then run `bin/harold task cancel <ref>` and check it is completed in Todoist with the label `cancelled`.
   - If something is missing, run `select * from public.sync_log order by at desc limit 20;` in the SQL editor. Each failed or skipped step is logged there with the reason. `bin/harold task conflicts` lists changes that clashed.

### Optional: two-way sync with Asana

Do this only if the operator uses Asana and wants the same tasks in both places. It needs the connector (step 8) and its Supabase settings. You do the typing; the operator clicks in Asana and Supabase when you ask. Keep the steps in this order. Say what each one is for, and wait for the operator to confirm before the next.

**Tell the operator first, in plain words:**
- Tasks in the chosen Asana workspace are copied into Harold's task list, and every Harold task is copied into Asana. A change in Harold reaches Asana within seconds. A change in Asana reaches Harold within seconds if you set up the webhooks (step 6), otherwise within 10 minutes.
- Changes to different fields on the two sides are both kept. If the same field changed on both sides, the later change wins and Harold logs the conflict (`bin/harold task conflicts` lists them).
- Asana has no priority on a task, so priority is not synced at all. Harold's priority is never sent to Asana and never changed by it.
- Asana has no "in progress" or "cancelled" state. Harold marks them with the tags `in-progress` and `cancelled` (a cancelled task is also completed). The tags are created in the workspace the first time they are needed. The operator's other tags are left alone.
- The sync never deletes anything in Asana. A task deleted in Asana is seen only through the webhook, which cancels the open Harold task.
- Subtasks are not synced.

1. **Create an Asana personal access token.** Asana's developer documentation sends you to the developer console (`https://app.asana.com/0/my-apps`) to create a personal access token, and says each token needs a description. Name it "Harold". Copy the token. It is a secret: it goes only into the places in step 3, never into a file in the repository or the chat.
2. **Find the workspace and choose the scope.** Note the workspace's name or its gid (Asana's id for it): it becomes `ASANA_WORKSPACE`. By default every project of the workspace syncs, which costs one request per project every 10 minutes. For a large workspace, or to keep the sync to one project, note that project's name or gid: it becomes `ASANA_PROJECT`. New Harold tasks then go into that project, and the sync never moves a task out of it.
3. **Set the settings on the connector host.** In the connector's project settings (on Vercel: **Settings**, then **Environment Variables**), add `ASANA_ACCESS_TOKEN` and `ASANA_WORKSPACE`, plus `ASANA_PROJECT` if you chose one. Also add `SYNC_SECRET` if it is not there yet: run `openssl rand -hex 32` and keep the 64-character result (one value serves every sync tool). Nothing goes into the repository. Asana needs nothing in `~/.harold/env`.
4. **Redeploy the connector** so it reads the new settings (as in the Linear section, step 5). Then check that the webhook route exists: `curl -s -X POST <connector address>/webhooks/asana` should answer with a JSON message such as `401` or `503`, not "Not found".
5. **Let the connector read the project list.** Ask the operator's AI tool to call `harold_today` once through the connector. This makes the connector read `harold/projects.md`, which it needs to match Asana projects to Harold projects. Without it, every sync route answers 503. If an Asana project name differs from a Harold project name, add `asana_project: <exact Asana name>` to that project's entry in `harold/projects.md`.
6. **Create the webhooks (recommended).** Without them the 10-minute catch-up still carries every Asana change to Harold, except a deletion. Asana sends task events only to a webhook on a project, so there is one webhook per project. The script `scripts/asana-webhook.ts` creates them. The connector must already be deployed with the settings above, because Asana calls it during the request to complete its handshake. In a terminal, in the workspace:
   ```bash
   cd tools/harold-connector
   read -rs ASANA_ACCESS_TOKEN && export ASANA_ACCESS_TOKEN   # paste the token, press Enter
   read -rs SYNC_SECRET && export SYNC_SECRET                 # the same value as on the connector host
   export ASANA_WORKSPACE="<the value from the connector host>"
   npm install            # first time only
   npm run sync:asana-webhook -- <connector address>
   ```
   The values stay in that terminal only. The script prints one line per project: `created`, `exists` or `failed`. The webhook address it registers carries a token derived from `SYNC_SECRET`, and the connector refuses any delivery without it. Each webhook gets its own secret from Asana during the handshake, and the connector stores it. Run the script again after adding projects (it skips a project that already has a webhook), and again if Asana removes a webhook that has not answered for 24 hours.
7. **Run the Supabase script, once.** If the Linear section's step 8 (or this step for another tool) is already done, skip this. Otherwise do that step now.
8. **Run the first import.** In a new query in the Supabase **SQL Editor**, run:
   ```sql
   select public.harold_sync_call('/sync/catchup', '{"import": true, "provider": "asana"}'::jsonb, 55000);
   ```
   It returns a number straight away. The import then runs in the connector: every open task, plus those finished in the last 30 days, is copied into Harold's task list. Running it twice is safe.
9. **Check that it works.**
   - Run `bin/harold task list`. The Asana tasks appear, each with its Asana key (`AS-` and an id) beside its `H-` ref.
   - Create a test task: `bin/harold task create "Sync test" --due <tomorrow>`. Within a few seconds it appears in Asana. Rename it in Asana and run `bin/harold task list` again: the new title appears (within seconds with the webhooks, within 10 minutes without). Then run `bin/harold task cancel <ref>` and check it is completed in Asana with the tag `cancelled`.
   - If something is missing, run `select * from public.sync_log order by at desc limit 20;` in the SQL editor. Each failed or skipped step is logged there with the reason. `bin/harold task conflicts` lists changes that clashed.

### Optional: two-way sync with Notion

Do this only if the operator uses Notion and wants the same tasks in both places. It needs the connector (step 8) and its Supabase settings. You do the typing; the operator clicks in Notion and Supabase when you ask. Keep the steps in this order. Say what each one is for, and wait for the operator to confirm before the next.

**Tell the operator first, in plain words:**
- The tasks live in one Notion database, which the operator chooses. Its pages are copied into Harold's task list, and every Harold task becomes a page in that database. A change in Harold reaches Notion within seconds. A change in Notion reaches Harold within seconds if you set up the webhook (step 7), otherwise within 10 minutes.
- Changes to different fields on the two sides are both kept. If the same field changed on both sides, the later change wins and Harold logs the conflict (`bin/harold task conflicts` lists them).
- Notion databases are free-form, so Harold asks which property holds each field (title, status, due date, priority, notes, project) and which option means to do, in progress, done and cancelled. You propose a mapping in plain words, and nothing is saved until the operator says yes.
- Without the webhook, a page moved to Notion's trash is not noticed by the catch-up. Only the webhook cancels the Harold task.
- The sync never deletes a page.

1. **Create an internal integration.** Notion's documentation says to open the developer portal (`https://app.notion.com/developers/connections`; you must be a workspace owner), click **New integration**, choose the workspace, and adjust the settings under the **Configuration** tab. Notion's developer portal calls this a connection. The secret (the API token) is on the **Configuration** tab, masked until you click **Show**. Copy it. It is a secret: it goes only into the place in step 3, never into a file in the repository or the chat. The integration needs to read, update and insert content. Notion's documentation does not say where those capabilities are set, so check them with the operator on the integration's settings screen.
2. **Share the task database with the integration.** Notion's documentation describes this for a page: open it, click the **•••** menu at the top right, scroll to **Add connections**, search for the integration and select it. Do the same for the task database, and confirm with the operator that the database now lists the integration (the documentation does not describe the database case separately).
3. **Set the settings on the connector host.** In the connector's project settings (on Vercel: **Settings**, then **Environment Variables**), add `NOTION_TOKEN` (the secret from step 1). Also add `SYNC_SECRET` if it is not there yet: run `openssl rand -hex 32` and keep the 64-character result (one value serves every sync tool). Nothing goes into the repository. Notion needs nothing in `~/.harold/env`. The choice of database and the field mapping are saved by a tool in step 5, not by a setting.
4. **Redeploy the connector** so it reads the new settings (as in the Linear section, step 5). Then check that the webhook route exists: `curl -s -X POST <connector address>/webhooks/notion` should answer with a JSON message, not "Not found".
5. **Set up the field mapping.** Ask the operator's AI tool to call the connector's `sync_setup_notion` tool. Only the owner runs it. Until it has saved a setup, the connector skips Notion and the other tools run as usual.
   1. With no arguments it lists the databases shared with the integration. Name the task database (by name, id or URL).
   2. It proposes, in plain words, which property holds each field and which option means each status and priority, and it checks every choice against the database's real properties. Read the proposal to the operator.
   3. If the operator wants a different choice, call it again with the change (`fields`, `status_map` or `priority_map`). When the operator says yes, call it again with `confirm: true` and the same choices. That saves the setup.
   Nothing is written to Notion by this tool. Running it again later changes the mapping without a redeploy. Run it again after adding options to a status or select property.
6. **Let the connector read the project list.** Ask the operator's AI tool to call `harold_today` once through the connector. This makes the connector read `harold/projects.md`, which it needs to match Notion project values to Harold projects. Without it, every sync route answers 503. If a Notion value differs from a Harold project name, add `notion_project: <exact Notion value>` to that project's entry in `harold/projects.md`.
7. **Set up the webhook (recommended).** Notion's first request carries the token that signs every later event, so the connector cannot check it yet. It therefore accepts that request only during a 30-minute window that the owner opens. In order:
   1. Ask the operator's AI tool to call `sync_setup_notion` with `webhook: "expect"`. The 30 minutes start now.
   2. In Notion's developer portal, open the integration, go to its **Webhooks** tab and click **+ Create a subscription**. Enter the webhook URL `<connector address>/webhooks/notion`, choose the page events, and click **Create subscription**. Notion's documentation lists the events by group; the connector acts on `page.created`, `page.properties_updated`, `page.content_updated`, `page.undeleted`, `page.moved` and `page.deleted`.
   3. Notion then sends the connector a one-time verification token. Ask the operator's AI tool to call `sync_setup_notion` with `webhook: "reveal_token"`. It shows the token. Show it to the operator only, and never write it into a file in the repository.
   4. In Notion, on the **Webhooks** tab, click **Verify**, paste the token, and click **Verify subscription**. If no token arrived, Notion's verification form has a **Resend token** button.
   The token signs every later event. The connector keeps it in its database. Setting `NOTION_WEBHOOK_SECRET` on the connector host to the same value is optional.
8. **Run the Supabase script, once.** If the Linear section's step 8 (or this step for another tool) is already done, skip this. Otherwise do that step now.
9. **Run the first import.** In a new query in the Supabase **SQL Editor**, run:
   ```sql
   select public.harold_sync_call('/sync/catchup', '{"import": true, "provider": "notion"}'::jsonb, 55000);
   ```
   It returns a number straight away. The import then runs in the connector: every open page, plus finished pages edited in the last 30 days, is copied into Harold's task list. Running it twice is safe.
10. **Check that it works.**
    - Run `bin/harold task list`. The Notion pages appear, each with its Notion key (`NO-` and eight characters) beside its `H-` ref.
    - Create a test task: `bin/harold task create "Sync test" --due <tomorrow>`. Within a few seconds it appears in the Notion database. Rename it in Notion and run `bin/harold task list` again: the new title appears (within seconds with the webhook, within 10 minutes without). Then run `bin/harold task cancel <ref>` and check the page's status in Notion.
    - If something is missing, run `select * from public.sync_log order by at desc limit 20;` in the SQL editor. `bin/harold task conflicts` lists changes that clashed.

## Step 11: Check, boot and close

1. Run `bin/harold check`. It should print `RESULT: PASS` with no warnings about the time zone or `origin`.
2. Run `bin/harold boot` (or start a fresh session, where hooks run it). The `⚠ NOT SET UP YET` notice must be gone. If it is still there, it names what is left: go back to that step.
3. Write today's daily note in `vault/daily/` saying Harold was set up, where it lives (the cloud or the operator's computer), the projects added and the optional parts chosen or skipped.
4. Run `bin/harold close`. It commits everything and pushes to the operator's private repository, and must end with a line saying the commits were pushed. If it says NOT PUSHED, read the reason and fix it (usually `origin` or the git credentials), then close again.
5. Tell the operator, in two or three sentences, that Harold is ready, what to say tomorrow morning ("good morning"), and that every turn is saved and pushed to their private repository.
6. **If they chose the cloud,** tell them how to open Harold from now on: in their cloud tool, start a new session on their private repository (name it), on its main branch, and say "good morning" there. If setup ran in a temporary copy on their computer, that copy is no longer needed once close has pushed: offer to delete it, and delete it only if they say yes.

---

## Completion checklist

- [ ] The operator chose where Harold lives (the cloud or their computer), after hearing what each means
- [ ] `origin` is the operator's own private repository; never the public starter
- [ ] Git name and email set; `AGENTS.md` names the account, the repository and the live projects
- [ ] `HAROLD_TZ` set in `harold/settings.env`; other settings confirmed or left at their defaults
- [ ] No bracketed `YOUR` placeholders left outside `vault/templates/`; the last line of `AGENTS.md` deleted
- [ ] Contact types confirmed in `dashboard/people.md`
- [ ] One to three projects in `harold/projects.md`, each with a folder, a card and a next step
- [ ] The connector deployed on the operator's own account, its GitHub OAuth app and settings in place, checked with `curl`, and added to the operator's AI tools
- [ ] CRM database created and checked through the connector; existing contacts imported if the operator wanted that
- [ ] Harold's task list works (a test task created and canceled)
- [ ] Each optional part set up or explicitly skipped
- [ ] `bin/harold check` passes, boot shows no setup notice, a daily note exists, and close pushed to the private repository
- [ ] For the cloud: the operator knows how to open Harold in their cloud tool; a temporary copy on their computer was deleted only if they agreed
