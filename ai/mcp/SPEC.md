# Task MCP Contract

This document defines the recommended MCP surface for the task tool.

## Purpose

Expose the existing task workflow through structured tool calls instead of shell commands.

## Recommended tools

- `task.new`
- `task.list`
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
- `task.show` returns the full task markdown.
- `task.update` updates only frontmatter fields and preserves the markdown body.
- `task.search` searches frontmatter and body text.
- `task.validate` returns validation issues for all task files.
- view operations read or modify `.taskrc.yml`.

## Implementation note

This spec is not implemented in this repository — it is a forward-looking contract for anyone who wants to build an MCP server wrapper around the `task` CLI.

Prefer reusing the existing CLI or shared modules so the MCP behavior stays aligned with the repository’s markdown-backed source of truth.

