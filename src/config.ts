import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';

const fieldSpecSchema = z
  .union([
    z.literal('$ID'),
    z.literal('$CREATED_AT'),
    z.literal('$UPDATED_AT'),
    z
      .object({
        options: z.array(z.string().min(1)).min(1).optional(),
        default: z.string().min(1).optional()
      })
      .strict()
      .refine((value) => value.options !== undefined || value.default !== undefined, {
        message: 'field spec must include options or default'
      })
  ])
  .describe('field spec');

const fieldEntrySchema = z
  .union([
    z.string().min(1),
    z.record(fieldSpecSchema).superRefine((record, ctx) => {
      const keys = Object.keys(record);
      if (keys.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'field entries must contain exactly one field name'
        });
      }
    })
  ])
  .describe('field entry');

const sortSpecSchema = z.union([z.record(z.string().min(1)), z.array(z.record(z.string().min(1)))]);

const viewSpecSchema = z
  .object({
    filter: z.string().min(1),
    columns: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
    sort: sortSpecSchema.optional()
  })
  .passthrough();

const viewEntrySchema = z
  .record(viewSpecSchema)
  .superRefine((record, ctx) => {
    const keys = Object.keys(record);
    if (keys.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'view entries must contain exactly one view name'
      });
    }
  });

export interface SortSpec {
  field: string;
  direction: 'ascending' | 'descending';
}

export interface FieldOption {
  label: string;
  value: string;
}

export interface FieldConfig {
  name: string;
  default?: string;
  options?: FieldOption[];
  generated?: '$ID' | '$CREATED_AT' | '$UPDATED_AT';
}

export interface ViewConfig {
  filter: string;
  columns: string[];
  sort: SortSpec[];
}

export interface TaskConfig {
  tasksDir: string;
  fields: FieldConfig[];
  views: Record<string, ViewConfig>;
}

export function resolveTasksDir(cwd: string, tasksDir: string): string {
  const resolved = path.resolve(cwd, tasksDir);
  const relative = path.relative(cwd, resolved);

  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolved;
  }

  throw new Error(`Configured tasks_dir must stay within the current workspace: ${tasksDir}`);
}

export async function resolveTasksDirWithinWorkspace(cwd: string, tasksDir: string): Promise<string> {
  const resolved = resolveTasksDir(cwd, tasksDir);
  const realWorkspace = await fs.realpath(cwd);
  const realTarget = await realpathForPossiblyMissingPath(resolved);

  if (isContainedPath(realWorkspace, realTarget)) {
    return resolved;
  }

  throw new Error(`Configured tasks_dir must stay within the current workspace: ${tasksDir}`);
}

export async function resolveTasksDirForWrite(cwd: string, tasksDir: string): Promise<string> {
  return resolveTasksDirWithinWorkspace(cwd, tasksDir);
}

export async function assertPathWithinDirectory(rootPath: string, targetPath: string, message: string): Promise<void> {
  const realRoot = await fs.realpath(rootPath);
  const realTarget = await fs.realpath(targetPath);

  if (!isContainedPath(realRoot, realTarget)) {
    throw new Error(message);
  }
}

const configFileSchema = z
  .object({
    tasks: z
      .object({
        tasks_dir: z.string().optional(),
        fields: z.array(fieldEntrySchema).optional(),
        views: z.array(viewEntrySchema).optional()
      })
      .passthrough()
      .optional(),
    tasks_dir: z.string().optional(),
    fields: z.array(fieldEntrySchema).optional(),
    view: z.record(viewSpecSchema).optional(),
    views: z.union([z.array(viewEntrySchema), z.record(viewSpecSchema)]).optional()
  })
  .passthrough();

