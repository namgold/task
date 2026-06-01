import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { getCompletionSuggestions } from '../src/completion.js';
import { buildTaskrcDocument, defaultTaskConfig, loadConfig, readTaskrcDocument, taskConfigFromDocument } from '../src/config.js';
import { listTasks } from '../src/list.js';
import { createTask } from '../src/new.js';
import { matchesTaskQuery, parseTaskQuery } from '../src/query.js';
import { updateTask } from '../src/update.js';
import { validateTasks } from '../src/validate.js';
import {
  buildNewTaskFrontmatter,
  discoverTaskFiles,
  flattenTaskSearchText,
  getTaskFieldValue,
  loadTasks,
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

test('config -- loadConfig rejects invalid sort values', async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      path.join(dir, '.taskrc.yml'),
      [
        'views:',
        '  - Bad:',
        '      filter: status == new',
        '      sort:',
        '        - priority: sideways',
        ''
      ].join('\n'),
      'utf8'
    );

    await assert.rejects(() => loadConfig(dir), /Invalid sort direction/);
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

test('task -- selectable values preserve exact configured values', () => {
  const config: TaskConfig = {
    tasksDir: '.tasks',
    fields: [
      { name: 'id', generated: '$ID' },
      {
        name: 'status',
        options: [
          { label: '1. New', value: '1. New' },
          { label: '2. Done', value: '2. Done' }
        ],
        default: '2. Done'
      }
    ],
    views: {}
  };

  const explicit = buildNewTaskFrontmatter(config, { id: 'TASK-0001', title: 'Example', fields: { status: '1. New' } });
  const fallback = buildNewTaskFrontmatter(config, { id: 'TASK-0002', title: 'Example' });

  assert.equal(explicit.status, '1. New');
  assert.equal(fallback.status, '2. Done');
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

    const output = await listTasks(tasksDir, config, '', 'Broken', { trusted: true });

    assert.equal((output.match(/Warning: column "missing"/g) ?? []).length, 1);
    assert.match(output, /missing\s+missing\s+title/);
    assert.match(output, /Alpha/);
  });
});

test('list -- unknown view names throw', async () => {
  await withTasksDir(async (tasksDir) => {
    await writeTaskFile(tasksDir, { id: 'TASK-0001', title: 'Alpha', status: 'new' });
    const config: TaskConfig = {
      tasksDir: '.tasks',
      fields: [{ name: 'id', generated: '$ID' }, { name: 'title' }, { name: 'status' }],
      views: {}
    };

    await assert.rejects(() => listTasks(tasksDir, config, '', 'Missing View', { trusted: true }), /View not found/);
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
    }, { cwd: path.dirname(tasksDir) });
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
    await assert.rejects(
      () => updateTask(tasksDir, config, 'TASK-0001', { status: 'invalid' }, { cwd: path.dirname(tasksDir) }),
      /Invalid status/
    );

    const raw = await readFile(filePath, 'utf8');
    assert.match(raw, /status: new/);
    assert.doesNotMatch(raw, /status: invalid/);
  });
});

test('update -- preserves exact selectable values', async () => {
  await withTasksDir(async (tasksDir) => {
    const config: TaskConfig = {
      tasksDir: '.tasks',
      fields: [
        { name: 'id', generated: '$ID' },
        {
          name: 'status',
          options: [
            { label: '2. Pending Review', value: '2. Pending Review' },
            { label: '3. Pending Review', value: '3. Pending Review' }
          ],
          default: '2. Pending Review'
        },
        { name: 'updated_at', generated: '$UPDATED_AT' }
      ],
      views: {}
    };

    const filePath = await writeTaskFile(tasksDir, { id: 'TASK-0001', title: 'Alpha', status: '2. Pending Review' });
    await updateTask(tasksDir, config, 'TASK-0001', { status: '3. Pending Review' }, { cwd: path.dirname(tasksDir) });

    const raw = await readFile(filePath, 'utf8');
    assert.match(raw, /status: 3\. Pending Review/);
  });
});

