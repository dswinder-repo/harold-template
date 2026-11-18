# Playbook: Setup

**Purpose:** Walk a new operator through making their own private copy of Harold and setting it up, in conversation, from the first clone to a clean first close.

**Trigger:** "set up Harold", "install Harold", "help me get started with Harold", a first run in a fresh copy of the starter, or boot opening with `⚠ NOT SET UP YET`. Also when the operator points their AI tool at harold.works or the starter repository and asks for Harold.

---

## How to run this playbook

- **You do the work; the operator answers questions.** Ask for each detail in conversation, then write it into the files yourself. Never ask the operator to open or edit a file, and never guess a detail they have not given you. If an answer is unclear, ask again.
- **One step at a time, in order.** Say what the step is for in one sentence, ask what you need, do it, confirm it in one line, and move on. Steps 1 to 8 are required, the CRM included. Step 9 offers the optional parts, each with a plain "skip for now" path, and step 10 checks the result.
- **Say this early, in plain words:** Harold saves the operator's work by committing it with git and pushing it to their own private repository at the end of every turn. That repository will hold their working life (people, meetings, decisions), so it must be private, and it must be theirs.
- **If the operator stops partway,** the next session picks up where this one left off: boot names what is still missing in its `⚠ NOT SET UP YET` notice, and this playbook resumes at the first unfinished step.
- **Read the documentation as plain text** when you need more detail than this playbook gives: `https://harold.works/llms-full.txt` holds the full docs.

> **Visualizer, first action:** if boot has run, update `harold/active-sessions/{session}.json`: set `ops` to `"working"`, task = "Setting up Harold", progress = 0.

---

## Step 1: A private repository of the operator's own

Harold must never push to the public starter, and `bin/harold close` refuses to: while `origin` still points at it, close commits locally and stops with "NOT PUSHED: origin is the public Harold starter".

Ask whether the operator has a GitHub account (or another git host) and whether they have already made their own copy. Then take one of two paths:

- **From the template (simplest).** On the starter's GitHub page, the operator chooses **Use this template → Create a new repository**, sets it to **Private**, and gives you the new repository's URL. Clone it into the folder they want Harold to live in (`git clone <their URL> <folder>`), then work from that folder.
- **From a clone you already have.** Ask the operator to create an empty **private** repository (no README, no licence) and give you its URL. Then re-point `origin` and push:
  ```bash
  git remote set-url origin <their private repository URL>
  git push -u origin HEAD
  ```

Check it with `git remote get-url origin`: it must be the operator's repository. If the operator has no GitHub account yet, help them create one first; Harold needs somewhere private to save to. Suggest a folder outside iCloud, Dropbox or other synced folders, which can evict files.

## Step 2: Git identity

Git records who saved each change. Run `git config user.name` and `git config user.email`. If either is empty, ask the operator which name and email to use and set them for this repository:

```bash
git config user.name "<their name>"
git config user.email "<their email>"
```

Write the same name, email and GitHub account into the **Git & GitHub Workflow** section of `AGENTS.md`, and the repository (`<account>/<repository>`) into its opening paragraph. Ask which of their repositories, if any, are live projects that must use branches and pull requests, and list them there; with none, write "none yet".

## Step 3: Check the workspace

Run `bin/harold check`. It only reads, and it should end with `RESULT: PASS`. Warnings about the time zone or placeholders are expected at this point; this playbook clears them. If it fails, read the failure to the operator in plain words and fix it before going on.

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

## Step 8: The CRM

The CRM is part of Harold, not an add-on: every person the operator deals with is filed there as well as in the vault, and `bin/harold close` checks that each contact touched was filed. It is a Supabase database in the operator's own account, which the free plan covers.

