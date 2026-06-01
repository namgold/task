# Agent Integration

This directory is the repo-local source of truth for AI agent guidance.

## Layout

- `skill/` contains the Codex skill source.
- `mcp/` contains the MCP contract and loading notes.
- `references/` contains shared task-format and workflow guidance.

## How to use it

- Codex: install the skill from `ai/skill/` into `$CODEX_HOME/skills/task/`.
- Claude Code: copy `ai/skill/SKILL.md` to `.claude/commands/task.md` in your project root to register `/task` as a custom slash command.
- Other LLMs: read `ai/references/task-format.md` and use the CLI or MCP interface.

## Installation

### Claude Code — slash command

Copy the skill file into your project's Claude commands folder:

```sh
mkdir -p .claude/commands
cp ai/skill/SKILL.md .claude/commands/task.md
```

This registers `/task` as a custom slash command in Claude Code. Use it in any Claude Code session in this project to have the assistant create, update, search, and validate tasks.

### Claude Code — MCP server (advanced)

`ai/mcp/server.js` implements the MCP tool surface defined in `ai/mcp/SPEC.md`. It is registered automatically via `.claude/settings.json` when you use this repo with Claude Code.

If you need to register it manually in another project:

```json
{
  "mcpServers": {
    "task": {
      "command": "node",
      "args": ["/absolute/path/to/ai/mcp/server.js"]
    }
  }
}
```

The server requires either `dist/cli.js` (run `pnpm build` first) or `task` installed globally (`npm i -g .`).

### Codex

Copy the skill folder into your Codex skills directory:

```sh
cp -r ai/skill/ "$CODEX_HOME/skills/task/"
```

Codex will pick up the skill automatically on next load.

