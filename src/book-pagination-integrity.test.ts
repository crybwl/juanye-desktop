import assert from 'node:assert/strict';
import { test } from 'node:test';
import { continuedBookTextOffset, missingBookTextRuns } from './book-pagination-integrity';

test('continued repeated text maps to the actual suffix rather than an earlier identical phrase', () => {
  assert.equal(continuedBookTextOffset('abcabcabc', 'abc', 1), 7);
  assert.equal(continuedBookTextOffset('重复句子；重复句子；重复句子', '重复句子', 2), 12);
  assert.equal(continuedBookTextOffset('完整文本', '完整文本', 2), 2);
  assert.equal(continuedBookTextOffset('abc', 'not-a-suffix', 0), undefined);
  assert.equal(continuedBookTextOffset('abc', 'bc', 3), undefined);
});

test('pagination integrity detects dropped or duplicated fragments but permits page-boundary whitespace', () => {
  const expected = new Map([['first', '首段 正文'], ['last', '末段答案']]);
  assert.deepEqual(missingBookTextRuns(expected, [['first', '首段'], ['first', '正文'], ['last', '末段\n答案']]), []);
  assert.deepEqual(missingBookTextRuns(expected, [['first', '首段正文']]), ['last']);
  assert.deepEqual(missingBookTextRuns(expected, [['first', '首段正文首段正文'], ['last', '末段答案']]), ['first']);
});
