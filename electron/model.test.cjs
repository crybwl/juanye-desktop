const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEndpoint, checkedConfig, ocrPrompt } = require('./model.cjs');
test('兼容地址不重复添加 chat/completions', () => {
  assert.equal(normalizeEndpoint('https://example.com/v1/'), 'https://example.com/v1/chat/completions');
  assert.equal(normalizeEndpoint('https://example.com/v1/chat/completions'), 'https://example.com/v1/chat/completions');
});
test('远程地址必须HTTPS且拒绝内置认证', () => {
  assert.throws(() => normalizeEndpoint('http://example.com/v1'));
  assert.throws(() => normalizeEndpoint('https://secret@example.com/v1'));
  assert.doesNotThrow(() => normalizeEndpoint('http://localhost:11434/v1'));
});
test('配置拒绝空模型、换行密钥', () => {
  assert.throws(() => checkedConfig({ baseUrl: 'https://example.com', model: '' }));
  assert.throws(() => checkedConfig({ baseUrl: 'https://example.com', model: 'qwen', key: 'x\ny' }));
});
test('OCR协议限定顶层分题与输出上限', () => {
  assert.match(ocrPrompt(true), /顶层题号/);
  assert.match(ocrPrompt(false), /整张图片作为一道题/);
});