export const defaultTaskConfig: TaskConfig = {
  tasksDir: '.tasks',
  fields: [
    { name: 'id', generated: '$ID' },
    {
      name: 'status',
      options: [
        { label: 'New', value: 'new' },
        { label: 'Brainstorming', value: 'brainstorming' },
        { label: 'Pending Review', value: 'pending_review' },
        { label: 'Need Revision', value: 'need_revision' },
        { label: 'Approved', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
        { label: 'Implementing', value: 'implementing' },
        { label: 'Done', value: 'done' },
        { label: 'Blocked', value: 'blocked' }
      ],
      default: 'new'
    },
    {
      name: 'priority',
      options: [
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium' },
        { label: 'High', value: 'high' },
        { label: 'Critical', value: 'critical' }
      ],
      default: 'medium'
    },
    {
      name: 'type',
      options: [
        { label: 'Bug', value: 'bug' },
        { label: 'Feature', value: 'feature' },
        { label: 'Enhancement', value: 'enhancement' },
        { label: 'UX', value: 'ux' },
        { label: 'Chore', value: 'chore' },
        { label: 'Idea', value: 'idea' }
      ],
      default: 'idea'
    },
    { name: 'assignee' },
    { name: 'title', default: 'Idea Title' },
    { name: 'description' },
    { name: 'pr' },
    { name: 'created_at', generated: '$CREATED_AT' },
    { name: 'updated_at', generated: '$UPDATED_AT' },
    { name: 'summary' }
  ],
  views: {
    'Open Tasks': {
      filter: '(status != done && status != blocked && status != rejected)',
      columns: ['status', 'priority', 'summary', 'description'],
      sort: []
    },
    'High priority': {
      filter: '(status != done && status != blocked && status != rejected && (priority == high || priority == critical))',
      columns: ['status', 'priority', 'summary', 'description'],
      sort: [
        { field: 'priority', direction: 'descending' },
        { field: 'status', direction: 'ascending' }
      ]
    }
  }
};

export async function loadConfig(cwd = process.cwd()): Promise<TaskConfig> {
  const document = await readTaskrcDocument(cwd);
  if (!document) {
    return cloneDefaultTaskConfig();
  }
  return taskConfigFromDocument(document);
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT';
}

export async function readTaskrcDocument(cwd = process.cwd()): Promise<Record<string, unknown> | null> {
  const configPath = path.join(cwd, '.taskrc.yml');

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    return configFileSchema.parse(YAML.parse(raw) ?? {});
  } catch (error) {
    if (isFileNotFound(error)) {
      return null;
    }

    if (error instanceof z.ZodError) {
      throw new Error(`Invalid .taskrc.yml: ${error.issues.map((issue) => issue.message).join('; ')}`);
    }

    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function writeTaskrcDocument(cwd: string, document: Record<string, unknown>): Promise<void> {
  const configPath = path.join(cwd, '.taskrc.yml');
  const yaml = YAML.stringify(document, { lineWidth: 0 });
  await fs.writeFile(configPath, yaml.endsWith('\n') ? yaml : `${yaml}\n`, 'utf8');
}

export function taskConfigFromDocument(document: Record<string, unknown>): TaskConfig {
  const taskDocument = objectValue(document.tasks) ?? document;
  const views = recordOfViews(taskDocument.views ?? document.views ?? document.view);
  return {
    tasksDir: stringValue(taskDocument.tasks_dir ?? document.tasks_dir) || defaultTaskConfig.tasksDir,
    fields: normalizeFieldDefinitions(taskDocument.fields ?? document.fields),
    views
  };
}

export function buildTaskrcDocument(config: TaskConfig, existing: Record<string, unknown> = {}): Record<string, unknown> {
  const extras = stripLegacyTaskrcKeys(existing);
  return {
    ...extras,
    tasks_dir: config.tasksDir,
    fields: buildFieldDocument(config.fields),
    views: buildViewDocument(config.views)
  };
}

function cloneDefaultTaskConfig(): TaskConfig {
  return {
    tasksDir: defaultTaskConfig.tasksDir,
    fields: defaultTaskConfig.fields.map((field) => cloneFieldConfig(field)),
    views: { ...defaultTaskConfig.views }
  };
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function cloneFieldConfig(field: FieldConfig): FieldConfig {
  return {
    name: field.name,
    default: field.default,
    generated: field.generated,
    options: field.options?.map((option) => ({ ...option }))
  };
}

function normalizeFieldDefinitions(value: unknown): FieldConfig[] {
  if (!Array.isArray(value)) {
    return defaultTaskConfig.fields.map((field) => cloneFieldConfig(field));
  }

  const result: FieldConfig[] = [];
  for (const entry of value) {
    const field = normalizeFieldDefinition(entry);
    if (field) {
      result.push(field);
    }
  }
  return result.length > 0 ? result : defaultTaskConfig.fields.map((field) => cloneFieldConfig(field));
}

function normalizeFieldDefinition(value: unknown): FieldConfig | null {
  if (typeof value === 'string') {
    return { name: value.trim() };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const [name, spec] = Object.entries(record)[0] ?? [];
  const normalizedName = normalizeFieldName(name);

  if (!normalizedName) {
    return null;
  }

  if (typeof spec === 'string') {
    return normalizeGeneratedField(normalizedName, spec);
  }

  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return { name: normalizedName };
  }

  const specRecord = spec as Record<string, unknown>;
  const options = normalizeFieldOptions(specRecord.options);
  const defaultValue = stringValue(specRecord.default).trim();

  return {
    name: normalizedName,
    options: options.length > 0 ? options : undefined,
    default: defaultValue ? defaultValue : undefined
  };
}

function normalizeGeneratedField(name: string, value: string): FieldConfig {
  const normalizedValue = value.trim().toUpperCase();
  if (normalizedValue === '$ID' || normalizedValue === '$CREATED_AT' || normalizedValue === '$UPDATED_AT') {
    return { name, generated: normalizedValue as FieldConfig['generated'] };
  }

  return { name, default: value };
}

function normalizeFieldName(value: unknown): string {
  return stringValue(value).trim();
}

function normalizeFieldOptions(value: unknown): FieldOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => stringValue(entry).trim())
    .filter(Boolean)
    .map((label) => ({ label, value: label }));
}

function buildFieldDocument(fields: FieldConfig[]): unknown[] {
  return fields.map((field) => {
    if (field.generated) {
      return { [field.name]: field.generated };
    }

    if ((field.options?.length ?? 0) > 0 || field.default !== undefined) {
      const spec: Record<string, unknown> = {};
      if ((field.options?.length ?? 0) > 0) {
        spec.options = field.options?.map((option) => option.label) ?? [];
      }
      const defaultValue = displaySelectableValue(field, field.default);
      if (defaultValue !== undefined) {
        spec.default = defaultValue;
      }
      return { [field.name]: spec };
    }

    return field.name;
  });
}

function recordOfViews(value: unknown): Record<string, ViewConfig> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const result: Record<string, ViewConfig> = {};
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const [name, config] = Object.entries(record)[0] ?? [];
      const view = normalizeViewConfig(config);
      if (name && view) {
        result[name] = view;
      }
    }
    return result;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const view = normalizeViewConfig(entry);
    if (view) {
      result[key] = view;
    }
  }
  return result;
}

