# Task MCP Contract

This document defines the recommended MCP surface for the task tool.

## Purpose

Expose the existing task workflow through structured tool calls instead of shell commands.

## Recommended tools

- `task.new`
- `task.list`
- `task.count`
- `task.show`
- `task.update`
- `task.search`
- `task.validate`
- `task.view.list`
- `task.view.create`
- `task.view.remove`

## Semantics

- `task.new` creates a new markdown task file and returns its path and id.
- `task.list` returns filtered task rows or a rendered table.
- `task.count` returns the number of matching tasks, optionally scoped to a saved view.
- `task.show` returns the full task markdown.
- `task.update` updates only frontmatter fields and preserves the markdown body.
- `task.search` searches frontmatter and body text.
- `task.validate` returns validation issues for all task files.
- view operations read or modify `.taskrc.yml`.

## Implementation

The server is implemented in `ai/mcp/server.js`. It shells out to the `task` CLI for each tool call, keeping behavior aligned with the CLI source of truth.

Requires one of:
- `dist/cli.js` to exist (run `pnpm build` first), or
- `task` installed globally (`npm i -g @namgold/task`)
