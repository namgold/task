import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildBashCompletionScript, buildFishCompletionScript, buildZshCompletionScript, getCompletionSuggestions } from '../src/completion.js';
import { installCompletions } from '../src/install-completions.js';
import type { TaskConfig } from '../src/config.js';

const sampleConfig: TaskConfig = {
  tasksDir: '.tasks',
  fields: [],
  views: {
    'Open Tasks': { filter: 'status != done', columns: [], sort: [] },
    'High Priority': { filter: 'priority == high', columns: [], sort: [] }
  }
};

test('getCompletionSuggestions -- view-name returns all view names sorted', () => {
  const result = getCompletionSuggestions(sampleConfig, 'view-name', '');
  assert.deepEqual(result, ['High Priority', 'Open Tasks']);
});

test('getCompletionSuggestions -- view-name filters by prefix', () => {
  const result = getCompletionSuggestions(sampleConfig, 'view-name', 'Open');
  assert.deepEqual(result, ['Open Tasks']);
});

test('getCompletionSuggestions -- prefix matching is case-insensitive', () => {
  const result = getCompletionSuggestions(sampleConfig, 'view-name', 'open');
  assert.deepEqual(result, ['Open Tasks']);
});

test('getCompletionSuggestions -- list-view context returns view names', () => {
  const result = getCompletionSuggestions(sampleConfig, 'list-view', '');
  assert.deepEqual(result, ['High Priority', 'Open Tasks']);
});

test('getCompletionSuggestions -- unknown context returns empty array', () => {
  const result = getCompletionSuggestions(sampleConfig, 'unknown', '');
  assert.deepEqual(result, []);
});

test('installing completions writes bash and fish scripts', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'task-completion-'));
  try {
    const bashPath = path.join(home, '.local', 'share', 'bash-completion', 'completions', 'task');
    const fishPath = path.join(home, '.config', 'fish', 'completions', 'task.fish');
    const zshPath = path.join(home, '.local', 'share', 'zsh', 'site-functions', '_task');

    await installCompletions([
      { filePath: bashPath, content: buildBashCompletionScript() },
      { filePath: fishPath, content: buildFishCompletionScript() },
      { filePath: zshPath, content: buildZshCompletionScript() }
    ]);

    const bashContent = await readFile(bashPath, 'utf8');
    const fishContent = await readFile(fishPath, 'utf8');
    const zshContent = await readFile(zshPath, 'utf8');

    assert.match(bashContent, /complete -F _task_completion task/);
    assert.match(fishContent, /complete -c task -n "__fish_seen_subcommand_from view"/);
    assert.match(zshContent, /#compdef task/);
    assert.match(zshContent, /compdef _task task/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
