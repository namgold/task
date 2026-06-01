import path from 'node:path';

import type { FieldConfig, TaskConfig } from './config.js';
import { discoverTaskFiles, readTaskFile } from './task.js';

export interface ValidationIssue {
  filePath: string;
  message: string;
}

export async function validateTasks(tasksDir: string, config: TaskConfig): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const files = await discoverTaskFiles(tasksDir);
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
      .filter((field) => field.generated && !(field.name in task.frontmatter))
      .map((field) => field.name);
    if (missingGeneratedFields.length > 0) {
      issues.push({ filePath, message: `Missing required fields: ${missingGeneratedFields.join(', ')}` });
    }

    if (task.body.trim().length === 0) {
      issues.push({ filePath, message: 'Markdown body is empty' });
    }

    if (!task.fileName.startsWith(`${task.id}`) || !task.fileName.endsWith('.md')) {
      issues.push({ filePath, message: 'Filename does not roughly match task ID' });
    }

    if (task.id && ids.has(task.id)) {
      issues.push({
        filePath,
        message: `Duplicate task ID ${task.id} also used by ${path.basename(ids.get(task.id) ?? '')}`
      });
    } else if (task.id) {
      ids.set(task.id, filePath);
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
