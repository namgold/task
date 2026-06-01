import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { getCompletionSuggestions } from '../src/completion.js';
import { buildTaskrcDocument, defaultTaskConfig, readTaskrcDocument, taskConfigFromDocument } from '../src/config.js';
import { listTasks } from '../src/list.js';
import { matchesTaskQuery, parseTaskQuery } from '../src/query.js';
import { updateTask } from '../src/update.js';
import { validateTasks } from '../src/validate.js';
import {
  buildNewTaskFrontmatter,
  flattenTaskSearchText,
  getTaskFieldValue,
  slugify,
  stringifyTaskFile,
  taskFileName,
  todayIsoDate,
  type TaskFile
} from '../src/task.js';
import type { TaskConfig } from '../src/config.js';

function makeTask(overrides: Partial<TaskFile> = {}): TaskFile {
  return {
    filePath: '/tmp/TASK-0001-test.md',
    fileName: 'TASK-0001-test.md',
    raw: '',
    frontmatter: {},
    body: '',
    id: 'TASK-0001',
    title: 'Test task',
    ...overrides
  };
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'task-edge-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withTasksDir(fn: (tasksDir: string) => Promise<void>): Promise<void> {
  await withTempDir(async (dir) => {
    const tasksDir = path.join(dir, '.tasks');
    await mkdir(tasksDir, { recursive: true });
    await fn(tasksDir);
  });
}

function writeTaskFile(tasksDir: string, frontmatter: Record<string, unknown>, body = ['# Body', '', 'Text.'].join('\n')): Promise<string> {
  const fileName = `${String(frontmatter.id ?? 'TASK-0001')}-${slugify(String(frontmatter.title ?? 'task'))}.md`;
  const filePath = path.join(tasksDir, fileName);
  const raw = stringifyTaskFile({ frontmatter, body });
  return writeFile(filePath, raw.endsWith('\n') ? raw : `${raw}\n`, 'utf8').then(() => filePath);
}

test('config -- keeps valid field entries and drops invalid ones', () => {
  const config = taskConfigFromDocument({
    fields: [null, false, 'summary', { ' weird field ': { default: 'value' } }, { status: '$ID' }] as never
  });

  assert.deepEqual(config.fields.map((field) => field.name), ['summary', 'weird field', 'status']);
  assert.equal(config.fields[1].default, 'value');
  assert.equal(config.fields[2].generated, '$ID');
});

test('config -- falls back to defaults when every field entry is invalid', () => {
  const config = taskConfigFromDocument({ fields: [null, false, 0, {}] as never });

  assert.equal(config.fields.length, defaultTaskConfig.fields.length);
  assert.equal(config.fields[0].name, 'id');
  assert.equal(config.tasksDir, defaultTaskConfig.tasksDir);
});

test('config -- nested tasks wrapper wins over root fields and tasks_dir', () => {
  const config = taskConfigFromDocument({
    tasks: {
      tasks_dir: '.work',
      fields: ['summary', { 'custom field': { default: 'seed' } }],
      views: [{ Inbox: { filter: 'status == new', columns: 'summary', sort: [] } }]
    },
    tasks_dir: '.root'
  });

  assert.equal(config.tasksDir, '.work');
  assert.deepEqual(config.fields.map((field) => field.name), ['summary', 'custom field']);
  assert.equal(config.views.Inbox.filter, 'status == new');
});

test('config -- buildTaskrcDocument strips legacy keys and keeps custom extras', () => {
  const document = buildTaskrcDocument(
    {
      tasksDir: '.tasks',
      fields: defaultTaskConfig.fields.slice(0, 2),
      views: {}
    },
    {
      legacy_flag: true,
      tasks: { keep_me: 'no' },
      view: { legacy: { filter: 'status == new' } },
      statuses: ['new'],
      priorities: ['low'],
      types: ['bug'],
      default_assignee: 'bob',
      custom_flag: 'kept'
    }
  );

  assert.equal('tasks' in document, false);
  assert.equal('view' in document, false);
  assert.equal('statuses' in document, false);
  assert.equal(document.legacy_flag, true);
  assert.equal(document.custom_flag, 'kept');
});

