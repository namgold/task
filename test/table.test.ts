import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderTable } from '../src/table.js';

test('renderTable -- empty rows returns default empty message', () => {
  assert.equal(renderTable(['id', 'title'], []), 'No items found.');
});

test('renderTable -- empty rows returns custom empty message', () => {
  assert.equal(renderTable(['id', 'title'], [], 'Nothing to show.'), 'Nothing to show.');
});

test('renderTable -- formats single row with header', () => {
  const result = renderTable(['id', 'title'], [['TASK-0001', 'Fix bug']]);
  const lines = result.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^id\s+title\s*$/);
  assert.match(lines[1], /^TASK-0001\s+Fix bug\s*$/);
});

test('renderTable -- pads columns to widest cell width', () => {
  const result = renderTable(['col'], [['short'], ['a much longer cell']]);
  const lines = result.split('\n');
  const expectedWidth = 'a much longer cell'.length;
  assert.equal(lines[0].length, expectedWidth);
  assert.equal(lines[1].length, expectedWidth);
  assert.equal(lines[2].length, expectedWidth);
});

test('renderTable -- header wider than all cells pads cells to header width', () => {
  const result = renderTable(['very-long-header'], [['x']]);
  const lines = result.split('\n');
  assert.equal(lines[0], 'very-long-header');
  assert.equal(lines[1], 'x'.padEnd('very-long-header'.length));
});

test('renderTable -- separates columns with two spaces', () => {
  const result = renderTable(['a', 'b'], [['1', '2']]);
  const lines = result.split('\n');
  assert.equal(lines[0], 'a  b');
  assert.equal(lines[1], '1  2');
});