function normalizeViewConfig(value: unknown): ViewConfig | null {
  if (typeof value === 'string') {
    return { filter: value, columns: [], sort: [] };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const filter = stringValue(record.filter ?? record.Filter ?? '');
  if (!filter) {
    return null;
  }

  return {
    filter,
    columns: normalizeColumns(record.columns ?? record.Columns),
    sort: normalizeSortSpec(record.sort ?? record.Sort)
  };
}

function normalizeColumns(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => stringValue(entry).trim()).filter(Boolean);
  }

  const text = stringValue(value).trim();
  if (!text) {
    return [];
  }

  return text
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeSortSpec(value: unknown): SortSpec[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return [];
      }
      const record = entry as Record<string, unknown>;
      const field = stringValue(record.field ?? record.Field);
      if (!field) {
        const [singleField, singleDirection] = Object.entries(record)[0] ?? [];
        if (!singleField) {
          return [];
        }
        return [{ field: String(singleField).trim(), direction: normalizeDirection(singleDirection) }];
      }
      return [{ field, direction: normalizeDirection(record.direction ?? record.Direction) }];
    });
  }

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([field, direction]) => {
      const normalizedField = String(field).trim();
      if (!normalizedField) {
        return [];
      }
      return [{ field: normalizedField, direction: normalizeDirection(direction) }];
    });
  }

  return [];
}

function normalizeDirection(value: unknown): 'ascending' | 'descending' {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'ascending' || text === 'asc') {
    return 'ascending';
  }
  if (text === 'descending' || text === 'desc') {
    return 'descending';
  }
  throw new Error(`Invalid sort direction: ${String(value)}`);
}

function buildViewDocument(views: Record<string, ViewConfig>): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  for (const [name, view] of Object.entries(views)) {
    const entry: Record<string, unknown> = { filter: view.filter };
    if (view.columns.length > 0) {
      entry.columns = view.columns.join(', ');
    }
    if (view.sort.length > 0) {
      entry.sort = view.sort.map((item) => ({ [item.field]: item.direction }));
    }
    result.push({ [name]: entry });
  }
  return result;
}

function stripLegacyTaskrcKeys(document: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (['tasks', 'view', 'statuses', 'priorities', 'types', 'default_assignee'].includes(key)) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

function displaySelectableValue(field: FieldConfig, value: string | undefined): string | undefined {
  if (value === undefined || !field.options?.length) {
    return value;
  }

  const match = field.options.find((option) => option.value === value);
  return match?.label ?? value;
}

async function realpathForPossiblyMissingPath(targetPath: string): Promise<string> {
  try {
    return await fs.realpath(targetPath);
  } catch (error) {
    if (!isFileNotFound(error)) {
      throw error;
    }
  }

  const parts = path.resolve(targetPath).split(path.sep).filter(Boolean);
  let current = path.isAbsolute(targetPath) ? path.parse(targetPath).root : process.cwd();
  let index = 0;

  while (index < parts.length) {
    const next = path.join(current, parts[index]);
    try {
      const realCurrent = await fs.realpath(next);
      current = realCurrent;
      index += 1;
    } catch (error) {
      if (!isFileNotFound(error)) {
        throw error;
      }
      break;
    }
  }

  return path.resolve(current, ...parts.slice(index));
}

function isContainedPath(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
