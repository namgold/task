#!/usr/bin/env node
/**
 * Task MCP server — implements ai/mcp/SPEC.md by shelling out to the task CLI.
 *
 * Requires one of:
 *   - dist/cli.js to exist (run `pnpm build` first), OR
 *   - `task` installed globally (`npm i -g .`)
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// --- CLI resolution ---

function resolveCli() {
  const distCli = path.join(projectRoot, 'dist', 'cli.js');
  if (fs.existsSync(distCli)) {
    return { cmd: process.execPath, args: [distCli] };
  }
  return { cmd: 'task', args: [] };
}

function runTask(taskArgs, { allowNonZero = false } = {}) {
  const { cmd, args } = resolveCli();
  const result = spawnSync(cmd, [...args, ...taskArgs], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.error) throw new Error(`Failed to spawn task: ${result.error.message}`);
  if (!allowNonZero && result.status !== 0) {
    throw new Error((result.stderr ?? '').trim() || 'task command failed');
  }
  return result.status !== 0
    ? (result.stderr ?? '').trim()
    : (result.stdout ?? '').trim();
}

// --- MCP stdio transport (newline-delimited JSON) ---

import * as readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try { message = JSON.parse(trimmed); } catch { return; }
  handleMessage(message);
});

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// --- Tool definitions ---

const TOOLS = [
  {
    name: 'task.new',
    description: 'Create a new task markdown file',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title:       { type: 'string' },
        type:        { type: 'string' },
        priority:    { type: 'string' },
        status:      { type: 'string' },
        assignee:    { type: 'string' },
        description: { type: 'string' },
        owner:       { type: 'string' },
        branch:      { type: 'string' },
        pr:          { type: 'string' },
        summary:     { type: 'string' }
      }
    }
  },
  {
    name: 'task.list',
    description: 'List tasks, optionally filtered by a query expression or saved view name',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Filter expression e.g. "status != done"' },
        view:  { type: 'string', description: 'Saved view name' }
      }
    }
  },
  {
    name: 'task.show',
    description: 'Return the full markdown of a task by ID',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } }
    }
  },
  {
    name: 'task.update',
    description: 'Update frontmatter fields of a task, preserving the markdown body',
    inputSchema: {
      type: 'object',
      required: ['id', 'fields'],
      properties: {
        id:     { type: 'string' },
        fields: { type: 'object', additionalProperties: { type: 'string' } }
      }
    }
  },
  {
    name: 'task.search',
    description: 'Search tasks by text across frontmatter and body',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string' } }
    }
  },
  {
    name: 'task.validate',
    description: 'Validate all task files and return any issues found',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'task.view.list',
    description: 'List all saved views defined in .taskrc.yml',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'task.view.create',
    description: 'Create a new saved view in .taskrc.yml',
    inputSchema: {
      type: 'object',
      required: ['name', 'filter'],
      properties: {
        name:    { type: 'string' },
        filter:  { type: 'string' },
        columns: { type: 'array', items: { type: 'string' } },
        sort:    { type: 'array', items: { type: 'string', description: '"field:direction"' } }
      }
    }
  },
  {
    name: 'task.view.remove',
    description: 'Remove a saved view from .taskrc.yml',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } }
    }
  }
];

// --- Tool dispatch ---

function callTool(name, input = {}) {
  switch (name) {
    case 'task.new': {
      const args = ['new', '--title', input.title];
      for (const flag of ['type', 'priority', 'status', 'assignee', 'description', 'owner', 'branch', 'pr', 'summary']) {
        if (input[flag]) args.push(`--${flag}`, input[flag]);
      }
      return runTask(args);
    }

    case 'task.list': {
      const args = ['list'];
      if (input.query) args.push(input.query);
      if (input.view) args.push('--view', input.view);
      return runTask(args);
    }

    case 'task.show':
      return runTask(['show', input.id]);

    case 'task.update': {
      const pairs = Object.entries(input.fields).map(([k, v]) => `${k}=${v}`);
      return runTask(['update', input.id, ...pairs]);
    }

    case 'task.search':
      return runTask(['search', input.query]);

    case 'task.validate':
      return runTask(['validate'], { allowNonZero: true });

    case 'task.view.list':
      return runTask(['view', 'ls']);

    case 'task.view.create': {
      const args = ['view', 'create', input.name, input.filter];
      for (const col of (input.columns ?? [])) args.push('--column', col);
      for (const s of (input.sort ?? [])) args.push('--sort', s);
      return runTask(args);
    }

    case 'task.view.remove':
      return runTask(['view', 'rm', '--yes', input.name]);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// --- Message handler ---

function handleMessage(msg) {
  const { id, method, params } = msg;

  // Notifications have no id — no response needed
  if (id === undefined) return;

  try {
    switch (method) {
      case 'initialize':
        send({
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'task', version: '0.1.0' }
          }
        });
        break;

      case 'tools/list':
        send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
        break;

      case 'tools/call': {
        const { name, arguments: args = {} } = params ?? {};
        const text = callTool(name, args);
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
        break;
      }

      default:
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (err) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } });
  }
}

process.stdin.resume();
