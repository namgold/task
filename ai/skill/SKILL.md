---
name: task
description: Use when working in this repository to create, inspect, update, search, validate, or manage task markdown files and saved views.
---

# Task Tool Skill

Use this when an AI assistant needs to work with this repository.

## What this tool is

`task` is a local-first, Git-native task tracker. Each task is a human-editable markdown file stored in the repository, usually under `.tasks/`, with YAML frontmatter plus a readable markdown body.

The markdown file is the source of truth. The CLI is a helper for creation, listing, search, update, validation, and view management.

## Core rules

- Read `.taskrc.yml` to discover the configured fields and saved views.
- Treat task markdown files as the authoritative data store.
- Preserve the markdown body when updating frontmatter.
- Validate task files before finishing work if task metadata changed.
- Prefer small, targeted edits to task files over inventing new state.
- Keep task changes in git with the related code changes.

## When to use the CLI

Use the CLI for anything that should be reflected in the repository:

- create a task
- update task frontmatter
- inspect a task
- search tasks
- validate task files
- manage saved views in `.taskrc.yml`
- run a saved view by name (e.g. `task view my-view`)

## Read when needed

- [Task format reference](../references/task-format.md)
- [MCP contract](../mcp/SPEC.md)

