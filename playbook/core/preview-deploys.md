# Playbook: Preview Deploys

**Purpose:** Test every change on a preview link before it reaches production, and verify every deploy before calling it live.
**Trigger:** Any change to a project that deploys (website, app, API, serverless function); "deploy this", "ship to prod", "is it live?".

How to use preview deployments to test changes before they go live. Resolve the project folder with `bin/harold where <project>`. Which platform a project deploys to should be noted in its entry in `harold/projects.md`; if it is not, ask the operator and add it.

**The one rule:** never report a deploy as working without testing it. Check the actual URL with `curl` or a browser. A green build is not a working site.

---

## Vercel / Netlify (Git-connected hosts)

When the host is connected to the GitHub repo:

1. **Every PR automatically gets a preview URL.**
2. The host posts the preview link on the PR (as a comment or a check).
3. Test on desktop and mobile before merging.
4. Merging to `main` auto-deploys to production.

### Workflow
```bash
git checkout -b feat/new-feature
# ... make changes, commit (see playbook/core/ship-to-github.md) ...
git push -u origin feat/new-feature
gh pr create --title "feat: new feature" --body "..."
# The host builds a preview: get the link from the PR
# Test the preview URL (see Verification below)
# When satisfied and the operator approves: merge the PR
```

---

## GitHub Pages

GitHub Pages deploys from `main` (or a configured branch) directly. There are no native preview deploys. Instead:

### Option A: Local preview
```bash
# For simple HTML/CSS sites
npx serve .
# or
python3 -m http.server 8000
```
Then open `http://localhost:8000` (or the port printed) and check it.

### Option B: Branch + review
```bash
git checkout -b feat/update
# ... make changes ...
git push -u origin feat/update
gh pr create --title "feat: update"
# Review the diff on GitHub
# Merge when confident
```

For GitHub Pages the safety net is the branch workflow itself (review before merge) plus release tags (rollback if something breaks).

---

## Serverless / Edge Functions (e.g. Supabase Edge Functions)

Functions usually have no preview deploys. Instead:
1. Test locally (e.g. `npx supabase functions serve <name>`).
2. Deploy to a staging project if you have one.
3. Deploy to production (e.g. `npx supabase functions deploy <name> --project-ref <ref>`), then call the function and check the response.

Project refs and keys come from `~/.harold/env` or the project's own ignored env file, never from a committed file.

---

## Verification (every deploy, preview or production)

```bash
# HTTP status: expect 200 (or the redirect you intended)
curl -s -o /dev/null -w "%{http_code}\n" https://<deploy-url>

# Content check: the change you made is actually there
curl -s https://<deploy-url> | grep -i "<text you just changed>"
```

Then look at it in a browser tool (desktop and a mobile-width viewport) for anything visual.

**If verification fails or cannot be done** (URL unreachable, auth wall, no browser tool): report exactly that. Say "deployed, not verified" and why. Never say "live" or "working".

---

## Rollback

If a deploy breaks something:

**Vercel / Netlify:** revert the merge commit, or promote/redeploy a previous deployment from the host's dashboard.

**GitHub Pages:**
```bash
git revert HEAD
git push
```

**Any platform:** roll back to the last tagged release:
```bash
git checkout v1.0.0
# verify it works
git checkout -b fix/rollback
git push -u origin fix/rollback
gh pr create --title "fix: rollback to v1.0.0"
```

After a rollback, verify again with the steps above.

---

## Log it

Record every production deploy and its verification result in today's daily note: `bin/harold file daily <slug> "Deployed <project> to <env>: <url>, HTTP <code>, verified <yes/no>"`. A broken deploy that needed a rollback is also worth a lesson: `bin/harold file learning '{"severity":"warning","project":"<project>","category":"process","lesson":"..."}'`.

---

## Completion checklist

- [ ] Project and platform resolved (`bin/harold where <project>`, `harold/projects.md`)
- [ ] Change tested on a preview URL or local preview before production
- [ ] Production deploy happened only after the operator approved the merge
- [ ] Deploy verified with `curl` (status + content) and, for visual changes, a browser
- [ ] Anything unverified reported as "not verified", never as "live"
- [ ] Rollback path known (tag or previous deployment)
- [ ] Deploy and verification result recorded in today's `vault/daily/` note
