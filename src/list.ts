import type { TaskConfig } from './config.js';
import type { TaskFile } from './task.js';
import { loadTasks, getTaskFieldValue } from './task.js';
import { matchesTaskQuery } from './query.js';
import { renderTable } from './table.js';

export async function listTasks(tasksDir: string, config: TaskConfig, query: string, viewName?: string): Promise<string> {
  const tasks = await loadTasks(tasksDir);
  const view = viewName ? config.views[viewName] : undefined;
  const effectiveQuery = combineQueries(view?.filter ?? '', query);
  const filtered = tasks.filter((task) => matchesTaskQuery(task, effectiveQuery));
  const sorted = sortTasks(filtered, view?.sort ?? []);
  const columns = resolveColumns(config, view?.columns ?? []);
  const warnings = buildColumnWarnings(config, columns);
  const table = renderTable(
    columns,
    sorted.map((task) => formatDisplayRow(task, columns, config)),
    'No tasks found.'
  );
  return warnings.length > 0 ? `${warnings.join('\n')}\n${table}` : table;
}

function combineQueries(left: string, right: string): string {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return `(${left}) and (${right})`;
}

function sortTasks(tasks: TaskFile[], sortSpecs: { field: string; direction: 'ascending' | 'descending' }[]): TaskFile[] {
  if (sortSpecs.length === 0) {
    return tasks;
  }

  return [...tasks].sort((left, right) => {
    for (const spec of sortSpecs) {
      const leftValue = getTaskFieldValue(left, spec.field).toLowerCase();
      const rightValue = getTaskFieldValue(right, spec.field).toLowerCase();
      const comparison = leftValue.localeCompare(rightValue);
      if (comparison !== 0) {
        return spec.direction === 'descending' ? -comparison : comparison;
      }
    }
    return 0;
  });
}

function resolveColumns(config: TaskConfig, requestedColumns: string[]): string[] {
  if (requestedColumns.length > 0) {
    return requestedColumns;
  }

  return config.fields.map((field) => field.name);
}

function buildColumnWarnings(config: TaskConfig, columns: string[]): string[] {
  const knownFields = new Set(config.fields.map((field) => field.name));
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const column of columns) {
    if (knownFields.has(column) || seen.has(column)) {
      continue;
    }

    seen.add(column);
    warnings.push(`Warning: column "${column}" does not exist in fields.`);
  }

  return warnings;
}

function formatDisplayRow(task: TaskFile, fields: string[], config: TaskConfig): string[] {
  return fields.map((field) => formatDisplayFieldValue(task, field, config));
}

function formatDisplayFieldValue(task: TaskFile, key: string, config: TaskConfig): string {
  const rawValue = getTaskFieldValue(task, key);
  if (!rawValue) {
    return rawValue;
  }

  const field = config.fields.find((entry) => entry.name === key);
  if (!field?.options?.length) {
    return rawValue;
  }

  const matched = field.options.find((option) => option.value === rawValue || option.label === rawValue);
  return matched?.label ?? rawValue;
}
