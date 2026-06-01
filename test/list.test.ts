import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { listTasks } from '../src/list.js';
import type { TaskConfig } from '../src/config.js';

const config: TaskConfig = {
  tasksDir: '.tasks',
  fields: [
    { name: 'id', generated: '$ID' },
    { name: 'status', options: [{ label: 'New', value: 'new' }, { label: 'Done', value: 'done' }], default: 'new' },
    { name: 'priority', options: [{ label: 'High', value: 'high' }, { label: 'Low', value: 'low' }], default: 'low' },
    { name: 'title' },
  ],
  views: {
    'Active': {
      filter: 'status != done',
      columns: ['id', 'title', 'status', 'priority'],
      sort: []
    }
  }
};

async function withTasksDir(fn: (tasksDir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'task-list-'));
  const tasksDir = path.join(dir, '.tasks');
  await mkdir(tasksDir, { recursive: true });
  try {
    await fn(tasksDir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function writeTask(tasksDir: string, id: string, fields: Record<string, string>): Promise<void> {
  const fm = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
  return writeFile(
    path.join(tasksDir, `${id}-task.md`),
    `---\nid: ${id}\n${fm}\n---\n# Body\n\nText.\n`,
    'utf8'
  );
}

test('listTasks -- no tasks produces empty message', async () => {
  await withTasksDir(async (tasksDir) => {
    const result = await listTasks(tasksDir, config, '');
    assert.equal(result, 'No tasks found.');
  });
});

test('listTasks -- ad-hoc query without view filters tasks', async () => {
  await withTasksDir(async (tasksDir) => {
    await writeTask(tasksDir, 'TASK-0001', { status: 'new', priority: 'high', title: 'Match' });
    await writeTask(tasksDir, 'TASK-0002', { status: 'done', priority: 'high', title: 'No match' });

    const result = await listTasks(tasksDir, config, 'status == new');
    assert.match(result, /Match/);
    assert.doesNotMatch(result, /No match/);
    assert.match(result, /\bnew\b/);
  });
});

test('listTasks -- view filter and ad-hoc query are combined with AND', async () => {
  await withTasksDir(async (tasksDir) => {
    await writeTask(tasksDir, 'TASK-0001', { status: 'new', priority: 'high', title: 'High open' });
    await writeTask(tasksDir, 'TASK-0002', { status: 'new', priority: 'low', title: 'Low open' });
    await writeTask(tasksDir, 'TASK-0003', { status: 'done', priority: 'high', title: 'High done' });

    // View 'Active' filters status != done; ad-hoc adds priority == high
    const result = await listTasks(tasksDir, config, 'priority == high', 'Active');
    assert.match(result, /High open/);
    assert.doesNotMatch(result, /Low open/);
    assert.doesNotMatch(result, /High done/);
  });
});

test('listTasks -- view with no columns falls back to all config fields', async () => {
  await withTasksDir(async (tasksDir) => {
    await writeTask(tasksDir, 'TASK-0001', { status: 'new', priority: 'high', title: 'My task' });

    const noColumnConfig: TaskConfig = {
      ...config,
      views: { 'All': { filter: 'status != done', columns: [], sort: [] } }
    };

    const result = await listTasks(tasksDir, noColumnConfig, '', 'All');
    // Header should include all field names
    assert.match(result, /id\s+status\s+priority\s+title/);
  });
});

test('listTasks -- sorts by single field descending', async () => {
  await withTasksDir(async (tasksDir) => {
    await writeTask(tasksDir, 'TASK-0001', { status: 'new', priority: 'low', title: 'Alpha' });
    await writeTask(tasksDir, 'TASK-0002', { status: 'new', priority: 'low', title: 'Zeta' });

    const sortedConfig: TaskConfig = {
      ...config,
      views: {
        'Sorted': {
          filter: 'status == new',
          columns: ['id', 'title'],
          sort: [{ field: 'title', direction: 'descending' }]
        }
      }
    };

    const result = await listTasks(tasksDir, sortedConfig, '', 'Sorted');
    const lines = result.split('\n').filter((l) => l.trim());
    // Descending alphabetical: Zeta before Alpha
    assert.match(lines[1], /Zeta/);
    assert.match(lines[2], /Alpha/);
  });
});

test('listTasks -- tie-breaking uses second sort spec', async () => {
  await withTasksDir(async (tasksDir) => {
    await writeTask(tasksDir, 'TASK-0001', { status: 'new', priority: 'high', title: 'Alpha' });
    await writeTask(tasksDir, 'TASK-0002', { status: 'new', priority: 'high', title: 'Zeta' });
    await writeTask(tasksDir, 'TASK-0003', { status: 'new', priority: 'low', title: 'Beta' });

    const sortedConfig: TaskConfig = {
      ...config,
      views: {
        'TwoSort': {
          filter: 'status == new',
          columns: ['id', 'priority', 'title'],
          // 'high' < 'low' alphabetically ascending → high-priority tasks first
          // within same priority, title ascending
          sort: [
            { field: 'priority', direction: 'ascending' },
            { field: 'title', direction: 'ascending' }
          ]
        }
      }
    };

    const result = await listTasks(tasksDir, sortedConfig, '', 'TwoSort');
    const lines = result.split('\n').filter((l) => l.trim());
    assert.match(lines[1], /Alpha/);
    assert.match(lines[2], /Zeta/);
    assert.match(lines[3], /Beta/);
  });
});
