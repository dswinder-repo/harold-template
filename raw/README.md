# raw/ — the inbox

Unprocessed sources land here before they become knowledge: articles, PDFs, research dumps, email exports, transcripts, screenshots. Save first, process second, so the ground truth is always there to re-read.

**Naming:** `raw/<subfolder>/YYYY-MM-DD-<descriptive-slug>.<ext>` (e.g. `raw/articles/2026-09-26-acme-q3-results.md`).

**Processing:** `playbook/core/compile.md` turns raw items into vault notes (`vault/intel/`, `vault/people/`, `vault/companies/`, ...). When an item is processed, it gets frontmatter:

```yaml
---
compiled: true
compiled_date: 2026-09-26
compiled_to: [vault/intel/acme-q3-results.md]
---
```

(PDFs and images, which cannot carry frontmatter, get a sidecar `.md` with the same fields.)

**Boot only flags, never compiles.** `bin/harold boot` lists anything here without `compiled: true`. You decide when to compile ("compile", "process the inbox"). This README is ignored by that check.
