const test = require('node:test');
const assert = require('node:assert/strict');
const { generationPrompt, requestGeneration } = require('./generation.cjs');
const question = { type: 'single', score: 5, stem: '求 $2+3$', options: ['$4$', '$5$'], answer: ['B'], analysis: '' };
test('generation is separate from OCR, requests a single reviewable draft with explicit data boundary', () => {
  assert.match(generationPrompt('variant', question), /一道同类变式题/);
  assert.match(generationPrompt('analysis', question), /逐字保留/);
  assert.match(generationPrompt('variant', question), /<题目数据>/);
  assert.throws(() => generationPrompt('unknown', question), /不支持/);
  assert.throws(() => generationPrompt('variant', { stem: '' }), /有效/);
});
test('text generation uses saved model credentials, bounded output, abort signal and hides secrets on errors', async () => {
  const fetchBefore = globalThis.fetch, controller = new AbortController();
  let body;
  globalThis.fetch = async (url, options) => { body = JSON.parse(options.body); assert.equal(options.headers.Authorization, 'Bearer secret-test'); assert.ok(options.signal); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'draft' } }] }) }; };
  const config = { baseUrl: 'https://example.test/v1', model: 'test', key: 'secret-test' };
  try {
    assert.equal(await requestGeneration(config, { action: 'variant', question, signal: controller.signal }), 'draft');
    assert.equal(body.max_tokens, 8192); assert.equal(body.model, 'test'); assert.equal(typeof body.messages[0].content, 'string');
    globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'wrong secret-test' } }) });
    await assert.rejects(requestGeneration(config, { action: 'analysis', question }), error => !error.message.includes('secret-test') && error.message.includes('[已隐藏]'));
  } finally { globalThis.fetch = fetchBefore; }
});
