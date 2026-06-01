import fs from 'node:fs/promises';
import path from 'node:path';

import type { TaskConfig } from './config.js';
import { resolveTasksDirForWrite } from './config.js';
import {
  buildNewTaskFrontmatter,
  buildTaskBody,
  discoverTaskFiles,
  nextTaskId,
  readTaskFile,
  stringifyTaskFile,
  taskFileName,
  type NewTaskInput
} from './task.js';

export async function createTask(
  tasksDir: string,
  config: TaskConfig,
  input: NewTaskInput,
  options: { cwd?: string } = {}
): Promise<string> {
  const safeTasksDir = await resolveTasksDirForWrite(options.cwd ?? process.cwd(), tasksDir);
  await fs.mkdir(safeTasksDir, { recursive: true });
  const maxAttempts = 8;
  const collisionIds = new Set<string>();

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const existingFiles = await discoverTaskFiles(safeTasksDir, { trusted: true });
    const existingTasks = await Promise.all(existingFiles.map(async (filePath) => readTaskFile(filePath, { tasksDir: safeTasksDir })));
    const id = nextTaskId([
      ...existingTasks,
      ...Array.from(collisionIds).map((collisionId) => ({ id: collisionId }))
    ]);

    try {
      const frontmatter = buildNewTaskFrontmatter(config, {
        id,
        title: input.title,
        fields: input.fields
      });

      const fileName = taskFileName(id, input.title);
      const filePath = path.join(safeTasksDir, fileName);
      const raw = stringifyTaskFile({
        frontmatter,
        body: buildTaskBody()
      });

      await fs.writeFile(filePath, `${raw.endsWith('\n') ? raw : `${raw}\n`}`, { encoding: 'utf8', flag: 'wx' });
      return filePath;
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        collisionIds.add(id);
        await waitForNextAttempt(attempt);
        continue;
      }
      throw error;
    }
  }

  throw new Error('Unable to allocate a task ID after several attempts.');
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'EEXIST';
}

async function waitForNextAttempt(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, Math.min(50, 5 * (attempt + 1))));
}
