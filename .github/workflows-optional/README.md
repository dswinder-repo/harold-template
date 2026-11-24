# Optional workflows

GitHub runs only the files in `.github/workflows/`. The files here are scheduled jobs that are off until you choose them. They run only once you copy them into `.github/workflows/` and commit.

| File | What it does |
|---|---|
| `morning-brief.yml` | Writes Steps 1-2 of the morning brief to `harold/briefs/` before you sit down, on weekdays at your time in your zone. |
| `housekeeping.yml` | Runs the weekly scan, the monthly full audit and the month-end review silently, once `harold/housekeeping.json` says `"cloud": true`. |

To turn one on:

```bash
cp .github/workflows-optional/morning-brief.yml .github/workflows/
cp .github/workflows-optional/housekeeping.yml .github/workflows/
git add .github/workflows && git commit -m "Turn on scheduled jobs" && git push
```

Copy only the one you want. Then add the secrets and variables named at the top of each file (README, "Scheduled jobs in the cloud"). To turn one off, delete its copy from `.github/workflows/`.