test('config -- buildTaskrcDocument omits empty view columns and sort blocks', () => {
  const document = buildTaskrcDocument({
    tasksDir: '.tasks',
    fields: defaultTaskConfig.fields.slice(0, 1),
    views: {
      Inbox: { filter: 'status == new', columns: [], sort: [] },
      Sorted: {
        filter: 'status == new',
        columns: ['title'],
        sort: [{ field: 'title', direction: 'ascending' }]
      }
    }
  });

  assert.deepEqual(document.views[0], { Inbox: { filter: 'status == new' } });
  assert.deepEqual(document.views[1], {
    Sorted: {
      filter: 'status == new',
      columns: 'title',
      sort: [{ title: 'ascending' }]
    }
  });
});

test('config -- readTaskrcDocument rejects malformed YAML syntax', async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, '.taskrc.yml'), 'fields:\n  - id: $ID\n    title\n', 'utf8');
    await assert.rejects(() => readTaskrcDocument(dir), /Invalid \.taskrc\.yml|YAML/);
  });
});

test('config -- readTaskrcDocument rejects invalid field specs', async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      path.join(dir, '.taskrc.yml'),
      ['fields:', '  - title: {}', ''].join('\n'),
      'utf8'
    );

    await assert.rejects(() => readTaskrcDocument(dir), /field spec must include options or default/);
  });
});

test('config -- readTaskrcDocument rejects invalid field entry shapes', async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      path.join(dir, '.taskrc.yml'),
      ['fields:', '  - id: $ID', '    title: $ID', ''].join('\n'),
      'utf8'
    );

    await assert.rejects(() => readTaskrcDocument(dir), /field entries must contain exactly one field name/);
  });
});

test('config -- readTaskrcDocument rejects invalid view entry shapes', async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      path.join(dir, '.taskrc.yml'),
      ['views:', '  - Alpha: { filter: "status == new" }', '    Beta: { filter: "status == done" }', ''].join('\n'),
      'utf8'
    );

    await assert.rejects(() => readTaskrcDocument(dir), /view entries must contain exactly one view name/);
  });
});

test('config -- readTaskrcDocument rejects invalid sort values', async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      path.join(dir, '.taskrc.yml'),
      [
        'views:',
        '  - Bad:',
        '      filter: status == new',
        '      columns: ""',
        ''
      ].join('\n'),
      'utf8'
    );

    await assert.rejects(() => readTaskrcDocument(dir), /Invalid \.taskrc\.yml/);
  });
});

test('task -- explicit fields override defaults and unknown fields are ignored', () => {
  const config: TaskConfig = {
    tasksDir: '.tasks',
    fields: [
      { name: 'id', generated: '$ID' },
      { name: 'status', options: [{ label: 'New', value: 'new' }, { label: 'Done', value: 'done' }], default: 'new' },
      { name: 'summary' }
    ],
    views: {}
  };

  const fm = buildNewTaskFrontmatter(config, {
    id: 'TASK-0001',
    title: 'Example',
    fields: { status: 'done', summary: 'Seed', ignored: 'value' } as never
  });

  assert.equal(fm.status, 'done');
  assert.equal(fm.summary, 'Seed');
  assert.equal('ignored' in fm, false);
});

test('task -- selectable values normalize from labels and defaults', () => {
  const config: TaskConfig = {
    tasksDir: '.tasks',
    fields: [
      { name: 'id', generated: '$ID' },
      {
        name: 'status',
        options: [
          { label: '1. New', value: 'new' },
          { label: '2. Done', value: 'done' }
        ],
        default: '2. Done'
      }
    ],
    views: {}
  };

  const explicit = buildNewTaskFrontmatter(config, { id: 'TASK-0001', title: 'Example', fields: { status: '1. New' } });
  const fallback = buildNewTaskFrontmatter(config, { id: 'TASK-0002', title: 'Example' });

  assert.equal(explicit.status, 'new');
  assert.equal(fallback.status, 'done');
  assert.equal(explicit.id, 'TASK-0001');
});

test('task -- generated fields and dates are written together', () => {
  const config: TaskConfig = {
    tasksDir: '.tasks',
    fields: [
      { name: 'id', generated: '$ID' },
      { name: 'created_at', generated: '$CREATED_AT' },
      { name: 'updated_at', generated: '$UPDATED_AT' },
      { name: 'title', default: 'Seed Title' }
    ],
    views: {}
  };

  const fm = buildNewTaskFrontmatter(config, { id: 'TASK-0007', title: 'Example' });
  const today = todayIsoDate();

  assert.equal(fm.id, 'TASK-0007');
  assert.equal(fm.created_at, today);
  assert.equal(fm.updated_at, today);
  assert.equal(fm.title, 'Seed Title');
});

