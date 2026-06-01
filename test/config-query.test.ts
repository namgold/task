import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildTaskrcDocument,
  defaultTaskConfig,
  readTaskrcDocument,
  taskConfigFromDocument,
  writeTaskrcDocument
} from '../src/config.js';
import { matchesTaskQuery, parseTaskQuery } from '../src/query.js';
import type { TaskFile } from '../src/task.js';

test('taskConfigFromDocument normalizes legacy and mixed config shapes', () => {
  const config = taskConfigFromDocument({
    tasks: {
      tasks_dir: '.work',
      fields: [
        { id: '$ID' },
        { status: { options: ['1. New', '2. Done'], default: '2. Done' } },
        { title: { default: 'Seed title' } },
        'summary'
      ],
      views: [
        {
          'Open Stuff': {
            filter: 'status != done',
            columns: 'status, title',
            sort: { status: 'desc', title: 'ascending' }
          }
        }
      ]
    },
    legacy_flag: true
  });

  assert.equal(config.tasksDir, '.work');
  assert.deepEqual(config.fields[0], { name: 'id', generated: '$ID' });
  assert.deepEqual(config.fields[1], {
    name: 'status',
    options: [
      { label: '1. New', value: 'new' },
      { label: '2. Done', value: 'done' }
    ],
    default: 'done'
  });
  assert.deepEqual(config.fields[2], { name: 'title', options: undefined, default: 'Seed title' });
  assert.deepEqual(config.fields[3], { name: 'summary' });
  assert.deepEqual(config.views['Open Stuff'], {
    filter: 'status != done',
    columns: ['status', 'title'],
    sort: [
      { field: 'status', direction: 'descending' },
      { field: 'title', direction: 'ascending' }
    ]
  });
});

test('buildTaskrcDocument preserves extra keys and round-trips view settings', () => {
  const document = buildTaskrcDocument(
    {
      tasksDir: '.tasks',
      fields: defaultTaskConfig.fields.slice(0, 3),
      views: {
        'Active Tasks': {
          filter: 'status != done && priority == high',
          columns: ['status', 'priority'],
          sort: [
            { field: 'priority', direction: 'descending' },
            { field: 'status', direction: 'ascending' }
          ]
        }
      }
    },
    {
      legacy_flag: true,
      tasks: { keep_me: 'yes' }
    }
  );

  assert.deepEqual(document.legacy_flag, true);
  assert.equal('tasks' in document, false);
  assert.deepEqual(document.tasks_dir, '.tasks');
  assert.deepEqual(document.fields, [
    { id: '$ID' },
    {
      status: {
        options: ['1. New', '2. Brainstorming', '2. Pending_review', '2. Need_revision', '2. Approved', '2. Rejected', '3. Implementing', '3. Pending_review', '3. Done', '3. Blocked'],
        default: 'new'
      }
    },
    {
      priority: {
        options: ['Low', 'Medium', 'High', 'Critical'],
        default: 'medium'
      }
    }
  ]);
  assert.deepEqual(document.views, [
    {
      'Active Tasks': {
        filter: 'status != done && priority == high',
        columns: 'status, priority',
        sort: [
          { priority: 'descending' },
          { status: 'ascending' }
        ]
      }
    }
  ]);
});

test('parseTaskQuery handles escaped quotes and operator precedence', () => {
  const ast = parseTaskQuery('title == "Fix websocket reconnect" status != done || priority == high');

  assert.equal(ast.type, 'or');
  assert.equal(ast.left.type, 'and');
  assert.equal(ast.right.type, 'comparison');
});

test('parseTaskQuery rejects malformed expressions', () => {
  assert.throws(() => parseTaskQuery('title == "missing end'), /Unterminated quoted string/);
  assert.throws(() => parseTaskQuery('title == done extra'), /Expected =, ==, or != after extra/);
  assert.throws(() => parseTaskQuery('title ='), /Expected value after title =/);
});

test('matchesTaskQuery treats implicit AND and arrays consistently', () => {
  const task = {
    filePath: '/tmp/TASK-0001.md',
    fileName: 'TASK-0001.md',
    raw: '',
    frontmatter: {
      status: 'new',
      priority: 'high',
      tags: ['alpha', 'beta']
    },
    body: 'Body text',
    id: 'TASK-0001',
    title: 'Alpha task'
  } as TaskFile;

  assert.equal(matchesTaskQuery(task, 'status == new priority == high'), true);
  assert.equal(matchesTaskQuery(task, 'status == new && priority == high'), true);
  assert.equal(matchesTaskQuery(task, 'tags == "alpha, beta"'), true);
  assert.equal(matchesTaskQuery(task, 'tags != gamma'), true);
  assert.equal(matchesTaskQuery(task, 'priority == low'), false);
});

test('matchesTaskQuery -- single = operator matches like ==', () => {
  const task = { id: 'TASK-0001', title: 'Test', frontmatter: { status: 'new' }, body: '', filePath: '', fileName: '', raw: '' } as TaskFile;
  assert.equal(matchesTaskQuery(task, 'status = new'), true);
  assert.equal(matchesTaskQuery(task, 'status = done'), false);
});

