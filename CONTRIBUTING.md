# Contributing to Harold

Thank you for helping improve Harold. This page covers how to report a problem, how to ask for a new integration and how to propose a change.

## Before you start

- **Never paste your own workspace content.** Your Harold workspace holds your notes, contacts and settings. An issue or pull request is public. Describe the problem in general terms, and strip names, keys and anything private from logs.
- **Keep to Harold's machinery.** A contribution changes how Harold works for everyone: its structure, playbooks, boot and close, the connector, harold-mcp, the CRM web app or the harness wiring. Your own notes, settings and preferences stay in your workspace.
- **Harold works with any AI tool and any model.** A change must not favour or assume one harness or model. Name a tool only where it is wiring, listed alongside the others Harold supports.

## Report a problem

Open an issue with the **Bug report** form. Say what you ran, what you expected and what happened, and include the output of `bin/harold check`, with anything private removed.

## Ask for a new integration

Harold has its own task list and its own CRM, and syncs the task list both ways with Linear, Todoist, Asana and Notion. To ask for another task tool or CRM, open an issue with the **Integration request** form. Say which tool, what you need it to do, and whether it has an API with webhooks.

## Propose a change

1. Fork this repository and make the change on a branch of your fork. Never make it in your own workspace, which holds your private content.
2. Run the tests: `node --test tests/*.test.js` (and `python3 -m pytest tests/` for the search index).
3. Open a pull request against `main`. Say what the change does and why every Harold user needs it.

Nothing reaches `main` except through a reviewed pull request. Changes to the docs at harold.works are made separately; mention in your pull request if the docs would need to change too.

## Writing style

Harold's playbooks and instructions are read by AI agents and by people. Write plain, short sentences, use the same name for the same thing every time (a playbook is a "playbook", a lesson is a "lesson"), and edit a rule where it lives instead of appending a dated note.
