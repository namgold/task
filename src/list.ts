import type { TaskConfig } from './config.js';
import type { TaskFile, TaskPathOptions } from './task.js';
import { loadTasks, getTaskFieldValue } from './task.js';
import { matchesTaskQuery } from './query.js';
import { renderTable } from './table.js';

export async function listTasks(
  tasksDir: string,
  config: TaskConfig,
  query: string,
  viewName?: string,
  options: TaskPathOptions = {}
): Promise<string> {
  const tasks = await loadTasks(tasksDir, options);
  if (viewName && !Object.prototype.hasOwnProperty.call(config.views, viewName)) {
    throw new Error(`View not found: ${viewName}`);
  }

  const view = viewName ? config.views[viewName] : undefined;
  const effectiveQuery = combineQueries(view?.filter ?? '', query);
  const filtered = tasks.filter((task) => matchesTaskQuery(task, effectiveQuery));
  const sorted = sortTasks(config, filtered, view?.sort ?? []);
  const columns = resolveColumns(config, view?.columns ?? []);
  const warnings = buildColumnWarnings(config, columns);
  const table = renderTable(
    columns,
    sorted.map((task) => formatRow(task, columns)),
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

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sortTasks(
  config: TaskConfig,
  tasks: TaskFile[],
  sortSpecs: { field: string; direction: 'ascending' | 'descending' }[]
): TaskFile[] {
  if (sortSpecs.length === 0) {
    return tasks;
  }

  const selectableOrders = new Map<string, Map<string, number> | undefined>();

  return [...tasks].sort((left, right) => {
    for (const spec of sortSpecs) {
      const comparison = compareFieldValues(config, selectableOrders, left, right, spec.field);
      if (comparison !== 0) {
        return spec.direction === 'descending' ? -comparison : comparison;
      }
    }
    return 0;
  });
}

function compareFieldValues(
  config: TaskConfig,
  selectableOrders: Map<string, Map<string, number> | undefined>,
  left: TaskFile,
  right: TaskFile,
  fieldName: string
): number {
  const leftValue = getTaskFieldValue(left, fieldName);
  const rightValue = getTaskFieldValue(right, fieldName);
  const order = getSelectableOrder(config, selectableOrders, fieldName);

  if (order) {
    const leftRank = order.get(leftValue);
    const rightRank = order.get(rightValue);

    if (leftRank !== undefined || rightRank !== undefined) {
      const leftIndex = leftRank ?? Number.POSITIVE_INFINITY;
      const rightIndex = rightRank ?? Number.POSITIVE_INFINITY;

      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }
    }
  }

  return naturalCollator.compare(leftValue, rightValue);
}

function getSelectableOrder(
  config: TaskConfig,
  selectableOrders: Map<string, Map<string, number> | undefined>,
  fieldName: string
): Map<string, number> | undefined {
  if (selectableOrders.has(fieldName)) {
    return selectableOrders.get(fieldName);
  }

  const field = config.fields.find((entry) => entry.name === fieldName);
  if (!field?.options?.length) {
    selectableOrders.set(fieldName, undefined);
    return undefined;
  }

  const order = new Map(field.options.map((option, index) => [option.value, index]));
  selectableOrders.set(fieldName, order);
  return order;
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

function formatRow(task: TaskFile, fields: string[]): string[] {
  return fields.map((field) => getTaskFieldValue(task, field));
}