1. **The database.** The operator creates a Supabase project at supabase.com. In its SQL editor, they run the contents of `tools/harold-mcp/schema.sql` (you can show them the file or paste it for them).
2. **The tools that reach it.** Choose one with the operator:
   - **The hosted connector** (`tools/harold-connector`), the standard way: one small deployment that gives every AI tool with remote MCP support, including chat apps on a phone, the CRM and knowledge-base tools. Walk them through `tools/harold-connector/README.md`: a deployment (Vercel or any Node 22+ host), a GitHub OAuth app, the environment variables (with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the CRM), then adding `<deployment>/mcp` to their AI tool.
   - **harold-mcp**, the local alternative: nothing to deploy, and it works on this computer only. Run `bin/harold-setup-crm` (it stores the Supabase URL and service-role key in `~/.harold/env` and tests the connection), then `(cd tools/harold-mcp && npm install)`, and add `bin/harold-mcp` to the AI tool's MCP servers by its absolute path (`.mcp.example.json` shows the shape).

   The service-role key is a secret: it goes into `~/.harold/env` or the connector host's environment, never into the repository or the chat history if the tool offers a safer way to enter it.
3. **Check it.** Search the CRM for any name with `crm_search_contacts` (connector) or `harold_search_contacts` (harold-mcp). An empty result with no error means it works.
4. **Bring in existing contacts.** Offer to import the operator's contacts from a CSV export: another CRM, Google Contacts, Apple Contacts or LinkedIn's connections export. If they want it:
   - Read the CSV and map its columns to Harold's contact fields: name, email, phone, organisation (`org`), title, type (`category`, one of their contact types) and labels (`categories`). Title has no column of its own unless their database added one (`HAROLD_CRM_EXTRA_FIELDS`), so put it in the notes.
   - Show the operator the mapping and three to five rows as they would be created, and ask which type to give contacts the file does not classify (usually `other`). Change the mapping if they ask.
   - Create each contact with `crm_upsert_contact` (connector) or `harold_upsert_contact` (harold-mcp). Skip duplicates by email: before creating a contact, search for its email and leave an existing match untouched.
   - Report how many were created, how many were skipped as duplicates, and how many rows could not be read and why.

   The optional CRM web app (step 9) also has a CSV import screen, if the operator prefers to do it there.
5. **Harold's task list.** Tasks live in the same database, in a table called `tasks`. They work with no outside tool connected.
   - **A database made just now** from `tools/harold-mcp/schema.sql` already has everything the task list needs. Nothing more to do.
   - **A database made before the task list existed** needs one more script. Tell the operator these steps in plain words:
     1. Open the Supabase project and choose **SQL Editor** in the left menu, then **New query**.
     2. Open the file `tools/harold-mcp/migrations/2026-11-18-task-list.sql` (you can paste its contents for them), copy all of it, and paste it into the editor.
     3. Press **Run**. Supabase may ask you to confirm a query that changes existing tables: confirm.
     4. "Done" looks like this: the result area says **Success. No rows returned**. Running it a second time is safe and changes nothing.
   - **Check it.** Run `bin/harold task create "Test task" --due <tomorrow, YYYY-MM-DD>`, then `bin/harold task list`. The new task appears with a ref such as `H-1`. Then run `bin/harold task cancel H-1` so the test task does not stay on the list.
6. **Say what happens next:** from now on the CRM grows on its own. Each meeting debrief, conversation and new name Harold hears is filed there as part of normal work, so the operator never has to maintain it by hand.

## Step 9: The optional parts

Offer each in turn, with one sentence on what it gives. "Skip for now" is always a good answer; each can be set up at any time by asking for it.

