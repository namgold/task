#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import { Command } from 'commander';

import {
  buildTaskrcDocument,
  loadConfig,
  readTaskrcDocument,
  resolveTasksDir,
  resolveTasksDirWithinWorkspace,
  taskConfigFromDocument,
  writeTaskrcDocument
} from './config.js';
import { createTask } from './new.js';
import { listTasks } from './list.js';
import { loadTasks, normalizeId } from './task.js';
import { parseTaskQuery } from './query.js';
import { updateTask } from './update.js';
import { validateTasks } from './validate.js';
import { renderTable } from './table.js';
import {
  buildBashCompletionScript,
  buildFishCompletionScript,
  buildZshCompletionScript,
  getCompletionSuggestions
} from './completion.js';
import { countTasks } from './list.js';

const program = new Command();

program.name('task').description('Git-native, markdown-based task CLI').version('0.1.0');

program
  .command('new')
  .description('Create a new task markdown file')
  .requiredOption('--title <title>', 'task title')
  .option('--type <type>', 'task type')
  .option('--priority <priority>', 'task priority')
  .option('--status <status>', 'task status')
  .option('--assignee <assignee>', 'task assignee')
  .option('--description <description>', 'task description')
  .option('--owner <owner>', 'task owner')
  .option('--branch <branch>', 'task branch')
  .option('--pr <pr>', 'pull request reference')
  .option('--summary <summary>', 'task summary')
  .option('--field <field=value>', 'additional task field', collectValue, [])
  .action(async (options) => {
    const config = await loadConfig();
    const tasksDir = resolveTasksDir(process.cwd(), config.tasksDir);
    const extraFields = parseKeyValuePairs(options.field ?? []);
    const fields = {
      ...extraFields,
      title: options.title,
      type: options.type,
      priority: options.priority,
      status: options.status,
      assignee: options.assignee,
      description: options.description,
      summary: options.summary,
      owner: options.owner,
      branch: options.branch,
      pr: options.pr
    };

    validateConfiguredFields(config, fields);

    const filePath = await createTask(tasksDir, config, {
      title: options.title,
      fields
    });

    await writeText(process.stdout, `${formatWorkspaceRelativePath(process.cwd(), filePath)}\n`);
  });

program
  .command('list')
  .alias('ls')
  .description('List tasks in a table')
  .argument('[query...]', 'task query expression')
  .option('--view <view>', 'saved view name')
  .action(async (queryParts: string[], options: { view?: string }) => {
    const config = await loadConfig();
    const cwd = process.cwd();
    const tasksDir = await resolveTasksDirWithinWorkspace(cwd, config.tasksDir);
    const query = queryParts.join(' ').trim();
    const output = await listTasks(tasksDir, config, query, options.view, { trusted: true });
    await writeText(process.stdout, `${output}\n`);
  });

program
  .command('count')
  .description('Count matching tasks')
  .argument('[view_name...]', 'saved view name')
  .action(async (viewNameParts: string[]) => {
    const config = await loadConfig();
    const cwd = process.cwd();
    const tasksDir = await resolveTasksDirWithinWorkspace(cwd, config.tasksDir);
    const viewName = viewNameParts.join(' ').trim();
    const count = await countTasks(tasksDir, config, '', viewName || undefined, { trusted: true });
    await writeText(process.stdout, `${count}\n`);
  });

const viewCommand = program.command('view').description('Manage saved task views');

viewCommand
  .argument('[name...]', 'saved view name')
  .action(async (nameParts: string[]) => {
    if (nameParts.length === 0) {
      await writeText(process.stdout, 'Use `task view ls` to list views or `task view <name>` to show one.\n');
      return;
    }

    const name = nameParts.join(' ').trim();
    const config = await loadConfig();
    const cwd = process.cwd();
    const tasksDir = await resolveTasksDirWithinWorkspace(cwd, config.tasksDir);

    if (!Object.prototype.hasOwnProperty.call(config.views, name)) {
      throw new Error(`View not found: ${name}`);
    }

    const output = await listTasks(tasksDir, config, '', name, { trusted: true });
    await writeText(process.stdout, `${output}\n`);
  });

