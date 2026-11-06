import test from 'node:test';
import assert from 'node:assert/strict';
import { measureRawBookOptions, pickMeasuredOptionColumns } from './book-option-measure';

test('actual longest rendered option selects four, two, or one cells', () => {
  const input = { availablePx: 640, gapPx: 16 };
  assert.equal(pickMeasuredOptionColumns({ ...input, longestPx: 140 }), 4);
  assert.equal(pickMeasuredOptionColumns({ ...input, longestPx: 150 }), 2);
  assert.equal(pickMeasuredOptionColumns({ ...input, longestPx: 310 }), 2);
  assert.equal(pickMeasuredOptionColumns({ ...input, longestPx: 313 }), 1);
});

test('same printed content responds to semantic column width and side figures', () => {
  const input = { longestPx: 90, availablePx: 640, gapPx: 16 };
  assert.equal(pickMeasuredOptionColumns(input), 4);
  assert.equal(pickMeasuredOptionColumns({ ...input, availablePx: 260 }), 2);
  assert.equal(pickMeasuredOptionColumns({ ...input, availablePx: 170 }), 1);
  assert.equal(pickMeasuredOptionColumns({ ...input, sideFigure: true }), 2);
});

test('explicit line breaks and invalid geometry never select a multi-column grid', () => {
  const input = { longestPx: 50, availablePx: 640, gapPx: 16 };
  assert.equal(pickMeasuredOptionColumns({ ...input, multiline: true }), 1);
  for (const value of [0, -1, NaN, Infinity]) {
    assert.equal(pickMeasuredOptionColumns({ ...input, availablePx: value }), 1);
    assert.equal(pickMeasuredOptionColumns({ ...input, longestPx: value }), 1);
  }
  assert.equal(pickMeasuredOptionColumns({ ...input, gapPx: -2 }), 1);
});

test('server validation has no DOM side effects and retains estimate fallback', () => {
  assert.equal(measureRawBookOptions(['$1$', '$\\frac{1}{2}$'], 10.5), undefined);
});