test('matchesTaskQuery -- empty query matches any task', () => {
  const task = { id: 'TASK-0001', title: 'Test', frontmatter: {}, body: '', filePath: '', fileName: '', raw: '' } as TaskFile;
  assert.equal(matchesTaskQuery(task, ''), true);
  assert.equal(matchesTaskQuery(task, '   '), true);
});

test('matchesTaskQuery -- unknown field is treated as empty string', () => {
  const task = { id: 'TASK-0001', title: 'Test', frontmatter: {}, body: '', filePath: '', fileName: '', raw: '' } as TaskFile;
  assert.equal(matchesTaskQuery(task, 'nonexistent != something'), true);
  assert.equal(matchesTaskQuery(task, 'nonexistent == something'), false);
});

test('matchesTaskQuery -- or keyword works as logical OR', () => {
  const task = { id: 'TASK-0001', title: 'Test', frontmatter: { status: 'new' }, body: '', filePath: '', fileName: '', raw: '' } as TaskFile;
  assert.equal(matchesTaskQuery(task, 'status == new or status == done'), true);
  assert.equal(matchesTaskQuery(task, 'status == blocked or status == done'), false);
});

test('matchesTaskQuery -- and keyword works as logical AND', () => {
  const task = { id: 'TASK-0001', title: 'Test', frontmatter: { status: 'new', priority: 'high' }, body: '', filePath: '', fileName: '', raw: '' } as TaskFile;
  assert.equal(matchesTaskQuery(task, 'status == new and priority == high'), true);
  assert.equal(matchesTaskQuery(task, 'status == new and priority == low'), false);
});

test('matchesTaskQuery -- single-quoted string value', () => {
  const task = { id: 'TASK-0001', title: 'Test', frontmatter: { status: 'new' }, body: '', filePath: '', fileName: '', raw: '' } as TaskFile;
  assert.equal(matchesTaskQuery(task, "status == 'new'"), true);
  assert.equal(matchesTaskQuery(task, "status == 'done'"), false);
});

test('parseTaskQuery -- throws on unclosed parenthesis', () => {
  assert.throws(() => parseTaskQuery('(status == new'), /Expected rparen/);
});

test('taskConfigFromDocument -- handles views as record (not array)', () => {
  const config = taskConfigFromDocument({
    views: {
      'My View': { filter: 'status == new', columns: ['status', 'title'], sort: [] }
    }
  });
  assert.ok('My View' in config.views);
  assert.equal(config.views['My View'].filter, 'status == new');
  assert.deepEqual(config.views['My View'].columns, ['status', 'title']);
});

test('taskConfigFromDocument -- reads legacy "view" key', () => {
  const config = taskConfigFromDocument({
    view: {
      'Legacy View': { filter: 'priority == high' }
    }
  });
  assert.ok('Legacy View' in config.views);
  assert.equal(config.views['Legacy View'].filter, 'priority == high');
});

test('taskConfigFromDocument -- empty document falls back to default fields and tasksDir', () => {
  const config = taskConfigFromDocument({});
  assert.equal(config.tasksDir, defaultTaskConfig.tasksDir);
  assert.equal(config.fields.length, defaultTaskConfig.fields.length);
  assert.deepEqual(config.views, {});
});

test('taskConfigFromDocument -- preserves weird and duplicate field entries', () => {
  const config = taskConfigFromDocument({
    fields: [
      'custom-field',
      { 'weird field': { default: 'value' } },
      { id: '$ID' },
      { id: '$ID' },
      { title: { default: 'Override title' } }
    ]
  });

  assert.deepEqual(config.fields.map((field) => field.name), [
    'custom-field',
    'weird field',
    'id',
    'id',
    'title'
  ]);
  assert.equal(config.fields[2].generated, '$ID');
  assert.equal(config.fields[3].generated, '$ID');
});

test('writeTaskrcDocument -- writes YAML file to the given directory', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'task-config-'));
  try {
    await writeTaskrcDocument(dir, { tasks_dir: '.tasks', custom_key: 'value' });
    const content = await readFile(path.join(dir, '.taskrc.yml'), 'utf8');
    assert.match(content, /tasks_dir: .tasks/);
    assert.match(content, /custom_key: value/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readTaskrcDocument -- rejects malformed YAML', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'task-config-'));
  try {
    await writeFile(path.join(dir, '.taskrc.yml'), 'fields:\n  - id: $ID\n    title\n', 'utf8');
    await assert.rejects(() => readTaskrcDocument(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readTaskrcDocument -- rejects invalid field entry shape', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'task-config-'));
  try {
    await writeFile(
      path.join(dir, '.taskrc.yml'),
      [
        'fields:',
        '  - id: $ID',
        '    title: $ID',
        ''
      ].join('\n'),
      'utf8'
    );

    await assert.rejects(
      () => readTaskrcDocument(dir),
      /Invalid \.taskrc\.yml: field entries must contain exactly one field name/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readTaskrcDocument -- rejects invalid view entry shape', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'task-config-'));
  try {
    await writeFile(
      path.join(dir, '.taskrc.yml'),
      [
        'views:',
        '  - Alpha: { filter: "status == new" }',
        '    Beta: { filter: "status == done" }',
        ''
      ].join('\n'),
      'utf8'
    );

    await assert.rejects(
      () => readTaskrcDocument(dir),
      /Invalid \.taskrc\.yml: view entries must contain exactly one view name/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
