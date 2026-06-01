import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  slugify,
  taskFileName,
  nextTaskId,
  getTaskFieldValue,
  setFrontmatterField,
  buildNewTaskFrontmatter,
  stringifyTaskFile,
  flattenTaskSearchText,
  normalizeId,
  formatTaskRowWithFields,
  todayIsoDate,
} from '../src/task.js';
import type { TaskFile } from '../src/task.js';
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
    ...overrides,
  };
}

// --- slugify ---

test('slugify -- lowercases and hyphenates spaces', () => {
  assert.equal(slugify('Fix Websocket Reconnect'), 'fix-websocket-reconnect');
});

test('slugify -- empty string returns empty string', () => {
  assert.equal(slugify(''), '');
});

test('slugify -- strips non-word characters', () => {
  assert.equal(slugify('foo!bar'), 'foobar');
});

test('slugify -- collapses multiple spaces and underscores to single dash', () => {
  assert.equal(slugify('foo  bar__baz'), 'foo-bar-baz');
});

test('slugify -- strips leading and trailing dashes from surrounding spaces', () => {
  assert.equal(slugify('  hello  '), 'hello');
});

test('slugify -- normalizes unicode accents', () => {
  assert.equal(slugify('Héllo'), 'hello');
});

test('slugify -- all-special characters returns empty string', () => {
  assert.equal(slugify('!!!'), '');
});

// --- taskFileName ---

test('taskFileName -- combines id and slugified title', () => {
  assert.equal(taskFileName('TASK-0001', 'Fix websocket bug'), 'TASK-0001-fix-websocket-bug.md');
});

test('taskFileName -- empty title produces id-only filename', () => {
  assert.equal(taskFileName('TASK-0001', ''), 'TASK-0001.md');
});

test('taskFileName -- all-special title produces id-only filename', () => {
  assert.equal(taskFileName('TASK-0001', '!!!'), 'TASK-0001.md');
});

// --- nextTaskId ---

test('nextTaskId -- empty list returns TASK-0001', () => {
  assert.equal(nextTaskId([]), 'TASK-0001');
});

test('nextTaskId -- returns one more than the highest id', () => {
  assert.equal(nextTaskId([makeTask({ id: 'TASK-0003' }), makeTask({ id: 'TASK-0001' })]), 'TASK-0004');
});

test('nextTaskId -- pads result to at least four digits', () => {
  assert.equal(nextTaskId([makeTask({ id: 'TASK-0001' })]), 'TASK-0002');
});

test('nextTaskId -- handles ids beyond four digits', () => {
  assert.equal(nextTaskId([makeTask({ id: 'TASK-9999' })]), 'TASK-10000');
});

test('nextTaskId -- skips non-matching id formats', () => {
  assert.equal(nextTaskId([makeTask({ id: 'NOT-A-TASK' })]), 'TASK-0001');
});

// --- normalizeId ---

test('normalizeId -- uppercases and trims', () => {
  assert.equal(normalizeId('  task-0001  '), 'TASK-0001');
});

test('normalizeId -- already normalized string is unchanged', () => {
  assert.equal(normalizeId('TASK-0001'), 'TASK-0001');
});

// --- getTaskFieldValue ---

test('getTaskFieldValue -- "id" key returns task.id', () => {
  assert.equal(getTaskFieldValue(makeTask({ id: 'TASK-0042' }), 'id'), 'TASK-0042');
});

test('getTaskFieldValue -- "title" key returns task.title', () => {
  assert.equal(getTaskFieldValue(makeTask({ title: 'My Task' }), 'title'), 'My Task');
});

test('getTaskFieldValue -- missing frontmatter field returns empty string', () => {
  assert.equal(getTaskFieldValue(makeTask({ frontmatter: {} }), 'nonexistent'), '');
});

test('getTaskFieldValue -- null frontmatter field returns empty string', () => {
  assert.equal(getTaskFieldValue(makeTask({ frontmatter: { status: null } }), 'status'), '');
});

test('getTaskFieldValue -- Date field returns ISO string', () => {
  const date = new Date('2026-06-01T00:00:00.000Z');
  const result = getTaskFieldValue(makeTask({ frontmatter: { due: date } }), 'due');
  assert.equal(result, date.toISOString());
});

test('getTaskFieldValue -- array field joins values with comma-space', () => {
  assert.equal(getTaskFieldValue(makeTask({ frontmatter: { tags: ['alpha', 'beta'] } }), 'tags'), 'alpha, beta');
});

test('getTaskFieldValue -- numeric field is stringified', () => {
  assert.equal(getTaskFieldValue(makeTask({ frontmatter: { count: 42 } }), 'count'), '42');
});

// --- setFrontmatterField ---

test('setFrontmatterField -- tags value is split by comma into array', () => {
  const result = setFrontmatterField({}, 'tags', 'alpha,beta');
  assert.deepEqual(result.tags, ['alpha', 'beta']);
});

test('setFrontmatterField -- tags trims whitespace from each entry', () => {
  const result = setFrontmatterField({}, 'tags', '  alpha , beta  ');
  assert.deepEqual(result.tags, ['alpha', 'beta']);
});

test('setFrontmatterField -- empty tags value produces empty array', () => {
  const result = setFrontmatterField({}, 'tags', '');
  assert.deepEqual(result.tags, []);
});

test('setFrontmatterField -- non-tags field is set verbatim and other keys are preserved', () => {
  const result = setFrontmatterField({ existing: 'x' }, 'status', 'done');
  assert.equal(result.status, 'done');
  assert.equal(result.existing, 'x');
});

