# Playbook: Ship to GitHub

**Purpose:** Commit, push and (for live projects) open a PR at the end of every coding session, without leaking secrets.
**Trigger:** End of any coding session; "push this", "ship it", "commit and push"; starting a new project that needs a repo.

Run this at the end of every coding session. It takes two minutes and makes the work visible. It applies to your project repos; the workspace repo itself is committed and pushed by `bin/harold close`.

Resolve the project folder with `bin/harold where <project>`; never hard-code a path. If `where` returns nothing, ask the operator which folder, then add it to `harold/projects.md`.

---

## 0. Pre-flight: Check what you are about to commit

```bash
git status
git diff --stat
```

**Before staging anything:**
- **Scan for secrets:** `.env` files, credentials, API keys, tokens, private keys. If found, add them to `.gitignore` first. Credentials belong in `~/.harold/env` (or the project's own ignored env file), never in a repo.
- A quick check on what is staged:
  ```bash
  git diff --cached | grep -inE "api[_-]?key|secret|token|password|BEGIN .*PRIVATE KEY" || echo "no obvious secrets"
  ```
  Any hit: unstage it, move the value out of the file, and stop to tell the operator.
- **Check for generated files:** `dist/`, `build/`, `.next/`, `node_modules/`. These belong in `.gitignore`, not in a commit.
- **Never `git add .` blindly.** Stage specific files (`git add <file> <file>`) or review hunk by hunk with `git add -p`.

---

## 1. Commit with a meaningful message

**One logical change per commit.** Do not bundle unrelated changes.

```bash
git add src/components/NewFeature.tsx src/utils/helper.ts
git commit -m "$(cat <<'EOF'
feat: add contact merge UI with duplicate detection

Co-Authored-By: [AI CO-AUTHOR TRAILER]
EOF
)"
```

`[AI CO-AUTHOR TRAILER]` is whatever attribution line your AI tool asks for (name and noreply address). Set it once in `AGENTS.md` and use it on every commit.

**Commit message rules:**
- Conventional prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `style:`, `chore:`, `test:`
- First line: what was done, imperative mood, under 72 characters
- If needed, a blank line and a body explaining WHY
- Always include the Co-Authored-By trailer

**Bad examples:**
- `update files` — says nothing
- `feat: visual polish batch 3 + bug reporter + button UX` — three unrelated things
- `fix stuff` — useless

**Good examples:**
- `feat: add bulk enrichment for contact records`
- `fix: chart crash when data array is empty`
- `refactor: extract filing logic into a reusable helper`

---

## 2. Use branches for live projects

**Any project that serves a live website or API** ([LIVE PROJECT 1], [LIVE PROJECT 2], ...; note which projects are live in `harold/projects.md`) goes through a branch and a PR:

```bash
# Create a feature branch
git checkout -b feat/descriptive-name

# Do the work, commit as you go
git add <files>
git commit -m "feat: description"

# Push the branch
git push -u origin feat/descriptive-name

# Open a PR
gh pr create --title "feat: description" --body "## Summary
- What changed and why

## Test plan
- [ ] Verified locally
- [ ] Checked on mobile"
```

**When to merge:**
- The operator reviews and approves (can be done from a phone)
- The preview deploy looks good (see `playbook/core/preview-deploys.md`)
- Then: `gh pr merge --merge`, or merge in the GitHub UI

Merging is the operator's call. Do not merge a live project's PR without their explicit yes.

**When branches are NOT needed:**
- Personal experiments, prototypes, one-off scripts
- Initial project setup (the first few commits can go to `main`)

---

## 3. Push to GitHub

```bash
git push
```

If the branch has no upstream yet:
```bash
git push -u origin <branch>
```

**Never end a session with unpushed commits.** Check with:
```bash
git log --oneline @{u}..HEAD 2>/dev/null
```
Empty output means everything is pushed. If the push fails (auth, network, rejected), say so plainly in the session summary and in today's daily note; do not report the work as shipped.

---

## 4. If it is a new project (no GitHub repo yet)

```bash
cd <project-dir>          # from: bin/harold where <project>
git init && git branch -m main

# Create .gitignore FIRST
cat > .gitignore << 'GITIGNORE'
.DS_Store
.env
.env.*
.venv/
node_modules/
dist/
build/
__pycache__/
*.pyc
*.pyo
.next/
.vercel/
GITIGNORE

git status                # review: nothing secret, nothing generated
git add <files>           # stage deliberately
git commit -m "$(cat <<'EOF'
feat: initial build — <description>

Co-Authored-By: [AI CO-AUTHOR TRAILER]
EOF
)"

gh repo create [YOUR GITHUB USER]/<project-name> \
  --private \
  --description "<one line>" \
  --source=. \
  --remote=origin \
  --push
```

Default to `--private`. Make a repo public only when the operator says so. Then register the new project in `harold/projects.md` so `bin/harold where` can find it.

---

## 5. Verify deployment (if applicable)

After pushing to a branch that auto-deploys:

```bash
# Give the deploy time to finish
sleep 20

# Check HTTP status
curl -s -o /dev/null -w "%{http_code}" https://<your-deploy-url>

# Or open it in a browser tool and look at it
```

**Never report "deployed and live" without verifying.** Check the actual URL. Full procedure: `playbook/core/preview-deploys.md`.

---

## 6. Tag releases at milestones

When a project reaches a meaningful state:

```bash
git tag -a v1.0.0 -m "v1.0.0: <what this release contains>"
git push origin v1.0.0
```

Or create a GitHub release with notes:
```bash
gh release create v1.0.0 --title "v1.0.0" --notes "## What's included
- <feature>
- <feature>"
```

This creates a snapshot to roll back to if a future deploy breaks things.

---

## 7. Log it

Record what shipped in today's daily note: `bin/harold file daily <slug> "Shipped <project>: <commits/PR link>, deploy verified <yes/no>"`. If a task in the task manager (Linear by default) covers this work, update it too (`bin/harold-linear comment` / `done`, or the task manager's own tools).

---

## Common Gotchas

| Problem | Fix |
|---------|-----|
| Commits not showing on the contribution graph | The commit email must match a verified email on the GitHub account |
| "remote: Repository not found" | `gh auth status`, then `gh auth login` |
| Accidentally committed `.env` | `git rm --cached .env && echo ".env" >> .gitignore`, then **rotate the leaked secret**: it is in history |
| Working on the wrong branch | `git checkout -b <right-branch>` (uncommitted changes come with you) |
| PR merge conflicts | `git checkout main && git pull && git checkout feat/x && git merge main` |
| Need to undo the last commit | `git reset --soft HEAD~1` (keeps changes staged) |
| Deployed broken code | `git revert HEAD && git push` (a new commit that undoes it) |

---

## Completion checklist

- [ ] Project folder resolved with `bin/harold where <project>`
- [ ] `git status` reviewed; no secrets or generated files staged
- [ ] Files staged specifically (no blind `git add .`)
- [ ] One logical change per commit, conventional prefix, Co-Authored-By trailer
- [ ] Live projects: branch + PR, merged only with the operator's yes
- [ ] Pushed; `git log @{u}..HEAD` is empty
- [ ] Deploy verified with curl or a browser (if the project deploys)
- [ ] Release tagged if this was a milestone
- [ ] Shipped work recorded in today's `vault/daily/` note and the task manager