test('task -- field value extraction handles arrays, dates, objects, and missing values', () => {
  const date = new Date('2026-06-01T00:00:00.000Z');
  const task = makeTask({
    frontmatter: {
      tags: ['alpha', 'beta'],
      due: date,
      meta: { nested: true },
      count: 42
    }
  });

  assert.equal(getTaskFieldValue(task, 'tags'), 'alpha, beta');
  assert.equal(getTaskFieldValue(task, 'due'), date.toISOString());
  assert.equal(getTaskFieldValue(task, 'meta'), '[object Object]');
  assert.equal(getTaskFieldValue(task, 'missing'), '');
});

test('task -- stringifyTaskFile keeps unusual keys, empty arrays, and body text', () => {
  const body = '\n# Body\n\nText.\n';
  const raw = stringifyTaskFile({
    frontmatter: {
      id: 'TASK-0001',
      assignee: '',
      tags: [],
      'custom field': 'alpha',
      'system-schema': 'beta'
    },
    body
  });

  assert.match(raw, /assignee:/m);
  assert.match(raw, /tags: \[\]/m);
  assert.match(raw, /custom field: alpha/);
  assert.match(raw, /system-schema: beta/);
  assert.ok(raw.endsWith(body));
});

test('task -- search text flattens and lowercases every segment', () => {
  const task = makeTask({
    title: 'Alpha Task',
    frontmatter: { summary: 'UPPER', meta: { kind: 'Story' }, tags: ['One', 'Two'] },
    body: 'BODY TOKEN'
  });
  const text = flattenTaskSearchText(task);

  assert.doesNotMatch(text, /[A-Z]/);
  assert.match(text, /alpha task/);
  assert.match(text, /"kind":"story"/);
  assert.match(text, /"tags":\["one","two"\]/);
  assert.match(text, /body token/);
});

test('query -- nested parentheses and implicit AND compose correctly', () => {
  const ast = parseTaskQuery('(status == new title == Alpha) or priority == high');
  const task = makeTask({ frontmatter: { status: 'new', priority: 'low' }, title: 'Alpha' });

  assert.equal(ast.type, 'or');
  assert.equal(ast.left.type, 'and');
  assert.equal(matchesTaskQuery(task, '(status == new title == Alpha) or priority == high'), true);
});

test('query -- rejects dangling operators and missing closing parentheses', () => {
  assert.throws(() => parseTaskQuery('title == Alpha and'), /Expected field name/);
  assert.throws(() => parseTaskQuery('(status == new'), /Expected rparen/);
});

test('query -- special fields, arrays, and unknown fields compare predictably', () => {
  const task = makeTask({
    title: 'Example',
    frontmatter: { tags: ['alpha', 'beta'], status: 'new' }
  });

  assert.equal(matchesTaskQuery(task, 'id == TASK-0001'), true);
  assert.equal(matchesTaskQuery(task, 'title == Example'), true);
  assert.equal(matchesTaskQuery(task, 'tags == "alpha, beta"'), true);
  assert.equal(matchesTaskQuery(task, 'nonexistent != value'), true);
});

test('list -- warns once for repeated unknown columns and still renders known ones', async () => {
  await withTasksDir(async (tasksDir) => {
    await writeTaskFile(tasksDir, { id: 'TASK-0001', title: 'Alpha', status: 'new', priority: 'high' });
    const config: TaskConfig = {
      tasksDir: '.tasks',
      fields: [{ name: 'id', generated: '$ID' }, { name: 'title' }],
      views: {
        Broken: { filter: 'title == Alpha', columns: ['missing', 'missing', 'title'], sort: [] }
      }
    };

    const output = await listTasks(tasksDir, config, '', 'Broken');

    assert.equal((output.match(/Warning: column "missing"/g) ?? []).length, 1);
    assert.match(output, /missing\s+missing\s+title/);
    assert.match(output, /Alpha/);
  });
});

