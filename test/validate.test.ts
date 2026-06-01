import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { validateTasks } from '../src/validate.js';
import type { TaskConfig } from '../src/config.js';

const minimalConfig: TaskConfig = {
  tasksDir: '.tasks',
  fields: [
    { name: 'id', generated: '$ID' },
    { name: 'status', options: [{ label: 'New', value: 'new' }, { label: 'Done', value: 'done' }], default: 'new' },
    { name: 'title' },
  ],
  views: {}
};

async function withTasksDir(fn: (tasksDir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'task-validate-'));
  const tasksDir = path.join(dir, '.tasks');
  await mkdir(tasksDir, { recursive: true });
  try {
    await fn(tasksDir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function writeTaskFile(tasksDir: string, name: string, content: string): Promise<void> {
  return writeFile(path.join(tasksDir, name), content, 'utf8');
}

test('validateTasks -- valid task returns no issues', async () => {
  await withTasksDir(async (tasksDir) => {
    await writeTaskFile(
      tasksDir,
      'TASK-0001-my-task.md',
      '---\nid: TASK-0001\nstatus: new\ntitle: My task\n---\n# Body\n\nDetails.\n'
    );
    const issues = await validateTasks(tasksDir, minimalConfig);
    assert.equal(issues.length, 0);
  });
});

test('validateTasks -- no task files returns empty issues', async () => {
  await withTasksDir(async (tasksDir) => {
    const issues = await validateTasks(tasksDir, minimalConfig);
    assert.equal(issues.length, 0);
  });
});

test('validateTasks -- empty body produces issue', async () => {
  await withTasksDir(async (tasksDir) => {
    await writeTaskFile(tasksDir, 'TASK-0001-empty.md', '---\nid: TASK-0001\nstatus: new\ntitle: Empty\n---\n');
    const issues = await validateTasks(tasksDir, minimalConfig);
    assert.ok(issues.some((issue) => issue.message.includes('Markdown body is empty')));
  });
});

test('validateTasks -- filename mismatch produces issue', async () => {
  await withTasksDir(async (tasksDir) => {
    // File named TASK-0002-... but frontmatter id is TASK-0001
    await writeTaskFile(
      tasksDir,
      'TASK-0002-wrong-name.md',
      '---\nid: TASK-0001\nstatus: new\ntitle: Wrong\n---\n# Body\n\nText.\n'
    );
    const issues = await validateTasks(tasksDir, minimalConfig);
    assert.ok(issues.some((issue) => issue.message.includes('Filename does not roughly match task ID')));
  });
});

test('validateTasks -- missing generated field produces issue', async () => {
  await withTasksDir(async (tasksDir) => {
    // Task file without "id" in frontmatter when $ID is declared
    await writeTaskFile(
      tasksDir,
      'TASK-0001-no-id.md',
      '---\nstatus: new\ntitle: No ID\n---\n# Body\n\nText.\n'
    );
    const issues = await validateTasks(tasksDir, minimalConfig);
    assert.ok(issues.some((issue) => issue.message.includes('Missing required fields')));
  });
});

test('validateTasks -- duplicate ids produce issue', async () => {
  await withTasksDir(async (tasksDir) => {
    await writeTaskFile(tasksDir, 'TASK-0001-alpha.md', '---\nid: TASK-0001\nstatus: new\ntitle: Alpha\n---\n# Body\n\nText.\n');
    await writeTaskFile(tasksDir, 'TASK-0001-beta.md', '---\nid: TASK-0001\nstatus: new\ntitle: Beta\n---\n# Body\n\nText.\n');
    const issues = await validateTasks(tasksDir, minimalConfig);
    assert.ok(issues.some((issue) => issue.message.includes('Duplicate task ID')));
  });
});

test('validateTasks -- invalid selectable field produces issue', async () => {
  await withTasksDir(async (tasksDir) => {
    await writeTaskFile(
      tasksDir,
      'TASK-0001-bad.md',
      '---\nid: TASK-0001\nstatus: notvalid\ntitle: Bad\n---\n# Body\n\nText.\n'
    );
    const issues = await validateTasks(tasksDir, minimalConfig);
    assert.ok(issues.some((issue) => issue.message.includes('Invalid status')));
  });
});
