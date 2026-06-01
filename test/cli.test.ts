import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

import { stringifyTaskFile } from '../src/task.js';

const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

test('new creates a task file with defaults', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const result = await runCli(cwd, ['new', '--title', 'Fix websocket reconnect', '--type', 'bug', '--priority', 'high']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /TASK-0001-fix-websocket-reconnect\.md/);

    const filePath = result.stdout.trim();
    const raw = await readFile(path.join(cwd, filePath), 'utf8');
    assert.match(raw, /id: TASK-0001/);
    assert.match(raw, /title: Fix websocket reconnect/);
    assert.match(raw, /type: bug/);
    assert.match(raw, /status: new/);
    assert.match(raw, /priority: high/);
  });
});

test('new -- writes custom weird fields from config', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await writeFile(
      path.join(cwd, '.taskrc.yml'),
      [
        'tasks_dir: .tasks',
        'fields:',
        '  - id: $ID',
        '  - title',
        '  - custom field:',
        '      default: seeded',
        ''
      ].join('\n'),
      'utf8'
    );

    const result = await runCli(cwd, ['new', '--title', 'Weird field task', '--field', 'custom field=alpha']);

    assert.equal(result.status, 0, result.stderr);
    const filePath = result.stdout.trim();
    const raw = await readFile(path.join(cwd, filePath), 'utf8');
    assert.match(raw, /custom field: alpha/);
    assert.match(raw, /title: Weird field task/);
  });
});

test('list and view render saved tables', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await writeTask(cwd, {
      id: 'TASK-0001',
      title: 'Open task',
      type: 'feature',
      status: 'pending_review',
      priority: 'high',
      assignee: 'alice',
      description: '',
      pr: '',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      summary: 'Check the table rendering.',
      tags: []
    });

    const listResult = await runCli(cwd, ['list']);
    assert.equal(listResult.status, 0, listResult.stderr);
    assert.match(listResult.stdout, /^id\s+status\s+priority\s+type\s+assignee\s+title/m);
    assert.match(listResult.stdout, /Open task/);

    const viewResult = await runCli(cwd, ['view', 'Open Tasks']);
    assert.equal(viewResult.status, 0, viewResult.stderr);
    assert.match(viewResult.stdout, /status\s+priority\s+summary\s+description/);
    assert.match(viewResult.stdout, /Check the table rendering\./);
  });
});

test('list -- parses quoted values, implicit AND, and parenthesized OR groups', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await writeTask(cwd, {
      id: 'TASK-0001',
      title: 'Alpha task',
      type: 'feature',
      status: 'new',
      priority: 'high',
      assignee: '',
      description: '',
      pr: '',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      summary: 'Quoted title match.',
      tags: []
    });
    await writeTask(cwd, {
      id: 'TASK-0002',
      title: 'Alpha task',
      type: 'feature',
      status: 'blocked',
      priority: 'critical',
      assignee: '',
      description: '',
      pr: '',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      summary: 'Quoted title match.',
      tags: []
    });
    await writeTask(cwd, {
      id: 'TASK-0003',
      title: 'Beta task',
      type: 'feature',
      status: 'new',
      priority: 'high',
      assignee: '',
      description: '',
      pr: '',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      summary: 'Unrelated task.',
      tags: []
    });

    const result = await runCli(cwd, ['list', 'title == "Alpha task" (status == new || status == blocked)']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal((result.stdout.match(/Alpha task/g) ?? []).length, 2);
    assert.match(result.stdout, /\bNew\b/);
    assert.match(result.stdout, /\bBlocked\b/);
    assert.doesNotMatch(result.stdout, /Beta task/);
  });
});

test('list -- combines saved view filters with ad hoc queries', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await runCli(cwd, [
      'view',
      'create',
      'Active Work',
      'status != done',
      '--column',
      'title',
      '--column',
      'priority',
      '--column',
      'status'
    ]);

    await writeTask(cwd, {
      id: 'TASK-0001',
      title: 'Open high',
      type: 'feature',
      status: 'new',
      priority: 'high',
      assignee: '',
      description: '',
      pr: '',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      summary: 'Matches the ad hoc query.',
      tags: []
    });
    await writeTask(cwd, {
      id: 'TASK-0002',
      title: 'Open low',
      type: 'feature',
      status: 'new',
      priority: 'low',
      assignee: '',
      description: '',
      pr: '',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      summary: 'Should be filtered out by the query.',
      tags: []
    });
    await writeTask(cwd, {
      id: 'TASK-0003',
      title: 'Closed high',
      type: 'feature',
      status: 'done',
      priority: 'high',
      assignee: '',
      description: '',
      pr: '',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      summary: 'Should be filtered out by the view.',
      tags: []
    });

    const result = await runCli(cwd, ['ls', '--view', 'Active Work', 'priority == high']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Open high/);
    assert.doesNotMatch(result.stdout, /Open low/);
    assert.doesNotMatch(result.stdout, /Closed high/);
  });
});