test('list -- unknown view names fall back to the configured field list', async () => {
  await withTasksDir(async (tasksDir) => {
    await writeTaskFile(tasksDir, { id: 'TASK-0001', title: 'Alpha', status: 'new' });
    const config: TaskConfig = {
      tasksDir: '.tasks',
      fields: [{ name: 'id', generated: '$ID' }, { name: 'title' }, { name: 'status' }],
      views: {}
    };

    const output = await listTasks(tasksDir, config, '', 'Missing View');

    assert.match(output, /id\s+title\s+status/);
    assert.match(output, /Alpha/);
  });
});

test('update -- applies tag splitting, preserves body, and refreshes updated_at', async () => {
  await withTasksDir(async (tasksDir) => {
    const today = todayIsoDate();
    const config: TaskConfig = {
      tasksDir: '.tasks',
      fields: [
        { name: 'id', generated: '$ID' },
        { name: 'status', options: [{ label: 'New', value: 'new' }, { label: 'Done', value: 'done' }], default: 'new' },
        { name: 'tags' },
        { name: 'summary' },
        { name: 'updated_at', generated: '$UPDATED_AT' }
      ],
      views: {}
    };

    const body = ['# Problem', '', 'Keep this body.'].join('\n');
    await writeTaskFile(tasksDir, { id: 'TASK-0001', title: 'Alpha', status: 'new', tags: [] }, body);

    const filePath = await updateTask(tasksDir, config, 'TASK-0001', {
      status: 'done',
      tags: 'alpha, beta',
      summary: 'Updated summary'
    });
    const raw = await readFile(filePath, 'utf8');

    assert.match(raw, /status: done/);
    assert.match(raw, /tags:\n  - alpha\n  - beta/);
    assert.match(raw, /summary: Updated summary/);
    assert.match(raw, new RegExp(`updated_at: ${today}`));
    assert.match(raw, /Keep this body\./);
  });
});

test('update -- rejects invalid selectable values and leaves the task file intact', async () => {
  await withTasksDir(async (tasksDir) => {
    const config: TaskConfig = {
      tasksDir: '.tasks',
      fields: [
        { name: 'id', generated: '$ID' },
        { name: 'status', options: [{ label: 'New', value: 'new' }, { label: 'Done', value: 'done' }], default: 'new' },
        { name: 'updated_at', generated: '$UPDATED_AT' }
      ],
      views: {}
    };

    const filePath = await writeTaskFile(tasksDir, { id: 'TASK-0001', title: 'Alpha', status: 'new' });
    await assert.rejects(() => updateTask(tasksDir, config, 'TASK-0001', { status: 'invalid' }), /Invalid status/);

    const raw = await readFile(filePath, 'utf8');
    assert.match(raw, /status: new/);
    assert.doesNotMatch(raw, /status: invalid/);
  });
});

test('completion -- filters by prefix and sorts suggestions', () => {
  const config: TaskConfig = {
    tasksDir: '.tasks',
    fields: [],
    views: {
      Zebra: { filter: 'status == new', columns: [], sort: [] },
      Alpha: { filter: 'status == done', columns: [], sort: [] },
      Bravo: { filter: 'status == blocked', columns: [], sort: [] }
    }
  };

  assert.deepEqual(getCompletionSuggestions(config, 'view-name', 'a'), ['Alpha']);
  assert.deepEqual(getCompletionSuggestions(config, 'view-rm', 'b'), ['Bravo']);
  assert.deepEqual(getCompletionSuggestions(config, 'unknown', 'a'), []);
});

test('validate -- reports missing generated fields and invalid selectable values together', async () => {
  await withTasksDir(async (tasksDir) => {
    const config: TaskConfig = {
      tasksDir: '.tasks',
      fields: [
        { name: 'id', generated: '$ID' },
        { name: 'created_at', generated: '$CREATED_AT' },
        { name: 'status', options: [{ label: 'New', value: 'new' }, { label: 'Done', value: 'done' }], default: 'new' },
        { name: 'priority', options: [{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }], default: 'low' },
        { name: 'title' }
      ],
      views: {}
    };

    await writeTaskFile(tasksDir, { title: 'Alpha', status: 'bad', priority: 'high' });
    const issues = await validateTasks(tasksDir, config);

    assert.ok(issues.some((issue) => issue.message.includes('Missing required fields')));
    assert.ok(issues.some((issue) => issue.message.includes('Invalid status')));
  });
});
