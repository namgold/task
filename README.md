# task

`task` is a local-first, Git-friendly CLI for managing work as markdown files inside the repository.

The markdown files are the source of truth. The CLI is only a helper for creating, listing, updating, validating, and searching tasks.

## Task file format

Tasks live under `.tasks/` by default. Each task is one markdown file with YAML frontmatter:

```md
---
id: TASK-0001
title: Example task
type: Demo Type
status: Demo Todo
priority: Demo Medium
assignee:
owner:
branch:
pr:
created_at: 2026-05-31
updated_at: 2026-05-31
description:
summary: Short task summary.
---

# Problem

...
```

The body should stay human-readable and editable. The CLI preserves the markdown body when updating frontmatter.

## `.taskrc.yml`

Repository-level configuration lives in `.taskrc.yml`.

The `fields` list is config-driven. Any field name you add there can be created, updated, filtered, and shown by the CLI.

```yml
tasks_dir: .tasks
fields:
  - id: $ID
  - status:
      options:
        - Demo Todo
        - Demo In Review
        - Demo Done
      default: Demo Todo
  - priority:
      default: Demo Medium
      options:
        - Demo Low
        - Demo Medium
        - Demo High
  - type:
      options:
        - Demo Bug
        - Demo Feature
        - Demo Chore
      default: Demo Feature
  - assignee
  - title:
      default: Idea Title
  - description
  - pr
  - created_at: $CREATED_AT
  - updated_at: $UPDATED_AT
  - summary
views:
  - Open Tasks:
      filter: 'status != "Demo Done"'
      columns: status, priority, summary, description
  - High Priority Demo:
      filter: '(status != "Demo Done" && priority == "Demo High")'
      sort:
        - priority: descending
        - status: ascending
```

## Commands

```sh
task new --title "Demo task title" --type "Demo Feature" --priority "Demo High" --status "Demo Todo"
task list
task list 'status == "Demo Todo"'
task ls 'status != "Demo Done"'
task ls --view demo-open
task update TASK-0001 status="Demo In Review" assignee=demo-user
task show TASK-0001
task search demo
task validate
task view create demo-open 'status != "Demo Done"' --column status --column priority --sort priority:ascending --sort status:ascending
task view ls
task view rm demo-open
```

Selectable values are exact strings from `.taskrc.yml`. Quote values that contain spaces or shell-sensitive characters, as shown above.

## Shell completion

The CLI can generate shell completion scripts for Bash, Fish, and Zsh. They suggest saved view names after `task view`, plus `--view` values for `task list` / `task ls`.

When you install the package with `npm i -g .`, it writes the Bash, Fish, and Zsh completion files into your user completion directories automatically.

The installed Bash, Fish, and Zsh files are updated automatically each time you reinstall or upgrade `task` with `npm i -g .`.


## Global install

Install the CLI locally from the repository with:

```sh
npm i -g .
```

This is the preferred install path for using `task` as a command-line tool.

## Linux executable

Build a single Linux executable with:

```sh
pnpm bundle:linux
```

The output is written to `release/task-linux-x64`.

This uses Node's single-executable application flow, so the binary is Linux-specific and should be built on Linux for the target environment.

## macOS Silicon executable

Build a single macOS Apple Silicon executable with:

```sh
pnpm bundle:macos-silicon
```

The output is written to `release/task-darwin-arm64`.

This uses Node's single-executable application flow, so the binary is macOS-specific and should be built on macOS on Apple Silicon for the target environment.

## AI agent integration

The `ai/` directory contains ready-to-use guidance for AI assistants.

### Claude Code — slash command

```sh
mkdir -p .claude/commands
cp ai/skill/SKILL.md .claude/commands/task.md
```

Registers `/task` as a custom slash command so Claude Code can create, update, search, and validate tasks in this project.

### Codex

```sh
cp -r ai/skill/ "$CODEX_HOME/skills/task/"
```

### MCP server (advanced)

`ai/mcp/server.js` exposes the task CLI as MCP tools (`task.new`, `task.list`, `task.update`, etc.). See `ai/README.md` for installation instructions.

## Git workflow recommendation

- Commit task files together with the related code changes.
- One task should usually map to one branch or pull request.
- Task status changes should show up in PR diffs.
- Human decisions belong in markdown, not hidden in generated state.
- Local or generated cache should not be committed.
