import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { stringify as stringifyYaml } from 'yaml';

import type { FieldConfig, TaskConfig } from './config.js';
import { assertPathWithinDirectory, resolveTasksDirWithinWorkspace } from './config.js';

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export interface TaskFile {
  filePath: string;
  fileName: string;
  raw: string;
  frontmatter: Record<string, unknown>;
  body: string;
  id: string;
  title: string;
}

export interface NewTaskInput {
  title: string;
  fields?: Record<string, string | undefined>;
}

export interface TaskPathOptions {
  cwd?: string;
  trusted?: boolean;
}

export function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function taskFileName(id: string, title: string): string {
  const slug = slugify(title);
  return slug ? `${id}-${slug}.md` : `${id}.md`;
}

export async function discoverTaskFiles(tasksDir: string, options: TaskPathOptions = {}): Promise<string[]> {
  const safeTasksDir = await resolveTasksDirForAccess(tasksDir, options);

  try {
    const files = await fg('TASK-*.md', {
      cwd: safeTasksDir,
      absolute: true,
      onlyFiles: true
    });
    await Promise.all(files.map((filePath) => assertTaskFilePathWithinTasksDir(safeTasksDir, filePath)));
    return files;
  } catch (error) {
    if (isMissingDirectory(error)) {
      return [];
    }
    throw error;
  }
}

export async function readTaskFile(filePath: string, options: { tasksDir?: string } = {}): Promise<TaskFile> {
  if (options.tasksDir) {
    await assertTaskFilePathWithinTasksDir(options.tasksDir, filePath);
  }

  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = matter(raw);
  const frontmatter = normalizeFrontmatter(toPlainObject(parsed.data));
  const id = inferTaskId(frontmatter);
  const title = stringValue(frontmatter.title);

  return {
    filePath,
    fileName: path.basename(filePath),
    raw,
    frontmatter,
    body: parsed.content,
    id,
    title
  };
}

export function stringifyTaskFile(task: { frontmatter: Record<string, unknown>; body: string }): string {
  const yaml = stringifyYaml(normalizeFrontmatter(task.frontmatter), { lineWidth: 0 });
  const normalizedYaml = normalizeYamlOutput(yaml.endsWith('\n') ? yaml : `${yaml}\n`);
  return `---\n${normalizedYaml}---\n${task.body}`;
}

export async function loadTasks(tasksDir: string, options: TaskPathOptions = {}): Promise<TaskFile[]> {
  const safeTasksDir = await resolveTasksDirForAccess(tasksDir, options);
  const files = await discoverTaskFiles(safeTasksDir, { trusted: true });
  const tasks = await Promise.all(files.map(async (filePath) => readTaskFile(filePath, { tasksDir: safeTasksDir })));
  return tasks.sort((left, right) => naturalCollator.compare(left.id, right.id));
}

export function flattenTaskSearchText(task: TaskFile): string {
  return [task.id, task.title, stringifyValue(task.frontmatter), task.body].join('\n').toLowerCase();
}

export function nextTaskId(tasks: Array<{ id: string }>): string {
  let maxNumber = 0;
  for (const task of tasks) {
    const match = /^TASK-(\d{4,})$/i.exec(task.id);
    if (!match) {
      continue;
    }
    maxNumber = Math.max(maxNumber, Number(match[1]));
  }

  return `TASK-${String(maxNumber + 1).padStart(4, '0')}`;
}

export function getFrontmatterField(task: TaskFile, key: string): string {
  return getTaskFieldValue(task, key);
}

export function getTaskFieldValue(task: TaskFile, key: string): string {
  if (key === 'id') {
    return task.id;
  }
  if (key === 'title') {
    return task.title;
  }

  const value = task.frontmatter[key];
  if (value === undefined || value === null) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyScalar(item)).join(', ');
  }
  return stringifyScalar(value);
}