viewCommand
  .command('create')
  .description('Create a saved view')
  .argument('<name>', 'view name')
  .argument('[query...]', 'task query expression')
  .option('--column <field>', 'view column', collectValue, [])
  .option('--sort <field:direction>', 'sort field and direction', collectValue, [])
  .action(async (name: string, queryParts: string[], options: { column?: string[]; sort?: string[] }) => {
    const query = queryParts.join(' ').trim();
    if (!query) {
      throw new Error('View query cannot be empty.');
    }

    parseTaskQuery(query);
    const sort = parseSortSpecs(options.sort ?? []);

    const cwd = process.cwd();
    const document = (await readTaskrcDocument(cwd)) ?? {};
    const taskConfig = taskConfigFromDocument(document);
    if (Object.prototype.hasOwnProperty.call(taskConfig.views, name)) {
      throw new Error(`View already exists: ${name}`);
    }

    taskConfig.views[name] = {
      filter: query,
      columns: normalizeColumns(options.column ?? [], taskConfig.fields),
      sort
    };
    await writeTaskrcDocument(cwd, buildTaskrcDocument(taskConfig, document));
    await writeText(process.stdout, `${name}\n`);
  });

viewCommand
  .command('ls')
  .alias('list')
  .description('List saved views')
  .action(async () => {
    const config = await loadConfig();
    const rows = Object.entries(config.views).map(([name, view]) => [
      name,
      view.filter,
      view.columns.length > 0 ? view.columns.join(', ') : config.fields.map((field) => field.name).join(', '),
      formatSort(view.sort)
    ]);
    await writeText(process.stdout, `${renderTable(['name', 'filter', 'columns', 'sort'], rows, 'No views found.')}\n`);
  });

viewCommand
  .command('rm')
  .alias('remove')
  .description('Remove a saved view')
  .argument('<name>', 'view name')
  .option('-y, --yes', 'skip confirmation prompt')
  .action(async (name: string, options: { yes?: boolean }) => {
    const cwd = process.cwd();
    const document = (await readTaskrcDocument(cwd)) ?? {};
    const taskConfig = taskConfigFromDocument(document);
    const views = { ...taskConfig.views };

    if (!Object.prototype.hasOwnProperty.call(views, name)) {
      throw new Error(`View not found: ${name}`);
    }

    if (!options.yes) {
      const confirmed = await confirm(`Remove view "${name}"?`);
      if (!confirmed) {
        await writeText(process.stdout, 'Aborted.\n');
        return;
      }
    }

    delete views[name];
    await writeTaskrcDocument(cwd, buildTaskrcDocument({ ...taskConfig, views }, document));
    await writeText(process.stdout, `${name}\n`);
  });

program
  .command('show')
  .description('Print one task to stdout by frontmatter id')
  .argument('<id>', 'task id')
  .action(async (id: string) => {
    const config = await loadConfig();
    const cwd = process.cwd();
    const tasksDir = await resolveTasksDirWithinWorkspace(cwd, config.tasksDir);
    const tasks = await loadTasks(tasksDir, { trusted: true });
    const task = tasks.find((entry) => entry.id === normalizeId(id));

    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    await writeText(process.stdout, task.raw.endsWith('\n') ? task.raw : `${task.raw}\n`);
  });

program
  .command('update')
  .description('Update task frontmatter fields')
  .argument('<id>', 'task id')
  .argument('[fields...]', 'updates in key=value form')
  .action(async (id: string, fields: string[]) => {
    const config = await loadConfig();
    const tasksDir = resolveTasksDir(process.cwd(), config.tasksDir);
    const updates = parseKeyValuePairs(fields);
    validateConfiguredFields(config, updates);

    const filePath = await updateTask(tasksDir, config, normalizeId(id), updates);
    await writeText(process.stdout, `${formatWorkspaceRelativePath(process.cwd(), filePath)}\n`);
  });

program
  .command('validate')
  .description('Validate all tasks')
  .action(async () => {
    const config = await loadConfig();
    const cwd = process.cwd();
    const tasksDir = await resolveTasksDirWithinWorkspace(cwd, config.tasksDir);
    const issues = await validateTasks(tasksDir, config, { trusted: true });

    if (issues.length > 0) {
      for (const issue of issues) {
        await writeText(process.stderr, `${issue.filePath}: ${issue.message}\n`);
      }
      process.exitCode = 1;
      return;
    }

    await writeText(process.stdout, 'All tasks are valid.\n');
  });