test('view create, ls, and rm manage saved views', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await writeTask(cwd, {
      id: 'TASK-0001',
      title: 'Critical task',
      type: 'feature',
      status: 'new',
      priority: 'critical',
      assignee: '',
      description: '',
      pr: '',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      summary: 'A task used for a saved view.',
      tags: []
    });

    const createResult = await runCli(cwd, [
      'view',
      'create',
      'Critical',
      'priority == critical',
      '--column',
      'title',
      '--column',
      'priority',
      '--sort',
      'priority:descending'
    ]);

    assert.equal(createResult.status, 0, createResult.stderr);
    assert.match(createResult.stdout, /^Critical$/m);

    const configAfterCreate = await readFile(path.join(cwd, '.taskrc.yml'), 'utf8');
    assert.match(configAfterCreate, /Critical:/);
    assert.match(configAfterCreate, /priority == critical/);

    const viewLsResult = await runCli(cwd, ['view', 'ls']);
    assert.equal(viewLsResult.status, 0, viewLsResult.stderr);
    assert.match(viewLsResult.stdout, /Critical/);
    assert.match(viewLsResult.stdout, /title, priority/);

    const showViewResult = await runCli(cwd, ['view', 'Critical']);
    assert.equal(showViewResult.status, 0, showViewResult.stderr);
    assert.match(showViewResult.stdout, /title\s+priority/);
    assert.match(showViewResult.stdout, /Critical task/);

    const rmResult = await runCli(cwd, ['view', 'rm', 'Critical', '--yes']);
    assert.equal(rmResult.status, 0, rmResult.stderr);
    assert.match(rmResult.stdout, /^Critical$/m);

    const configAfterRm = await readFile(path.join(cwd, '.taskrc.yml'), 'utf8');
    assert.doesNotMatch(configAfterRm, /Critical:/);
  });
});

test('view create, show, and rm handle multi-word names and complex filters', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await writeTask(cwd, {
      id: 'TASK-0001',
      title: 'Critical high',
      type: 'feature',
      status: 'new',
      priority: 'high',
      assignee: '',
      description: '',
      pr: '',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      summary: 'Should be included.',
      tags: []
    });
    await writeTask(cwd, {
      id: 'TASK-0002',
      title: 'Critical critical',
      type: 'feature',
      status: 'new',
      priority: 'critical',
      assignee: '',
      description: '',
      pr: '',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      summary: 'Should also be included.',
      tags: []
    });
    await writeTask(cwd, {
      id: 'TASK-0003',
      title: 'Closed critical',
      type: 'feature',
      status: 'done',
      priority: 'critical',
      assignee: '',
      description: '',
      pr: '',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      summary: 'Should be excluded by the filter.',
      tags: []
    });

    const createResult = await runCli(cwd, [
      'view',
      'create',
      'Critical Open',
      '(status != done && (priority == high || priority == critical))',
      '--column',
      'title',
      '--column',
      'priority',
      '--column',
      'status',
      '--sort',
      'priority:desc',
      '--sort',
      'status:asc'
    ]);

    assert.equal(createResult.status, 0, createResult.stderr);
    assert.match(createResult.stdout, /^Critical Open$/m);

    const configAfterCreate = await readFile(path.join(cwd, '.taskrc.yml'), 'utf8');
    assert.match(configAfterCreate, /status != done/);
    assert.match(configAfterCreate, /priority == high/);
    assert.match(configAfterCreate, /priority: descending/);
    assert.match(configAfterCreate, /status: ascending/);

    const viewResult = await runCli(cwd, ['view', 'Critical Open']);
    assert.equal(viewResult.status, 0, viewResult.stderr);
    assert.match(viewResult.stdout, /Critical high/);
    assert.match(viewResult.stdout, /Critical critical/);
    assert.doesNotMatch(viewResult.stdout, /Closed critical/);

    const rmResult = await runCli(cwd, ['view', 'rm', 'Critical Open', '--yes']);
    assert.equal(rmResult.status, 0, rmResult.stderr);
    assert.match(rmResult.stdout, /^Critical Open$/m);
  });
});

