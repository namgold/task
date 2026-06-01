import fs from 'node:fs/promises';
import path from 'node:path';

import type { TaskConfig } from './config.js';
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

export async function createTask(tasksDir: string, config: TaskConfig, input: NewTaskInput): Promise<string> {
  await fs.mkdir(tasksDir, { recursive: true });
  const existingFiles = await discoverTaskFiles(tasksDir);
  const existingTasks = await Promise.all(existingFiles.map(async (filePath) => readTaskFile(filePath)));
  const id = nextTaskId(existingTasks);

  const frontmatter = buildNewTaskFrontmatter(config, {
    id,
    title: input.title,
    fields: input.fields
  });

  const fileName = taskFileName(id, input.title);
  const filePath = path.join(tasksDir, fileName);
  const raw = stringifyTaskFile({
    frontmatter,
    body: buildTaskBody()
  });

  await fs.writeFile(filePath, `${raw.endsWith('\n') ? raw : `${raw}\n`}`, 'utf8');
  return filePath;
}
