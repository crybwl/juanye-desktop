const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createQuestionBankStore, checkedQuestion, contentKey } = require('./question-bank.cjs');

const image = 'data:image/png;base64,aGVsbG8=';
const fixture = (id = 'q1') => ({ id, type: 'single', score: 5, stem: '若 $x=2$，则 $x^2=$（　）。', options: ['$1$', '$2$', '$3$', '$4$'], answer: ['D'], analysis: '$2^2=4$。', source: '2026 市统考', knowledge: ['指数', '计算'], difficulty: 'easy', importNumber: 8, pageBreakBefore: true, answerSpace: 'full', paperAnswerSpace: 'half', sourceImage: image, figure: image, drawing: '\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}', figures: [{ id: 'figure-a', src: image, layout: 'right', caption: '题图', width: 35, maxHeight: 220 }] });
async function temp(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'juanye-bank-test-'));
  t.after(async () => { const resolved = await fs.realpath(directory); assert.equal(path.dirname(resolved).toLowerCase(), (await fs.realpath(os.tmpdir())).toLowerCase()); assert.ok(path.basename(resolved).startsWith('juanye-bank-test-')); await fs.rm(resolved, { recursive: true, force: true }); });
  return { directory, store: createQuestionBankStore({ directory }) };
}

test('question bank is independent, durable, and retains every editable question field', async t => {
  const { directory, store } = await temp(t);
  assert.equal((await store.load()).entries.length, 0);
  const q = fixture();
  const result = await store.save({ questions: [q], origin: { examTitle: 'A卷' } });
  assert.equal(result.added, 1); assert.equal(result.duplicates, 0);
  assert.deepEqual(result.bank.entries[0].question, q);
  assert.deepEqual(result.bank.entries[0].origin, { examTitle: 'A卷', questionId: q.id });
  assert.deepEqual(await createQuestionBankStore({ directory }).load(), result.bank);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['question-bank.backup.json', 'question-bank.json']);
  const restored = await store.restore(); assert.equal(restored.entries.length, 0);
});

test('cloned content is idempotent and edited source questions create linked versions without overwriting the original', async t => {
  const { store } = await temp(t);
  const q = fixture();
  const first = await store.save({ questions: [q], origin: { examTitle: 'A卷' } });
  const changed = await store.save({ questions: [{ ...q, analysis: '另一个本地版本' }], origin: { examTitle: 'A卷' } });
  assert.equal(changed.added, 1); assert.equal(changed.duplicates, 0);
  assert.deepEqual(changed.bank.entries[0], first.bank.entries[0]);
  assert.equal(changed.bank.entries[1].version, 2); assert.equal(changed.bank.entries[1].previousVersionId, first.bank.entries[0].id);
  const repeated = await store.save({ questions: [{ ...q, analysis: '另一个本地版本' }], origin: { examTitle: 'A卷' } });
  assert.equal(repeated.added, 0); assert.equal(repeated.duplicates, 1);
  const copied = fixture('new-id'); copied.figures[0].id = 'new-figure';
  const clone = await store.save({ questions: [copied], origin: { examTitle: 'B卷' } });
  assert.equal(clone.duplicates, 1); assert.equal(clone.bank.entries.length, 2);
  const next = fixture('q2'); next.stem = '另一道题';
  const distinct = await store.save({ questions: [next], origin: { examTitle: 'A卷' } });
  assert.equal(distinct.added, 1); assert.equal(distinct.bank.entries.length, 3);
});

test('concurrent bank writes are serialized and a removed batch can be restored', async t => {
  const { store } = await temp(t);
  const q = fixture('q2'); q.stem = '另一道题';
  await Promise.all([store.save({ questions: [fixture()] }), store.save({ questions: [q] })]);
  const saved = await store.load(); assert.equal(saved.entries.length, 2);
  const deleted = await store.remove(saved.entries.map(entry => entry.id)); assert.equal(deleted.entries.length, 0);
  const restored = await store.restore(); assert.equal(restored.entries.length, 2); assert.ok(restored.revision > deleted.revision);
});

test('damaged bank is never silently replaced and explicit restore preserves the damaged original', async t => {
  const { directory, store } = await temp(t);
  await store.save({ questions: [fixture()] });
  const next = fixture('q2'); next.stem = '第二题'; await store.save({ questions: [next] });
  const target = path.join(directory, 'question-bank.json'); await fs.writeFile(target, '{broken');
  await assert.rejects(store.load(), /原文件已保留/);
  await assert.rejects(store.save({ questions: [fixture('q3')] }), /原文件已保留/);
  assert.equal(await fs.readFile(target, 'utf8'), '{broken');
  const restored = await store.restore(); assert.equal(restored.entries.length, 1);
  const damaged = (await fs.readdir(directory)).find(file => file.startsWith('question-bank.json.before-restore-'));
  assert.ok(damaged); assert.equal(await fs.readFile(path.join(directory, damaged), 'utf8'), '{broken');
});

test('bank validates IPC payloads, embedded image boundaries and canonical content keys', async t => {
  const { store } = await temp(t);
  await assert.rejects(store.save({ questions: [] }), /请选择/);
  await assert.rejects(store.save({ questions: [{ ...fixture(), figure: 'https://example.com/image.png' }] }), /内嵌图片/);
  await assert.rejects(store.save({ questions: [{ ...fixture(), score: Infinity }] }), /分值无效/);
  await assert.rejects(store.remove(['../draft.json', null]), /列表无效/);
  assert.equal((await store.load()).entries.length, 0);
  assert.deepEqual(checkedQuestion({ ...fixture(), unexpected: 'ignored' }), fixture());
  const copy = fixture('different'); copy.figures[0].id = 'another';
  assert.equal(contentKey(copy), contentKey(fixture()));
});
