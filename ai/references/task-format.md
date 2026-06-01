# Task Format Reference

Use this reference when an agent needs to understand how tasks are represented in this repository.

## Source of truth

- The markdown task files are the authoritative data store.
- Tasks live under `.tasks/` by default.
- `.taskrc.yml` controls fields, defaults, allowed values, tasks directory, and saved views.

## Task file shape

- Each task is a markdown file with YAML frontmatter.
- Keep the body human-readable and editable.
- Preserve the body when updating frontmatter.
- Common fields include `id`, `title`, `type`, `status`, `priority`, `assignee`, `owner`, `branch`, `pr`, `created_at`, `updated_at`, and `summary`.
- Custom fields come from `.taskrc.yml`.

## Agent workflow

- Read `.taskrc.yml` and the task file before making changes.
- Use the CLI or MCP tools for anything that should be reflected in the repository.
- Validate task files if metadata changed.
- Keep task changes in git with the related code changes.

## Useful CLI operations

```sh
task new --title "Fix reconnect" --type bug --priority high
task list
task ls "status != done && status != rejected"
task show TASK-0001
task update TASK-0001 status=approved assignee=nam
task search websocket
task validate
task view ls
```