test('view create -- rejects malformed sort specifications', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const result = await runCli(cwd, ['view', 'create', 'Bad Sort', 'status == new', '--sort', 'priority']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid sort spec/);
  });
});

test('show, update, search, and validate work together', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const filePath = await writeTask(cwd, {
      id: 'TASK-0001',
      title: 'Searchable task',
      type: 'bug',
      status: 'new',
      priority: 'medium',
      assignee: '',
      description: '',
      owner: '',
      branch: '',
      pr: '',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      summary: 'Contains an alpha keyword.',
      tags: []
    }, ['# Problem', '', 'alpha is present in the body.'].join('\n'));

    const showResult = await runCli(cwd, ['show', 'TASK-0001']);
    assert.equal(showResult.status, 0, showResult.stderr);
    const rawTask = await readFile(filePath, 'utf8');
    assert.equal(showResult.stdout, rawTask.endsWith('\n') ? rawTask : `${rawTask}\n`);

    const updateResult = await runCli(cwd, ['update', 'TASK-0001', 'status=blocked', 'assignee=alice']);
    assert.equal(updateResult.status, 0, updateResult.stderr);

    const updatedRaw = await readFile(path.join(cwd, '.tasks', 'TASK-0001-searchable-task.md'), 'utf8');
    assert.match(updatedRaw, /status: blocked/);
    assert.match(updatedRaw, /assignee: alice/);
    assert.match(updatedRaw, new RegExp(`updated_at: ${todayIsoDate()}`));

    const searchResult = await runCli(cwd, ['search', 'alpha']);
    assert.equal(searchResult.status, 0, searchResult.stderr);
    assert.match(searchResult.stdout, /TASK-0001\tSearchable task/);

    const validateResult = await runCli(cwd, ['validate']);
    assert.equal(validateResult.status, 0, validateResult.stderr);
    assert.match(validateResult.stdout, /All tasks are valid\./);
  });
});

test('update -- handles multiple key=value arguments and tag lists', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await writeTask(cwd, {
      id: 'TASK-0001',
      title: 'Update target',
      type: 'feature',
      status: 'new',
      priority: 'medium',
      assignee: '',
      description: '',
      pr: '',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      summary: 'Original summary.',
      tags: []
    });

    const result = await runCli(cwd, [
      'update',
      'TASK-0001',
      'status=done',
      'assignee=alice',
      'summary=Updated summary',
      'branch=feature/reconnect',
      'tags=alpha,beta'
    ]);

    assert.equal(result.status, 0, result.stderr);

    const raw = await readFile(path.join(cwd, '.tasks', 'TASK-0001-update-target.md'), 'utf8');
    assert.match(raw, /status: done/);
    assert.match(raw, /assignee: alice/);
    assert.match(raw, /summary: Updated summary/);
    assert.match(raw, /branch: feature\/reconnect/);
    assert.match(raw, /tags:\n  - alpha\n  - beta/);
  });
});

test('update -- rejects malformed key value pairs', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await writeTask(cwd, {
      id: 'TASK-0001',
      title: 'Bad update',
      type: 'feature',
      status: 'new',
      priority: 'medium',
      assignee: '',
      description: '',
      pr: '',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      summary: 'Needs validation.',
      tags: []
    });

    const result = await runCli(cwd, ['update', 'TASK-0001', 'status']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid argument: status/);
  });
});

test('unknown view columns warn but still render the table', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await writeFile(
      path.join(cwd, '.taskrc.yml'),
      [
        'tasks_dir: .tasks',
        'fields:',
        '  - id: $ID',
        '  - title',
        'views:',
        '  - Broken:',
        '      filter: "title == Alpha"',
        '      columns: title, missing',
        ''
      ].join('\n'),
      'utf8'
    );

    await writeTask(cwd, {
      id: 'TASK-0001',
      title: 'Alpha',
      created_at: '',
      updated_at: ''
    } as never, '# Body');

    const result = await runCli(cwd, ['view', 'Broken']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Warning: column "missing" does not exist in fields\./);
    assert.match(result.stdout, /title\s+missing/);
    assert.match(result.stdout, /Alpha/);
  });
});

