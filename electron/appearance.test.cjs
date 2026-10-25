const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkedAppearance, applyWindowAppearance } = require('./appearance.cjs');

test('旧透明配置迁移到Telegram，拒绝未知模式', () => {
  assert.deepEqual(checkedAppearance({ mode: 'glass', opacity: 0.4 }), { mode: 'telegram' });
  assert.deepEqual(checkedAppearance({ mode: 'telegram' }), { mode: 'telegram' });
  assert.throws(() => checkedAppearance({ mode: 'remote' }));
  assert.throws(() => checkedAppearance(null));
});
test('所有模式背景不透明，不降低纸张和文字的整体透明度', () => {
  const backgrounds = [];
  const window = { setBackgroundColor: color => backgrounds.push(color), setOpacity: () => { throw new Error('不得让整个窗口变淡'); } };
  assert.deepEqual(applyWindowAppearance(window, { mode: 'telegram' }), { nativeTransparency: false });
  applyWindowAppearance(window, { mode: 'dark' });
  applyWindowAppearance(window, { mode: 'light' });
  assert.deepEqual(backgrounds, ['#0b0e13', '#08090c', '#f4f5f9']);
});
