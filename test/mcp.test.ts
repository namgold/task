import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const serverPath = fileURLToPath(new URL('../ai/mcp/server.js', import.meta.url));
const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

test('MCP task.new returns text content and structured path/id', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const server = spawn(process.execPath, [serverPath], {
      cwd,
      env: { ...process.env, TASK_CLI_PATH: cliPath }
    });
    const stderr: string[] = [];
    server.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk).toString('utf8')));

    try {
      const responsePromise = readJsonLine(server);
      server.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'task.new',
            arguments: { title: 'MCP structured task', status: 'new' }
          }
        })}\n`
      );

      const response = await responsePromise;
      assert.equal(response.error, undefined, stderr.join(''));
      assert.equal(response.result.structuredContent.id, 'TASK-0001');
      assert.match(response.result.structuredContent.path, /TASK-0001-mcp-structured-task\.md/);
      assert.equal(response.result.content[0].type, 'text');
      assert.equal(response.result.content[0].text, response.result.structuredContent.path);

      const raw = await readFile(path.join(cwd, response.result.structuredContent.path), 'utf8');
      assert.match(raw, /id: TASK-0001/);
      assert.match(raw, /status: new/);
    } finally {
      server.kill();
    }
  });
});

test('MCP task.count returns the task total and supports saved views', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const server = spawn(process.execPath, [serverPath], {
      cwd,
      env: { ...process.env, TASK_CLI_PATH: cliPath }
    });
    const stderr: string[] = [];
    server.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk).toString('utf8')));

    try {
      await mkdir(path.join(cwd, '.tasks'), { recursive: true });
      await writeFile(
        path.join(cwd, '.taskrc.yml'),
        [
          'tasks_dir: .tasks',
          'fields:',
          '  - id: $ID',
          '  - title',
          '  - status:',
          '      options:',
          '        - new',
          '        - done',
          '      default: new',
          'views:',
          '  - Open:',
          '      filter: status != done',
          ''
        ].join('\n'),
        'utf8'
      );

      await writeFile(
        path.join(cwd, '.tasks', 'TASK-0001-open.md'),
        '---\nid: TASK-0001\ntitle: Open\nstatus: new\n---\n# Body\n',
        'utf8'
      );
      await writeFile(
        path.join(cwd, '.tasks', 'TASK-0002-closed.md'),
        '---\nid: TASK-0002\ntitle: Closed\nstatus: done\n---\n# Body\n',
        'utf8'
      );

      const responsePromise = readJsonLine(server);
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'task.count', arguments: {} } })}\n`);
      const response = await responsePromise;
      assert.equal(response.error, undefined, stderr.join(''));
      assert.equal(response.result.content[0].text, '2');

      const viewPromise = readJsonLine(server);
      server.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'task.count', arguments: { view: 'Open' } }
        })}\n`
      );
      const viewResponse = await viewPromise;
      assert.equal(viewResponse.error, undefined, stderr.join(''));
      assert.equal(viewResponse.result.content[0].text, '1');
    } finally {
      server.kill();
    }
  });
});

test('MCP tools/list includes task.count', { concurrency: false }, async () => {
  const server = spawn(process.execPath, [serverPath], {
    cwd: process.cwd(),
    env: { ...process.env, TASK_CLI_PATH: cliPath }
  });

  try {
    const responsePromise = readJsonLine(server);
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);
    const response = await responsePromise;

    assert.equal(response.error, undefined);
    assert.match(JSON.stringify(response.result.tools), /task\.count/);
  } finally {
    server.kill();
  }
});

async function withWorkspace(fn: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'task-mcp-'));
  try {
    await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function readJsonLine(server: ChildProcessWithoutNullStreams): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for MCP response'));
    }, 5000);

    server.stdout.on('data', (chunk) => {
      buffer += Buffer.from(chunk).toString('utf8');
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }

      clearTimeout(timeout);
      const line = buffer.slice(0, newlineIndex);
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    });

    server.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
