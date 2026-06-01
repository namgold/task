# Agent Notes

- Repo purpose: provide a local-first, Git-native task tracker where each task is a human-editable markdown file stored in the repository.
- Problem it solves: keeps task metadata, status changes, and review context versioned with code so humans and AI agents can read, diff, edit, and validate work without a separate database or SaaS tool.
- Solution approach: use a small CLI to create, list, search, validate, show, and update markdown task files with YAML frontmatter, while treating the markdown files themselves as the source of truth.
- `pnpm bundle:linux` succeeds and produces `release/task-linux-x64`.
- The build emits `postject` warnings about section names such as `.note.100` and `.note`, but the executable still runs correctly.
- If these warnings matter later, the packaging flow should be revisited, but they are not currently blocking.
- Distribution note: do not rely on `bundle:linux` or mac packaging scripts going forward; install the tool with `npm i -g @namgold/task` instead.