program
  .command('completion')
  .description('Print shell completion scripts')
  .argument('<shell>', 'shell name')
  .action(async (shell: string) => {
    switch (shell) {
      case 'bash':
        await writeText(process.stdout, `${buildBashCompletionScript()}\n`);
        return;
      case 'fish':
        await writeText(process.stdout, `${buildFishCompletionScript()}\n`);
        return;
      case 'zsh':
        await writeText(process.stdout, `${buildZshCompletionScript()}\n`);
        return;
      default:
        throw new Error(`Unsupported shell: ${shell}`);
    }
  });

program
  .command('search')
  .description('Search across frontmatter values and markdown body')
  .argument('<query...>', 'search query')
  .action(async (queryParts: string[]) => {
    const config = await loadConfig();
    const cwd = process.cwd();
    const tasksDir = await resolveTasksDirWithinWorkspace(cwd, config.tasksDir);
    const query = queryParts.join(' ').trim().toLowerCase();
    const tasks = await loadTasks(tasksDir, { trusted: true });

    for (const task of tasks) {
      const haystack = [task.id, task.title, ...Object.entries(task.frontmatter).map(([key, value]) => `${key}:${stringifySearchValue(value)}`), task.body]
        .join('\n')
        .toLowerCase();

      if (haystack.includes(query)) {
        await writeText(process.stdout, `${task.id}\t${task.title}\n`);
      }
    }
  });

program
  .command('__complete', { hidden: true })
  .argument('<context>', 'completion context')
  .argument('[prefix]', 'current completion prefix')
  .action(async (context: string, prefix = '') => {
    const config = await loadConfig();
    const suggestions = getCompletionSuggestions(config, context, prefix);
    for (const suggestion of suggestions) {
      await writeText(process.stdout, `${suggestion}\n`);
    }
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await writeText(process.stderr, `${message}\n`);
  process.exitCode = 1;
}

function collectValue(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function parseKeyValuePairs(items: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of items) {
    const separatorIndex = item.indexOf('=');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid argument: ${item}. Expected key=value.`);
    }
    const key = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();
    if (!key) {
      throw new Error(`Invalid argument: ${item}. Expected key=value.`);
    }
    result[key] = value;
  }
  return result;
}

function validateConfiguredFields(
  config: Awaited<ReturnType<typeof loadConfig>>,
  values: Record<string, string | undefined>
): void {
  for (const [fieldName, value] of Object.entries(values)) {
    if (value === undefined || value === '') {
      continue;
    }

    const field = config.fields.find((entry) => entry.name === fieldName);
    if (!field?.options?.length) {
      continue;
    }

    const allowed = new Set(field.options.map((option) => option.value));
    if (!allowed.has(value)) {
      throw new Error(`Invalid ${fieldName}: ${value}`);
    }
  }
}

function normalizeColumns(values: string[], fields: { name: string }[]): string[] {
  if (values.length > 0) {
    return values.map((value) => value.trim()).filter(Boolean);
  }

  return fields.map((field) => field.name);
}

function stringifySearchValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => stringifySearchValue(entry)).join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function parseSortSpecs(items: string[]): { field: string; direction: 'ascending' | 'descending' }[] {
  return items.map((item) => {
    const separatorIndex = item.indexOf(':');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid sort spec: ${item}. Expected field:direction.`);
    }
    const field = item.slice(0, separatorIndex).trim();
    const directionRaw = item.slice(separatorIndex + 1).trim().toLowerCase();
    if (!field) {
      throw new Error(`Invalid sort spec: ${item}. Expected field:direction.`);
    }
    if (directionRaw !== 'ascending' && directionRaw !== 'descending' && directionRaw !== 'asc' && directionRaw !== 'desc') {
      throw new Error(`Invalid sort direction: ${directionRaw}`);
    }
    return {
      field,
      direction: directionRaw === 'descending' || directionRaw === 'desc' ? 'descending' : 'ascending'
    };
  });
}

function formatSort(sort: { field: string; direction: 'ascending' | 'descending' }[]): string {
  if (sort.length === 0) {
    return '';
  }
  return sort.map((item) => `${item.field}:${item.direction}`).join(', ');
}

function formatWorkspaceRelativePath(cwd: string, filePath: string): string {
  const relative = path.relative(cwd, filePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : filePath;
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${prompt} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function writeText(stream: NodeJS.WritableStream, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(text, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
