import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BOOK_SETTINGS } from './book-model';
import { bookColumnWidthMm, bookContentWidthMm, bookLayoutEnabled, bookOptionAvailableWidthMm, bookOptionColumnsDefault, normalizeColumnSetAttrs, pickOptionColumns, resolveOptionColumns } from './book-layout-contract';

const pick = (options: string[], availableMm = 170, extra: { hasSideFigure?: boolean } = {}) => pickOptionColumns({ options, availableMm, fontSizePt: 10.5, ...extra });

test('option columns on a full A4 line match the exam auto heuristic', () => {
  assert.equal(pick(['$1$', '$2$', '$-1$', '$0$']), 4);
  assert.equal(pick(['$\\frac{1}{2}$', '$\\sqrt{3}$', '$2\\sqrt{2}$', '$-\\frac{3}{4}$']), 4);
  assert.equal(pick(['函数在区间上单调递增', '函数在区间上单调递减', '函数是偶函数', '函数是奇函数']), 2);
  assert.equal(pick(['若 $a>b$，则 $a^2>b^2$ 对任意实数都成立，这是一个比较长的选项', 'x', 'y', 'z']), 1);
  assert.equal(pick(['第一行\n第二行', 'b']), 1);
  assert.equal(pick([]), 1);
});

test('the same options step down inside a narrower column, and side figures cap at two', () => {
  const options = ['函数单调递增', '函数单调递减', '偶函数', '奇函数'];
  assert.equal(pick(options, 170), 4);
  assert.equal(pick(options, bookColumnWidthMm(140, 2, 6)), 2);
  assert.equal(pick(['$1$', '$2$', '$3$', '$4$'], 170, { hasSideFigure: true }), 2);
});

test('node choice overrides the book default; manual choices still respect side figures', () => {
  const input = { options: ['a', 'b', 'c', 'd'], availableMm: 170, fontSizePt: 10.5 };
  assert.deepEqual(resolveOptionColumns(null, 'auto', input), { columns: 4, auto: true });
  assert.deepEqual(resolveOptionColumns(null, 1, input), { columns: 1, auto: false });
  assert.deepEqual(resolveOptionColumns(2, 1, input), { columns: 2, auto: false });
  assert.deepEqual(resolveOptionColumns(4, 'auto', { ...input, hasSideFigure: true }), { columns: 2, auto: false });
});

test('right-float images reserve actual width and margin, not merely a two-column cap', () => {
  assert.equal(bookOptionAvailableWidthMm(140), 140);
  assert.equal(bookOptionAvailableWidthMm(140, 50), 66);
  const options = ['函数在区间单调递增', '函数在区间单调递减', '偶函数', '奇函数'];
  assert.equal(pick(options, 140, {hasSideFigure: true}), 2);
  assert.equal(pick(options, bookOptionAvailableWidthMm(140, 50), {hasSideFigure: true}), 1);
  assert.equal(bookOptionAvailableWidthMm(40, 100), 1);
});

test('geometry, attribute normalisation and defaults', () => {
  assert.equal(bookContentWidthMm(DEFAULT_BOOK_SETTINGS), 176 - 20 - 16);
  assert.equal(bookColumnWidthMm(140, 2, 6), 67);
  assert.deepEqual(normalizeColumnSetAttrs({ count: 7, gap: 99, rule: 'yes' }), { count: 2, gap: 20, rule: false });
  assert.deepEqual(normalizeColumnSetAttrs({ count: 3, gap: 4.3, rule: true }), { count: 3, gap: 4.5, rule: true });
  assert.equal(bookOptionColumnsDefault(DEFAULT_BOOK_SETTINGS), 'auto');
  assert.equal(bookOptionColumnsDefault({ ...DEFAULT_BOOK_SETTINGS, optionColumns: 2 } as typeof DEFAULT_BOOK_SETTINGS), 2);
});

test('verified column and option layout backends enable their UI capabilities', () => {
  assert.equal(bookLayoutEnabled('columnSet'), true);
  assert.equal(bookLayoutEnabled('optionColumns'), true);
});
