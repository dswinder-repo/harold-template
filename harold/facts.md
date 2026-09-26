# Harold Facts Repository

*Discrete, queryable facts: who is who, what the numbers are, who promised what. The single place Harold checks before stating a name, a title or a figure. `playbook/core/pre-flight-verification.md` and `playbook/core/document-qc.md` verify output against this file.*

---

## How This Works

- One fact per table row. Each row carries its source and the date it was last verified.
- When a fact changes, update the row (do not add a second one) and cascade it per `harold/sync-map.md`.
- The `harold_fact` MCP tool upserts rows by section and key, and refreshes the footer date.
- Relationship state (warmth, pipeline stage, last contact) lives in the CRM, not here. This file holds the facts you would be embarrassed to get wrong.

---

## People — Key Contacts

| Person | Role | Organization | Source | Last Verified |
|--------|------|--------------|--------|---------------|
| Jane Doe (example) | VP Partnerships | Acme Corp | Intro call, starter example | 2026-09-26 |

## Companies — Partners & Prospects

| Company | Type | What They Do | Source | Last Verified |
|---------|------|--------------|--------|---------------|
| Acme Corp (example) | partner | Fictional example company | Starter example | 2026-09-26 |

## Numbers — Key Metrics & Figures

| Metric | Value | As Of | Source | Last Verified |
|--------|-------|-------|--------|---------------|

## Commitments — Who Promised What

| Who | Committed To | Due | Given Where | Status |
|-----|--------------|-----|-------------|--------|

## Preferences — Communication & Working Style

| Preference | Details | Source | Last Verified |
|------------|---------|--------|---------------|
| [YOUR NAME]'s time zone | [YOUR TIMEZONE] | Setup | [DATE] |

## Constraints — Things That Can't or Won't Happen

| Constraint | Reason | Source | Last Verified |
|------------|--------|--------|---------------|

## Terminology — Correct Names & Spellings

| Correct | Common Mistakes | Notes |
|---------|-----------------|-------|
| Acme Corp (example) | ACME, Acme Corporation | Starter example row |

---

*Last updated: September 26, 2026 (starter template)*