test('new -- direct createTask rejects paths outside the workspace', async () => {
  await withTempDir(async (dir) => {
    const outside = path.join(path.dirname(dir), `${path.basename(dir)}-outside`);
    try {
      const config: TaskConfig = {
        tasksDir: '../outside',
        fields: [{ name: 'id', generated: '$ID' }, { name: 'title' }],
        views: {}
      };

      await assert.rejects(
        () => createTask(outside, config, { title: 'Outside' }, { cwd: dir }),
        /must stay within the current workspace/
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('new -- direct createTask accepts a resolved path inside the workspace', async () => {
  await withTempDir(async (dir) => {
    const tasksDir = path.join(dir, '.tasks');
    const config: TaskConfig = {
      tasksDir: '.tasks',
      fields: [{ name: 'id', generated: '$ID' }, { name: 'title' }],
      views: {}
    };

    const filePath = await createTask(tasksDir, config, { title: 'Inside' }, { cwd: dir });
    const raw = await readFile(filePath, 'utf8');
    assert.match(raw, /id: TASK-0001/);
    assert.match(path.basename(filePath), /TASK-0001-inside\.md/);
  });
});

test('new -- stale id lock files do not block future task creation', async () => {
  await withTasksDir(async (tasksDir) => {
    await writeFile(path.join(tasksDir, '.task-id-TASK-0001.lock'), 'TASK-0001', 'utf8');
    const config: TaskConfig = {
      tasksDir: '.tasks',
      fields: [{ name: 'id', generated: '$ID' }, { name: 'title' }],
      views: {}
    };

    const filePath = await createTask(tasksDir, config, { title: 'Ignores stale lock' }, { cwd: path.dirname(tasksDir) });
    assert.match(path.basename(filePath), /TASK-0001-ignores-stale-lock\.md/);
  });
});

test('new -- task-file creation collision retries with the next id', async () => {
  await withTasksDir(async (tasksDir) => {
    await writeFile(path.join(tasksDir, 'TASK-0001-collision.md'), '---\ntitle: Collision\n---\n# Body\n', 'utf8');
    const config: TaskConfig = {
      tasksDir: '.tasks',
      fields: [{ name: 'id', generated: '$ID' }, { name: 'title' }],
      views: {}
    };

    const filePath = await createTask(tasksDir, config, { title: 'Collision' }, { cwd: path.dirname(tasksDir) });
    assert.match(path.basename(filePath), /TASK-0002-collision\.md/);
    const raw = await readFile(filePath, 'utf8');
    assert.match(raw, /id: TASK-0002/);
  });
});

test('update -- direct updateTask rejects paths outside the workspace', async () => {
  await withTempDir(async (dir) => {
    const outside = path.join(path.dirname(dir), `${path.basename(dir)}-outside`);
    try {
      await mkdir(outside, { recursive: true });
      await writeTaskFile(outside, { id: 'TASK-0001', title: 'Outside', status: 'new' });
      const config: TaskConfig = {
        tasksDir: '../outside',
        fields: [{ name: 'id', generated: '$ID' }, { name: 'status' }],
        views: {}
      };

      await assert.rejects(
        () => updateTask(outside, config, 'TASK-0001', { status: 'done' }, { cwd: dir }),
        /must stay within the current workspace/
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('update -- direct updateTask rejects symlinked task files outside the workspace', async () => {
  await withTempDir(async (dir) => {
    const tasksDir = path.join(dir, '.tasks');
    const outside = path.join(os.tmpdir(), `task-edge-outside-${Date.now()}-${Math.random()}.md`);
    try {
      await mkdir(tasksDir, { recursive: true });
      await writeFile(outside, '---\nid: TASK-0001\ntitle: Outside\nstatus: new\n---\n# Body\n', 'utf8');
      await symlink(outside, path.join(tasksDir, 'TASK-0001-link.md'));
      const config: TaskConfig = {
        tasksDir: '.tasks',
        fields: [{ name: 'id', generated: '$ID' }, { name: 'status' }],
        views: {}
      };

      await assert.rejects(
        () => updateTask(tasksDir, config, 'TASK-0001', { status: 'done' }, { cwd: dir }),
        /Task file must stay within the configured tasks_dir/
      );

      const raw = await readFile(outside, 'utf8');
      assert.match(raw, /status: new/);
    } finally {
      await rm(outside, { force: true });
    }
  });
});

test('validate -- reports symlinked task files outside the workspace', async () => {
  await withTempDir(async (dir) => {
    const tasksDir = path.join(dir, '.tasks');
    const outside = path.join(os.tmpdir(), `task-edge-outside-${Date.now()}-${Math.random()}.md`);
    try {
      await mkdir(tasksDir, { recursive: true });
      await writeFile(outside, '---\nid: TASK-0001\ntitle: Outside\nstatus: new\n---\n# Body\n', 'utf8');
      await symlink(outside, path.join(tasksDir, 'TASK-0001-link.md'));
      const config: TaskConfig = {
        tasksDir: '.tasks',
        fields: [{ name: 'id', generated: '$ID' }, { name: 'status' }],
        views: {}
      };

      const issues = await validateTasks(tasksDir, config, { trusted: true });
      assert.ok(issues.some((issue) => issue.message.includes('Task file must stay within the configured tasks_dir')));
    } finally {
      await rm(outside, { force: true });
    }
  });
});

test('task loading -- loadTasks rejects outside paths when cwd is supplied', async () => {
  await withTempDir(async (dir) => {
    const outside = path.join(path.dirname(dir), `${path.basename(dir)}-outside`);
    try {
      await mkdir(outside, { recursive: true });
      await writeTaskFile(outside, { id: 'TASK-0001', title: 'Outside', status: 'new' });

      await assert.rejects(
        () => loadTasks(outside, { cwd: dir }),
        /must stay within the current workspace/
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('task loading -- discoverTaskFiles rejects outside paths when cwd is supplied', async () => {
  await withTempDir(async (dir) => {
    const outside = path.join(path.dirname(dir), `${path.basename(dir)}-outside`);
    try {
      await mkdir(outside, { recursive: true });
      await writeTaskFile(outside, { id: 'TASK-0001', title: 'Outside', status: 'new' });

      await assert.rejects(
        () => discoverTaskFiles(outside, { cwd: dir }),
        /must stay within the current workspace/
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('task loading -- direct helpers accept inside workspace paths when cwd is supplied', async () => {
  await withTempDir(async (dir) => {
    const tasksDir = path.join(dir, '.tasks');
    await mkdir(tasksDir, { recursive: true });
    await writeTaskFile(tasksDir, { id: 'TASK-0001', title: 'Inside', status: 'new' });

    const files = await discoverTaskFiles(tasksDir, { cwd: dir });
    const tasks = await loadTasks(tasksDir, { cwd: dir });

    assert.equal(files.length, 1);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, 'TASK-0001');
  });
});

test('task loading -- direct helpers require cwd or explicit trusted path', async () => {
  await withTempDir(async (dir) => {
    const tasksDir = path.join(dir, '.tasks');
    await mkdir(tasksDir, { recursive: true });

    await assert.rejects(
      () => discoverTaskFiles(tasksDir),
      /requires a workspace cwd or an explicit trusted path/
    );
    await assert.rejects(
      () => loadTasks(tasksDir),
      /requires a workspace cwd or an explicit trusted path/
    );
  });
});

test('task loading -- trusted path remains an explicit escape hatch for prevalidated callers', async () => {
  await withTempDir(async (dir) => {
    const tasksDir = path.join(dir, '.tasks');
    await mkdir(tasksDir, { recursive: true });
    await writeTaskFile(tasksDir, { id: 'TASK-0001', title: 'Trusted', status: 'new' });

    const files = await discoverTaskFiles(tasksDir, { trusted: true });
    const tasks = await loadTasks(tasksDir, { trusted: true });

    assert.equal(files.length, 1);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, 'Trusted');
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
    const issues = await validateTasks(tasksDir, config, { trusted: true });

    assert.ok(issues.some((issue) => issue.message.includes('Missing required fields')));
    assert.ok(issues.some((issue) => issue.message.includes('Invalid status')));
  });
});
