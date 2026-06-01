# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
pnpm build            # compile TypeScript → dist/
pnpm dev -- <args>    # run CLI directly without building (via tsx)
pnpm test             # run all tests
npm i -g @namgold/task # install globally (preferred; also regenerates shell completions via postinstall)
```

Run a single test file: `node --import tsx --test test/cli.test.ts`

Do **not** use `pnpm bundle:linux` / `pnpm bundle:macos-silicon` for distribution — use `npm i -g @namgold/task` instead.

## Architecture

**Entry point:** `src/cli.ts` — wires all subcommands via `commander`. Each subcommand loads config, delegates to a module, then writes output to stdout/stderr.

**Config layer:** `src/config.ts`
- Reads `.taskrc.yml` from cwd; falls back to `defaultTaskConfig` if absent.
- Exports `TaskConfig` (fields, views, tasksDir), `FieldConfig`, `ViewConfig`.
- Field options are normalized: lowercase, strip leading `N. ` prefix, spaces → underscores. This normalized form is what gets stored and compared.
- Special generated field markers: `$ID`, `$CREATED_AT`, `$UPDATED_AT`.

**Task files:** `src/task.ts` — reads all `*.md` files from `tasksDir`, parses YAML frontmatter via `gray-matter`, exposes `TaskFile` (id, title, frontmatter, body, raw, filePath).

**Filter query engine:** `src/query.ts` — hand-rolled tokenizer → recursive-descent parser → AST evaluator. Supports `==`, `!=`, `&&`, `||`, `()`; adjacent terms are implicitly `&&`. Used by `list` and `view` commands.

**Other modules:** `src/new.ts` (create), `src/update.ts` (update frontmatter while preserving body), `src/list.ts` (filter + sort + column rendering), `src/validate.ts` (field validation), `src/table.ts` (tabular stdout), `src/completion.ts` + `src/install-completions.ts` (bash/fish shell completion).

**Build output:** TypeScript compiles to `dist/` (ESM, NodeNext resolution). The `bin` entry points to `dist/cli.js`.

## Task file format

Tasks live in `.tasks/` as markdown with YAML frontmatter. The markdown body is human-editable and is preserved verbatim when `update` rewrites frontmatter. The `.taskrc.yml` in a repo controls which fields exist, their allowed values, and saved views.

## Agent docs

Repo-local agent guidance now lives under `ai/`:

- `ai/skill/SKILL.md` for Codex skill behavior
- `ai/mcp/SPEC.md` for the MCP contract
- `ai/references/task-format.md` for shared task-file conventions
