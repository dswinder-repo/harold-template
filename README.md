# Harold — Starter Template

> An AI chief of staff built on Claude Code. This template gives you the full Harold workspace structure so you can be up and running in under an hour.

**Full documentation:** [harold.works/docs](https://harold.works/docs)

---

## What's Included

```
harold-template/
├── .claude/
│   └── CLAUDE.md              # Session instructions — the operating system for Harold
├── .mcp.json                  # MCP server configuration (fill in your Supabase credentials)
├── memory/
│   ├── CLAUDE.md              # Working memory — priorities, blockers, key context
│   └── glossary.md            # Shorthand and terminology
├── dashboard/
│   ├── index.md               # Module router
│   ├── status.md              # Current state, projects, deadlines
│   ├── processes.md           # Operating rules and workflows
│   ├── people.md              # Key relationships and org structure
│   └── strategy.md            # Strategic context and goals
├── harold/
│   ├── active-sessions/       # Live session state (auto-managed, gitignored)
│   ├── alerts.md              # Urgency-ranked alerts
│   ├── blockers.md            # Active blockers and dependencies
│   └── facts.md               # Master fact store
├── playbook/                  # Executable workflow templates
│   └── (see harold.works/docs/core-systems/playbooks)
├── vault/
│   └── templates/             # Note templates for people, companies, meetings, intel, daily logs
└── tools/
    ├── harold-mcp/            # MCP server — atomic KB writes + CRM integration
    └── visualizer/            # Expedition HQ — live session dashboard
```

---

## Quick Start

### 1. Clone this repo into your workspace

```bash
git clone https://github.com/dswinder-repo/harold-template.git my-harold
cd my-harold
```

### 2. Set up Supabase (for CRM)

1. Create a free project at [supabase.com](https://supabase.com)
2. Run the schema SQL from `tools/harold-mcp/schema.sql` in the Supabase SQL editor
3. Copy your project URL and service role key

### 3. Configure MCP

Edit `.mcp.json` and replace the placeholder values:

```json
{
  "mcpServers": {
    "harold-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["tools/harold-mcp/server.js"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key"
      }
    }
  }
}
```

### 4. Install harold-mcp dependencies

```bash
cd tools/harold-mcp
npm install
cd ../..
```

### 5. Customize your workspace

Fill in the placeholder content in these files:
- `.claude/CLAUDE.md` — add your name and standing rules
- `memory/CLAUDE.md` — add your current priorities and context
- `dashboard/status.md` — add your active projects
- `dashboard/strategy.md` — add your strategic context
- `harold/facts.md` — add your key data points

### 6. Open in Claude Code

```bash
claude
```

Harold will introduce himself, run the startup sequence, and ask how to help.

---

## Running the Visualizer

```bash
node tools/visualizer/serve.js
# Open http://localhost:3210
```

---

## Optional: Connect Obsidian

Point your Obsidian vault at the `vault/` directory in this workspace. The templates in `vault/templates/` will be available as note templates. For the full experience, install the Obsidian MCP server and register it in `.mcp.json`.

---

## Learn More

- **Full docs:** [harold.works/docs](https://harold.works/docs)
- **Playbook library:** [harold.works/docs](https://harold.works/docs) → Playbooks section
- **Expedition HQ (Visualizer):** [harold.works/docs](https://harold.works/docs) → Advanced → Expedition HQ