// --- buildNewTaskFrontmatter ---

const testConfig: TaskConfig = {
  tasksDir: '.tasks',
  fields: [
    { name: 'id', generated: '$ID' },
    { name: 'status', options: [{ label: 'New', value: 'new' }, { label: 'Done', value: 'done' }], default: 'new' },
    { name: 'created_at', generated: '$CREATED_AT' },
    { name: 'updated_at', generated: '$UPDATED_AT' },
    { name: 'summary' },
    { name: 'title' },
  ],
  views: {}
};

test('buildNewTaskFrontmatter -- generated $ID field is set from input', () => {
  const fm = buildNewTaskFrontmatter(testConfig, { id: 'TASK-0007', title: 'Test' });
  assert.equal(fm.id, 'TASK-0007');
});

test('buildNewTaskFrontmatter -- generated date fields are set to today', () => {
  const today = todayIsoDate();
  const fm = buildNewTaskFrontmatter(testConfig, { id: 'TASK-0001', title: 'Test' });
  assert.equal(fm.created_at, today);
  assert.equal(fm.updated_at, today);
});

test('buildNewTaskFrontmatter -- field with default uses default when no explicit value', () => {
  const fm = buildNewTaskFrontmatter(testConfig, { id: 'TASK-0001', title: 'Test' });
  assert.equal(fm.status, 'new');
});

test('buildNewTaskFrontmatter -- explicit field value overrides default', () => {
  const fm = buildNewTaskFrontmatter(testConfig, { id: 'TASK-0001', title: 'Test', fields: { status: 'done' } });
  assert.equal(fm.status, 'done');
});

test('buildNewTaskFrontmatter -- field with options normalizes the value', () => {
  const fm = buildNewTaskFrontmatter(testConfig, { id: 'TASK-0001', title: 'Test', fields: { status: 'Done' } });
  assert.equal(fm.status, 'done');
});

test('buildNewTaskFrontmatter -- field without default or explicit value gets empty string', () => {
  const fm = buildNewTaskFrontmatter(testConfig, { id: 'TASK-0001', title: 'Test' });
  assert.equal(fm.summary, '');
});

test('buildNewTaskFrontmatter -- duplicate field names use the last definition', () => {
  const config: TaskConfig = {
    tasksDir: '.tasks',
    fields: [
      { name: 'status', default: 'new' },
      { name: 'custom field', default: 'alpha' },
      { name: 'status', default: 'done' }
    ],
    views: {}
  };

  const fm = buildNewTaskFrontmatter(config, { id: 'TASK-0001', title: 'Test' });
  assert.equal(fm.status, 'done');
  assert.equal(fm['custom field'], 'alpha');
});

// --- stringifyTaskFile ---

test('stringifyTaskFile -- wraps frontmatter in YAML delimiters with body', () => {
  const result = stringifyTaskFile({ frontmatter: { id: 'TASK-0001', title: 'My task' }, body: '\n# Body\n' });
  assert.match(result, /^---\n/);
  assert.match(result, /id: TASK-0001/);
  assert.match(result, /title: My task/);
  assert.match(result, /---\n\n# Body\n$/);
});

test('stringifyTaskFile -- empty string values are serialized without quotes', () => {
  const result = stringifyTaskFile({ frontmatter: { assignee: '' }, body: '' });
  assert.match(result, /^assignee:$/m);
  assert.doesNotMatch(result, /assignee: ''/);
  assert.doesNotMatch(result, /assignee: ""/);
});

test('stringifyTaskFile -- preserves body verbatim', () => {
  const body = '\n# Problem\n\nSome details here.\n';
  const result = stringifyTaskFile({ frontmatter: { id: 'TASK-0001' }, body });
  assert.ok(result.endsWith(body));
});

test('stringifyTaskFile -- preserves unusual frontmatter keys', () => {
  const result = stringifyTaskFile({
    frontmatter: {
      id: 'TASK-0001',
      'custom field': 'alpha',
      'system-schema': 'beta'
    },
    body: ''
  });

  assert.match(result, /custom field: alpha/);
  assert.match(result, /system-schema: beta/);
});

// --- flattenTaskSearchText ---

test('flattenTaskSearchText -- lowercases all content', () => {
  const task = makeTask({ id: 'TASK-0001', title: 'My Task', frontmatter: { status: 'New' }, body: 'BODY CONTENT' });
  const text = flattenTaskSearchText(task);
  assert.doesNotMatch(text, /[A-Z]/);
});

test('flattenTaskSearchText -- includes id, title, frontmatter values, and body', () => {
  const task = makeTask({
    id: 'TASK-0001',
    title: 'unique-title',
    frontmatter: { summary: 'unique-summary' },
    body: 'unique-body'
  });
  const text = flattenTaskSearchText(task);
  assert.match(text, /task-0001/);
  assert.match(text, /unique-title/);
  assert.match(text, /unique-summary/);
  assert.match(text, /unique-body/);
});

// --- formatTaskRowWithFields ---

test('formatTaskRowWithFields -- extracts fields in given order', () => {
  const task = makeTask({ id: 'TASK-0001', title: 'My Task', frontmatter: { status: 'new' } });
  assert.deepEqual(formatTaskRowWithFields(task, ['id', 'status', 'title']), ['TASK-0001', 'new', 'My Task']);
});

test('formatTaskRowWithFields -- missing frontmatter fields produce empty strings', () => {
  const task = makeTask({ id: 'TASK-0001', title: 'Task', frontmatter: {} });
  assert.deepEqual(formatTaskRowWithFields(task, ['id', 'missing']), ['TASK-0001', '']);
});