- **The CRM web app** (`tools/harold-crm`): the CRM in a browser, with contacts, a pipeline, tasks and CSV import and export, on the same database. Steps: `tools/harold-crm/README.md`. Skip: the CRM works fully through the AI tool.
- **Two-way sync with Linear.** Harold's task list (step 8, item 5) is already the task system and needs no outside tool. For an operator who also uses Linear, the connector can keep the task list and one Linear team in step, in both directions. Steps: the section "Optional: two-way sync with Linear" below. Skip: tasks stay in Harold's task list only.
- **The hosted connector**, if step 8 used harold-mcp: it adds access from chat apps and other computers. Skip: sessions in the workspace folder do everything.
- **Scheduled jobs**: the morning brief written before the operator sits down, and the weekly, monthly and month-end housekeeping, run on GitHub Actions or any scheduler (README, "Scheduled jobs in the cloud"). Skip: the brief runs live when the operator says good morning, and housekeeping runs in sessions when it is due.
- **More AI tools.** Harold already works in every harness listed in `AGENTS.md`; some need a one-time step (trusting the hooks, or copying a snippet into the user's own configuration). Ask which tools they use besides this one and do that step for each. Skip: the tool they are using now is enough.

### Optional: two-way sync with Linear

Do this only if the operator uses Linear and wants the same tasks in both places. It needs the hosted connector (step 8, item 2) and its Supabase settings. You do the typing; the operator clicks in Linear and Supabase when you ask. Keep the steps in this order. Say what each one is for, and wait for the operator to confirm before the next.

**Tell the operator first, in plain words:**
- Every task in the chosen Linear team is copied into Harold's task list, and every Harold task is copied into that team. A change on either side reaches the other within seconds. If the same field changes on both sides at once, the later change wins and Harold keeps a note of the conflict.
- Linear's free plan has no private teams. Anyone in the Linear workspace can see the team's tasks. An operator who wants them private should use a Linear workspace of their own.

1. **Create a Linear personal API key.** In Linear: click the workspace name (top left), choose **Settings**, then **Security & access**, then **Personal API keys**, then **Create key**. Name it "Harold". Copy the key. It starts with `lin_api_`. It is a secret: it goes only into the places in step 3, never into a file in the repository or the chat.
2. **Find the team key.** In Linear: **Settings**, then **Teams**, then the team to sync. Its **Identifier** is the team key, for example `ENG` (tasks in that team look like `ENG-12`). Write it into `LINEAR_TEAM_KEY` in `harold/settings.env`.
3. **Generate a sync secret.** Run `openssl rand -hex 32` and keep the 64-character result. This is `SYNC_SECRET`: a password only the connector and the database share.
4. **Set the four settings on the connector host.** In the connector's project settings (on Vercel: **Settings**, then **Environment Variables**), add `LINEAR_API_KEY`, `LINEAR_TEAM_KEY` and `SYNC_SECRET` with the values from steps 1 to 3. Add the same `LINEAR_API_KEY` to `~/.harold/env` on the operator's computer so `bin/harold-linear` and the first import can use it. `LINEAR_WEBHOOK_SECRET` comes in step 6.
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
    - Create a test task: `bin/harold task create "Sync test" --due <tomorrow>`. Within a minute it appears in the Linear team. Rename it in Linear and run `bin/harold task list` again: the new title appears. Then run `bin/harold task cancel <ref>` and check it shows as canceled in Linear.
    - If something is missing, run `select * from public.sync_log order by at desc limit 20;` in the SQL editor. Each failed or skipped step is logged there with the reason. `bin/harold task conflicts` lists changes that clashed.

## Step 10: Check, boot and close

1. Run `bin/harold check`. It should print `RESULT: PASS` with no warnings about the time zone, placeholders or `origin`.
2. Run `bin/harold boot` (or start a fresh session, where hooks run it). The `⚠ NOT SET UP YET` notice must be gone. If it is still there, it names what is left: go back to that step.
3. Write today's daily note in `vault/daily/` saying Harold was set up, with the projects added and the optional parts chosen or skipped.
4. Run `bin/harold close`. It commits everything and pushes to the operator's private repository, and must end with a line saying the commits were pushed. If it says NOT PUSHED, read the reason and fix it (usually `origin` or the git credentials), then close again.
5. Tell the operator, in two or three sentences, that Harold is ready, what to say tomorrow morning ("good morning"), and that every turn is saved and pushed to their private repository.

---

## Completion checklist

- [ ] `origin` is the operator's own private repository; never the public starter
- [ ] Git name and email set; `AGENTS.md` names the account, the repository and the live projects
- [ ] `HAROLD_TZ` set in `harold/settings.env`; other settings confirmed or left at their defaults
- [ ] No bracketed `YOUR` placeholders left outside `vault/templates/`; the last line of `AGENTS.md` deleted
- [ ] Contact types confirmed in `dashboard/people.md`
- [ ] One to three projects in `harold/projects.md`, each with a folder, a card and a next step
- [ ] CRM database created, reached through the connector or harold-mcp, and checked; existing contacts imported if the operator wanted that
- [ ] Harold's task list works (a test task created and canceled)
- [ ] Each optional part set up or explicitly skipped
- [ ] `bin/harold check` passes, boot shows no setup notice, a daily note exists, and close pushed to the private repository
