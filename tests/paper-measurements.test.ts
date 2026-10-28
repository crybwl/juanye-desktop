import test from 'node:test';
import assert from 'node:assert/strict';
import { BlockGeometryCache, paginateMeasuredBlocks } from '../src/paper-measurements';

test('only immutable changed blocks, geometry context and numbering invalidate measurement', () => {
  const cache = new BlockGeometryCache(), original = {}, changed = {}, geometry = { height: 48, guards: [] };
  cache.set('q1', 'A4:fonts1', original, '1', geometry);
  assert.equal(cache.get('q1', 'A4:fonts1', original, '1'), geometry);
  assert.equal(cache.get('q1', 'A4:fonts1', changed, '1'), undefined);
  assert.equal(cache.get('q1', 'A3:fonts1', original, '1'), undefined);
  assert.equal(cache.get('q1', 'A4:fonts2', original, '1'), undefined);
  assert.equal(cache.get('q1', 'A4:fonts1', original, '2'), undefined);
  cache.set('q1', 'A4:fonts1', changed, '1', { height: 70, guards: [] });
  assert.equal(cache.size, 1, 'Replacing a question does not retain its prior image/content graph');
  cache.retain(new Set()); assert.equal(cache.size, 0);
});

test('section grouping, full remainder spaces and two-column physical breaks retain exact geometry', () => {
  const blocks = [{ kind: 'head' }, { kind: 'sec' }, { kind: 'q' }, { kind: 'space', fillRemaining: true }, { kind: 'q', breakBefore: true }, { kind: 'answer', breakAfter: true }];
  const geometry = [70, 10, 50, 0, 40, 15].map(height => ({ height, guards: [] }));
  assert.deepEqual(paginateMeasuredBlocks(blocks, geometry, 100, false, 2), [
    [{ index: 0, offset: 0, height: 70, fullHeight: 70 }],
    [{ index: 1, offset: 0, height: 10, fullHeight: 10 }, { index: 2, offset: 0, height: 50, fullHeight: 50 }, { index: 3, offset: 0, height: 40, fullHeight: 40, fillSpace: true }],
    [{ index: 4, offset: 0, height: 40, fullHeight: 40 }, { index: 5, offset: 0, height: 15, fullHeight: 15 }], [],
  ]);
});

test('oversized tables/text/images preserve safe cuts and every continuation pixel', () => {
  const geometry = [{ height: 248, guards: [{ top: 90, bottom: 115 }, { top: 180, bottom: 205 }] }];
  const pages = paginateMeasuredBlocks([{ kind: 'q' }], geometry, 100, false, 1);
  const pieces = pages.flat();
  assert.deepEqual(pieces.map(piece => [piece.offset, piece.height]), [[0, 90], [90, 90], [180, 68]]);
  assert.equal(pieces.reduce((sum, piece) => sum + piece.height, 0), 248);
});

test('independent full-page answer spaces keep questions 17–19 on separate physical pages', () => {
  const pages = paginateMeasuredBlocks([17, 18, 19].map(() => ({ kind: 'answer', breakBefore: true, breakAfter: true })), [17, 18, 19].map(() => ({ height: 100, guards: [] })), 100, false, 1);
  assert.deepEqual(pages.map(page => page.map(piece => piece.index)), [[0], [1], [2]]);
});