test('search -- matches multi-word queries across frontmatter and body', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await writeTask(
      cwd,
      {
        id: 'TASK-0001',
        title: 'Summary match',
        type: 'feature',
        status: 'new',
        priority: 'medium',
        assignee: '',
        description: '',
        pr: '',
        created_at: '2026-06-01',
        updated_at: '2026-06-01',
        summary: 'Alpha keyword lives in the summary.',
        tags: []
      },
      '# Problem\n\nNo special body text here.'
    );
    await writeTask(
      cwd,
      {
        id: 'TASK-0002',
        title: 'Body match',
        type: 'feature',
        status: 'new',
        priority: 'medium',
        assignee: '',
        description: '',
        pr: '',
        created_at: '2026-06-01',
        updated_at: '2026-06-01',
        summary: 'Unrelated summary.',
        tags: []
      },
      '# Problem\n\nAlpha keyword lives in the body.'
    );
    await writeTask(cwd, {
      id: 'TASK-0003',
      title: 'No match',
      type: 'feature',
      status: 'new',
      priority: 'medium',
      assignee: '',
      description: '',
      pr: '',
      created_at: '2026-06-01',
      updated_at: '2026-06-01',
      summary: 'Nothing useful.',
      tags: []
    });

    const result = await runCli(cwd, ['search', 'ALPHA', 'KEYWORD']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /TASK-0001\tSummary match/);
    assert.match(result.stdout, /TASK-0002\tBody match/);
    assert.doesNotMatch(result.stdout, /No match/);
  });
});

test('new -- assigns sequential ids', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await runCli(cwd, ['new', '--title', 'First task']);
    const result = await runCli(cwd, ['new', '--title', 'Second task']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /TASK-0002/);
  });
});

test('new -- invalid type value exits with code 1', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const result = await runCli(cwd, ['new', '--title', 'Bad task', '--type', 'invalid_type']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid type/);
  });
});

test('list -- filter expression shows only matching tasks', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await writeTask(cwd, { id: 'TASK-0001', title: 'Task A', status: 'new', created_at: '', updated_at: '' } as never);
    await writeTask(cwd, { id: 'TASK-0002', title: 'Task B', status: 'done', created_at: '', updated_at: '' } as never);

    const result = await runCli(cwd, ['list', 'status == new']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Task A/);
    assert.doesNotMatch(result.stdout, /Task B/);
  });
});

test('list -- ls alias works', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await writeTask(cwd, { id: 'TASK-0001', title: 'A task', status: 'new', created_at: '', updated_at: '' } as never);
    const result = await runCli(cwd, ['ls']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /A task/);
  });
});

test('list -- --view flag works same as task view <name>', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await writeTask(cwd, { id: 'TASK-0001', title: 'Open task', status: 'new', summary: 'View flag summary', created_at: '', updated_at: '' } as never);
    const result = await runCli(cwd, ['list', '--view', 'Open Tasks']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /View flag summary/);
  });
});

test('list -- no tasks shows empty message', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const result = await runCli(cwd, ['list']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No tasks found\./);
  });
});

test('show -- case-insensitive id', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await writeTask(cwd, { id: 'TASK-0001', title: 'Case test', status: 'new', created_at: '', updated_at: '' } as never);
    const result = await runCli(cwd, ['show', 'task-0001']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Case test/);
  });
});

test('show -- not found exits with code 1', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const result = await runCli(cwd, ['show', 'TASK-9999']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Task not found/);
  });
});

test('update -- preserves markdown body', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const body = ['# Problem', '', 'Important details.'].join('\n');
    await writeTask(cwd, { id: 'TASK-0001', title: 'Body test', status: 'new', created_at: '', updated_at: '' } as never, body);

    await runCli(cwd, ['update', 'TASK-0001', 'status=done']);

    const raw = await readFile(path.join(cwd, '.tasks', 'TASK-0001-body-test.md'), 'utf8');
    assert.match(raw, /Important details\./);
    assert.match(raw, /status: done/);
  });
});

test('update -- invalid status value exits with code 1', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await writeTask(cwd, { id: 'TASK-0001', title: 'X', status: 'new', created_at: '', updated_at: '' } as never);
    const result = await runCli(cwd, ['update', 'TASK-0001', 'status=notvalid']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid status/);
  });
});

test('list -- malformed taskrc exits with code 1', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await writeFile(
      path.join(cwd, '.taskrc.yml'),
      [
        'fields:',
        '  - id: $ID',
        '    title:',
        '      default: broken',
        ''
      ].join('\n'),
      'utf8'
    );

    const result = await runCli(cwd, ['list']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid \.taskrc\.yml/);
  });
});

test('update -- not found exits with code 1', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const result = await runCli(cwd, ['update', 'TASK-9999', 'status=done']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Task not found/);
  });
});

