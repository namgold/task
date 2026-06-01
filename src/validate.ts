import path from 'node:path';

import type { FieldConfig, TaskConfig } from './config.js';
import { discoverTaskFiles, readTaskFile, type TaskPathOptions } from './task.js';

export interface ValidationIssue {
  filePath: string;
  message: string;
}

export async function validateTasks(
  tasksDir: string,
  config: TaskConfig,
  options: TaskPathOptions = {}
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  let files: string[];
  try {
    files = await discoverTaskFiles(tasksDir, options);
  } catch (error) {
    return [
      {
        filePath: tasksDir,
        message: error instanceof Error ? error.message : String(error)
      }
    ];
  }
  const ids = new Map<string, string>();

  for (const filePath of files) {
    let task;
    try {
      task = await readTaskFile(filePath);
    } catch (error) {
      issues.push({
        filePath,
        message: `YAML/frontmatter parse failed: ${error instanceof Error ? error.message : String(error)}`
      });
      continue;
    }

    const missingGeneratedFields = config.fields
      .filter((field) => field.generated && !hasNonEmptyString(task.frontmatter[field.name]))
      .map((field) => field.name);
    if (missingGeneratedFields.length > 0) {
      issues.push({ filePath, message: `Missing required fields: ${missingGeneratedFields.join(', ')}` });
    }

    if (task.body.trim().length === 0) {
      issues.push({ filePath, message: 'Markdown body is empty' });
    }

    if (!isValidTaskId(task.id) || !task.fileName.toUpperCase().startsWith(`${normalizeTaskId(task.id)}`) || !task.fileName.endsWith('.md')) {
      issues.push({ filePath, message: 'Filename does not roughly match task ID' });
    }

    const normalizedId = normalizeTaskId(task.id);
    if (isValidTaskId(task.id) && ids.has(normalizedId)) {
      issues.push({
        filePath,
        message: `Duplicate task ID ${normalizedId} also used by ${path.basename(ids.get(normalizedId) ?? '')}`
      });
    } else if (isValidTaskId(task.id)) {
      ids.set(normalizedId, filePath);
    }

    for (const field of config.fields) {
      validateSelectableField(filePath, task.frontmatter[field.name], field, issues);
    }
  }

  return issues;
}

function validateSelectableField(
  filePath: string,
  value: unknown,
  field: FieldConfig,
  issues: ValidationIssue[]
): void {
  if (typeof value !== 'string' || value === '') {
    return;
  }

  if (!field.options?.length) {
    return;
  }

  if (!field.options.some((option) => option.value === value)) {
    issues.push({ filePath, message: `Invalid ${field.name}: ${value}` });
  }
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidTaskId(value: string): boolean {
  return /^TASK-\d{4,}$/i.test(value.trim());
}

function normalizeTaskId(value: string): string {
  return value.trim().toUpperCase();
}
