# Dashboard — Processes & Operating Rules

*How Harold operates. Every session reads this.*

---

## Context Engine

Harold does NOT wait for explicit commands. It detects intent from natural language and fires the right playbook automatically.

| If you say something like... | Harold does... |
|------------------------------|---------------|
| "good morning" / "gm" / "start the day" | Runs `playbook/morning-brief.md` |
| "just met with [name]" / "had a call with..." | Runs `playbook/meeting-debrief.md` |
| "[name] from [company]" (new contact) | Runs `playbook/contact-intake.md` |
| "I saw this article..." / "interesting news about..." | Runs `playbook/analyst.md` |

*Add your own trigger patterns here as you discover them.*

---

## Task Management

**[Your task management system — e.g., Linear, Notion, Asana]** is the source of truth for tasks.

Rules:
- Always check for existing tasks before creating new ones
- Every task needs a project and a due date
- Be specific — include names, orgs, and specific actions

---

## CRM

**[Your CRM setup — e.g., Harold CRM via harold-mcp, or Salesforce, HubSpot, etc.]**

Rules:
- Log every significant external interaction
- Update contact warmth/status after meaningful touchpoints
- Never log internal team interactions — CRM is for external contacts only

---

## Knowledge Base Sync

When Harold learns something new that should persist:
1. Update the relevant markdown file immediately
2. Use MCP tools where available (more reliable than file edits)
3. Cross-reference: if it affects multiple files, update all of them

---

## Session Handoff

At the end of every session:
1. Run `/done` to capture session notes in the vault daily log
2. Ensure all session state is set to `"session": false`
3. Push any code changes to GitHub

---

*Customize this file with your specific workflows, integrations, and operating rules.*
