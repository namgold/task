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

`ai/mcp/SPEC.md` defines a recommended MCP tool surface. No server is included in this repo, but if you implement one (wrapping the `task` CLI), register it in `.claude/settings.json`:

```json
{
  "mcpServers": {
    "task": {
      "command": "node",
      "args": ["/path/to/your/task-mcp-server.js"]
    }
  }
}
```

### Codex

Copy the skill folder into your Codex skills directory:

```sh
cp -r ai/skill/ "$CODEX_HOME/skills/task/"
```

Codex will pick up the skill automatically on next load.

