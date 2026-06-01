import fs from 'node:fs/promises';
import path from 'node:path';

import type { TaskConfig } from './config.js';
import { assertPathWithinDirectory, resolveTasksDirForWrite } from './config.js';
import { loadTasks, readTaskFile, setFrontmatterField, stringifyTaskFile } from './task.js';

export async function updateTask(
  tasksDir: string,
  config: TaskConfig,
  id: string,
  updates: Record<string, string>,
  options: { cwd?: string } = {}
): Promise<string> {
  const safeTasksDir = await resolveTasksDirForWrite(options.cwd ?? process.cwd(), tasksDir);
  const files = await loadTasks(safeTasksDir, { trusted: true });
  const task = files.find((entry) => entry.id === id);

  if (!task) {
    throw new Error(`Task not found: ${id}`);
  }

  let frontmatter = { ...task.frontmatter };
  for (const [key, value] of Object.entries(updates)) {
    frontmatter = setFrontmatterField(frontmatter, key, value);
  }

  validateSelectableField(config, 'status', frontmatter.status);
  validateSelectableField(config, 'priority', frontmatter.priority);
  validateSelectableField(config, 'type', frontmatter.type);

  frontmatter.updated_at = todayIsoDate();

  const raw = stringifyTaskFile({
    frontmatter,
    body: task.body
  });

  await assertPathWithinDirectory(
    safeTasksDir,
    task.filePath,
    `Task file must stay within the configured tasks_dir: ${task.filePath}`
  );
  await fs.writeFile(task.filePath, `${raw.endsWith('\n') ? raw : `${raw}\n`}`, 'utf8');
  return task.filePath;
}

function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validateSelectableField(config: TaskConfig, name: string, value: unknown): void {
  if (typeof value !== 'string' || value === '') {
    return;
  }

  const field = config.fields.find((entry) => entry.name === name);
  if (!field?.options?.length) {
    return;
  }

  if (!field.options.some((option) => option.value === value)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
}