test('validate -- duplicate task ids exits with code 1', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const tasksDir = path.join(cwd, '.tasks');
    await mkdir(tasksDir, { recursive: true });
    await writeFile(path.join(tasksDir, 'TASK-0001-alpha.md'), '---\nid: TASK-0001\ntitle: Alpha\nstatus: new\n---\n# Body\n', 'utf8');
    await writeFile(path.join(tasksDir, 'TASK-0001-beta.md'), '---\nid: TASK-0001\ntitle: Beta\nstatus: new\n---\n# Body\n', 'utf8');

    const result = await runCli(cwd, ['validate']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Duplicate task ID/);
  });
});

test('validate -- invalid field value exits with code 1', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const tasksDir = path.join(cwd, '.tasks');
    await mkdir(tasksDir, { recursive: true });
    await writeFile(path.join(tasksDir, 'TASK-0001-bad.md'), '---\nid: TASK-0001\ntitle: Bad\nstatus: notvalid\n---\n# Body\n', 'utf8');

    const result = await runCli(cwd, ['validate']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid status/);
  });
});

test('validate -- empty body exits with code 1', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const tasksDir = path.join(cwd, '.tasks');
    await mkdir(tasksDir, { recursive: true });
    await writeFile(path.join(tasksDir, 'TASK-0001-empty.md'), '---\nid: TASK-0001\ntitle: Empty\nstatus: new\n---\n', 'utf8');

    const result = await runCli(cwd, ['validate']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Markdown body is empty/);
  });
});

test('search -- no match returns empty output', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await writeTask(cwd, { id: 'TASK-0001', title: 'Unrelated', status: 'new', created_at: '', updated_at: '' } as never);
    const result = await runCli(cwd, ['search', 'zzznomatch']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '');
  });
});

test('search -- matches body content', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await writeTask(
      cwd,
      { id: 'TASK-0001', title: 'Regular task', status: 'new', created_at: '', updated_at: '' } as never,
      '# Problem\n\nBodyOnlyKeyword goes here.'
    );
    const result = await runCli(cwd, ['search', 'BodyOnlyKeyword']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /TASK-0001\tRegular task/);
  });
});

test('view create -- duplicate name exits with code 1', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    await runCli(cwd, ['view', 'create', 'MyView', 'status == new']);
    const result = await runCli(cwd, ['view', 'create', 'MyView', 'status == done']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /View already exists/);
  });
});

test('view create -- empty query exits with code 1', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const result = await runCli(cwd, ['view', 'create', 'EmptyView']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /query cannot be empty/);
  });
});

test('view rm -- unknown name exits with code 1', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const result = await runCli(cwd, ['view', 'rm', 'Nonexistent', '--yes']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /View not found/);
  });
});

test('view -- unknown name exits with code 1', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const result = await runCli(cwd, ['view', 'Nonexistent']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /View not found/);
  });
});

test('completion -- fish generates script', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const result = await runCli(cwd, ['completion', 'fish']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /__fish_seen_subcommand_from view/);
  });
});

test('completion -- unsupported shell exits with code 1', { concurrency: false }, async () => {
  await withWorkspace(async (cwd) => {
    const result = await runCli(cwd, ['completion', 'zsh']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported shell/);
  });
});

async function withWorkspace(fn: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'task-cli-'));
  try {
    await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function runCli(cwd: string, args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  const previousArgv = [...process.argv];
  const previousCwd = process.cwd();
  const previousExitCode = process.exitCode;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk: string | Uint8Array, callback?: (error?: Error | null) => void) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    callback?.(null);
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array, callback?: (error?: Error | null) => void) => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    callback?.(null);
    return true;
  }) as typeof process.stderr.write;

  process.exitCode = undefined;
  process.chdir(cwd);
  process.argv = [process.execPath, cliPath, ...args];

  let status = 0;
  try {
    const url = `${pathToFileURL(cliPath).href}?run=${Date.now()}-${Math.random()}`;
    await import(url);
    status = process.exitCode ?? 0;
  } finally {
    process.argv = previousArgv;
    process.chdir(previousCwd);
    process.exitCode = previousExitCode;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  return {
    status,
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join('')
  };
}

async function writeTask(
  cwd: string,
  frontmatter: Record<string, unknown>,
  body = ['# Problem', '', 'Body.'].join('\n')
): Promise<string> {
  const tasksDir = path.join(cwd, '.tasks');
  await mkdir(tasksDir, { recursive: true });
  const title = String(frontmatter.title ?? 'task');
  const filePath = path.join(tasksDir, `${String(frontmatter.id ?? 'TASK-0001')}-${slugify(title)}.md`);
  const raw = stringifyTaskFile({ frontmatter, body });
  await writeFile(filePath, raw.endsWith('\n') ? raw : `${raw}\n`, 'utf8');
  return filePath;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