export function setFrontmatterField(
  frontmatter: Record<string, unknown>,
  key: string,
  value: string
): Record<string, unknown> {
  if (key === 'tags') {
    return {
      ...frontmatter,
      [key]: value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    };
  }

  return {
    ...frontmatter,
    [key]: value
  };
}

export function buildNewTaskFrontmatter(
  config: TaskConfig,
  input: NewTaskInput & { id: string }
): Record<string, unknown> {
  const today = todayIsoDate();
  const frontmatter: Record<string, unknown> = {};

  for (const field of config.fields) {
    if (field.generated === '$ID') {
      frontmatter[field.name] = input.id;
      continue;
    }

    if (field.generated === '$CREATED_AT' || field.generated === '$UPDATED_AT') {
      frontmatter[field.name] = today;
      continue;
    }

    const explicitValue = input.fields?.[field.name];
    if (explicitValue !== undefined) {
      frontmatter[field.name] = normalizeFieldValue(field, explicitValue);
      continue;
    }

    if (field.default !== undefined) {
      frontmatter[field.name] = normalizeFieldValue(field, field.default);
      continue;
    }

    frontmatter[field.name] = '';
  }

  return frontmatter;
}

export function buildTaskBody(): string {
  return [
    '# Problem',
    '',
    'Describe the problem.',
    '',
    '# Proposed Solution',
    '',
    'Describe the proposed solution.',
    '',
    '# Test Plan',
    '',
    'Describe how this will be tested.',
    '',
    '# Review Notes',
    '',
    'Add review notes here.',
    '',
    '# Revision History',
    '',
    `- ${todayIsoDate()}: Created.`
  ].join('\n');
}

export function formatTaskRow(task: TaskFile): string[] {
  return formatTaskRowWithFields(task, ['id', 'status', 'priority', 'type', 'assignee', 'title']);
}

export function formatTaskRowWithFields(task: TaskFile, fields: string[]): string[] {
  return fields.map((field) => getTaskFieldValue(task, field));
}

export function normalizeId(value: string): string {
  return value.trim().toUpperCase();
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyValue(item)).join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function stringifyScalar(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function inferTaskId(frontmatter: Record<string, unknown>): string {
  const directId = stringValue(frontmatter.id);
  if (directId) {
    return directId;
  }

  for (const value of Object.values(frontmatter)) {
    if (typeof value !== 'string') {
      continue;
    }
    if (/^TASK-\d{4,}$/i.test(value.trim())) {
      return value.trim().toUpperCase();
    }
  }

  return '';
}

function normalizeFieldValue(field: FieldConfig, value: string | string[]): string | string[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (field.options?.length) {
    return value;
  }

  return value;
}

function normalizeFrontmatter(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    normalized[key] = normalizeFrontmatterValue(key, value);
  }
  return normalized;
}

function normalizeFrontmatterValue(key: string, value: unknown): unknown {
  if (value === undefined || value === null) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeFrontmatterValue(key, item));
  }

  if (typeof value === 'object') {
    return value;
  }

  return key === 'created_at' || key === 'updated_at' ? String(value).slice(0, 10) : value;
}

function normalizeYamlOutput(raw: string): string {
  return raw.replace(/: ''$/gm, ':').replace(/: ""$/gm, ':');
}

function toPlainObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isMissingDirectory(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT';
}

async function resolveTasksDirForAccess(tasksDir: string, options: TaskPathOptions): Promise<string> {
  if (options.cwd) {
    return resolveTasksDirWithinWorkspace(options.cwd, tasksDir);
  }

  if (options.trusted) {
    return path.resolve(tasksDir);
  }

  throw new Error('Task directory access requires a workspace cwd or an explicit trusted path.');
}

async function assertTaskFilePathWithinTasksDir(tasksDir: string, filePath: string): Promise<void> {
  await assertPathWithinDirectory(
    tasksDir,
    filePath,
    `Task file must stay within the configured tasks_dir: ${filePath}`
  );
}
