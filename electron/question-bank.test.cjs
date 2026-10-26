const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createQuestionBankStore, checkedBank, checkedQuestion, contentKey } = require('./question-bank.cjs');

const image = 'data:image/png;base64,aGVsbG8=';
const fixture = (id = 'q1') => ({ id, type: 'single', score: 5, stem: '若 $x=2$，则 $x^2=$（　）。', options: ['$1$', '$2$', '$3$', '$4$'], answer: ['D'], analysis: '$2^2=4$。', source: '2026 市统考', knowledge: ['指数', '计算'], difficulty: 'easy', importNumber: 8, pageBreakBefore: true, answerSpace: 'full', paperAnswerSpace: 'half', sourceImage: image, figure: image, drawing: '\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}', figures: [{ id: 'figure-a', src: image, layout: 'right', caption: '题图', width: 35, maxHeight: 220 }] });
async function temp(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'juanye-bank-test-'));
  t.after(async () => { const resolved = await fs.realpath(directory); assert.equal(path.dirname(resolved).toLowerCase(), (await fs.realpath(os.tmpdir())).toLowerCase()); assert.ok(path.basename(resolved).startsWith('juanye-bank-test-')); await fs.rm(resolved, { recursive: true, force: true }); });
  return { directory, store: createQuestionBankStore({ directory }) };
}

test('batch revisions and additive collection assignment commit once and reject stale edits atomically', async t => {
  const { store, directory } = await temp(t);
  const first = fixture('q1'), second = { ...fixture('q2'), stem: '第二题 $x+1=0$' };
  const initial = await store.save({ questions: [first, second] });
  const entries = initial.bank.entries;
  const batch = entries.map(entry => ({ id: entry.id, question: { ...entry.question, source: '统一来源' }, expectedContentKey: entry.contentKey }));
  const changed = await store.reviseBatch(batch);
  assert.equal(changed.revision, initial.bank.revision + 1);
  assert.equal(changed.entries.length, 4);
  const bytes = await fs.readFile(path.join(directory, 'question-bank.json'), 'utf8');
  await assert.rejects(store.reviseBatch(batch), /整批未保存/);
  assert.equal(await fs.readFile(path.join(directory, 'question-bank.json'), 'utf8'), bytes);
  await store.manage({ action: 'collection-save', collection: { id: 'folder', name: '收藏夹' } });
  const assigned = await store.manage({ action: 'metadata', ids: entries.map(entry => entry.id), appendCollectionId: 'folder' });
  assert.ok(assigned.entries.every(entry => entry.collectionIds.includes('folder')));
  assert.equal(assigned.entries.length, 4);
});

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

test('legacy version chains migrate on read and the byte-exact original backup is immutable', async t => {
  const { directory, store } = await temp(t);
  const legacy = { schema: 'juanye-bank/1', revision: 7, entries: [
    { id: 'root', question: fixture(), origin: { examTitle: '旧试卷', questionId: 'q1' }, createdAt: '2026-10-20', version: 1 },
    { id: 'revision', question: { ...fixture(), stem: '修改后的题干' }, origin: { examTitle: '旧试卷', questionId: 'q1' }, createdAt: '2026-10-21', version: 2, previousVersionId: 'root' },
  ] };
  const original = JSON.stringify(legacy, null, 2), target = path.join(directory, 'question-bank.json');
  await fs.writeFile(target, original);
  const loaded = await store.load();
  assert.deepEqual(loaded.collections, []);
  assert.deepEqual(loaded.entries.map(entry => [entry.libraryId, entry.favorite, entry.collectionIds, entry.usageCount]), [['root', false, [], 0], ['root', false, [], 0]]);
  assert.equal(await fs.readFile(target, 'utf8'), original);
  assert.deepEqual(await fs.readdir(directory), ['question-bank.json']);
  await store.manage({ action: 'metadata', ids: ['revision'], favorite: true });
  const preserved = path.join(directory, 'question-bank.pre-workspace.json');
  assert.equal(await fs.readFile(preserved, 'utf8'), original);
  await createQuestionBankStore({ directory }).manage({ action: 'trash', ids: ['root'] });
  assert.equal(await fs.readFile(preserved, 'utf8'), original);
  assert.equal((await store.load()).entries[0].favorite, true);
});

test('metadata and usage apply to every revision without creating content versions; trash can be restored', async t => {
  const { store } = await temp(t);
  await store.save({ questions: [fixture()], origin: { examTitle: 'A卷' } });
  const saved = await store.save({ questions: [{ ...fixture(), analysis: '新解析' }], origin: { examTitle: 'A卷' } });
  const ids = saved.bank.entries.map(entry => entry.id), keys = saved.bank.entries.map(entry => entry.contentKey);
  await store.manage({ action: 'collection-save', collection: { id: 'folder', name: '函数题集' } });
  let bank = await store.manage({ action: 'metadata', ids: [ids[0]], favorite: true, collectionIds: ['folder'] });
  assert.equal(bank.entries.length, 2);
  assert.deepEqual(bank.entries.map(entry => entry.version), [1, 2]);
  assert.deepEqual(bank.entries.map(entry => [entry.favorite, entry.collectionIds]), [[true, ['folder']], [true, ['folder']]]);
  bank = await store.markUsed(ids);
  assert.deepEqual(bank.entries.map(entry => entry.usageCount), [1, 1]);
  assert.equal(bank.entries[0].lastUsedAt, bank.entries[1].lastUsedAt);
  assert.deepEqual(bank.entries.map(entry => entry.contentKey), keys);
  bank = await store.manage({ action: 'trash', ids: [ids[1]] });
  assert.ok(bank.entries.every(entry => entry.trashedAt));
  const trashedRevision = bank.revision;
  assert.equal((await store.manage({ action: 'trash', ids: [ids[0]] })).revision, trashedRevision);
  bank = await store.manage({ action: 'restore-items', ids: [ids[0]] });
  assert.ok(bank.entries.every(entry => entry.trashedAt === undefined));
  assert.ok(bank.entries.every(entry => entry.favorite && entry.usageCount === 1));
  bank = await store.manage({ action: 'collection-delete', id: 'folder' });
  assert.deepEqual(bank.collections, []); assert.ok(bank.entries.every(entry => !entry.collectionIds.length));
});

test('explicit revisions retain library metadata, preserve old content and reject stale editors', async t => {
  const { store } = await temp(t);
  const saved = await store.save({ questions: [fixture()], origin: { examTitle: 'A卷', examId: 'exam-stable' } });
  const first = saved.bank.entries[0];
  await store.manage({ action: 'metadata', ids: [first.id], favorite: true });
  await store.markUsed([first.id]);
  const input = { id: first.id, question: { ...fixture(), analysis: '工作区编辑的解析' }, expectedContentKey: first.contentKey };
  const revised = await store.revise(input);
  assert.equal(revised.entry.libraryId, first.libraryId);
  assert.equal(revised.entry.previousVersionId, first.id); assert.equal(revised.entry.version, 2);
  assert.equal(revised.entry.favorite, true); assert.equal(revised.entry.usageCount, 1);
  assert.equal(revised.entry.origin.examId, 'exam-stable');
  assert.deepEqual(revised.bank.entries[0].question, first.question);
  await assert.rejects(store.revise(input), /已有更新/);
  await assert.rejects(store.revise({ ...input, id: revised.entry.id, expectedContentKey: 'wrong' }), /已有更新/);
  const noChange = await store.revise({ id: revised.entry.id, question: revised.entry.question, expectedContentKey: revised.entry.contentKey });
  assert.equal(noChange.bank.revision, revised.bank.revision); assert.equal(noChange.entry.id, revised.entry.id);
});

test('stable exam IDs and explicit bank provenance survive renaming and cloned question IDs', async t => {
  const { store } = await temp(t);
  const first = (await store.save({ questions: [fixture()], origin: { examTitle: '旧名', examId: 'exam-1' } })).bank.entries[0];
  const changed = { ...fixture(), stem: '新题干' };
  const second = (await store.save({ questions: [changed], origin: { examTitle: '新名', examId: 'exam-1' } })).bank.entries[1];
  assert.equal(second.libraryId, first.libraryId); assert.equal(second.version, 2);
  await store.manage({ action: 'metadata', ids: [first.id], favorite: true });
  const clone = { ...changed, id: 'cloned-question', bankOrigin: { libraryId: first.libraryId, revisionId: first.id, version: 1 } };
  assert.equal(contentKey(clone), contentKey(changed));
  const duplicate = await store.save({ questions: [clone], origin: { examTitle: '另一张卷' } });
  assert.equal(duplicate.duplicates, 1);
  const result = await store.save({ questions: [{ ...clone, analysis: '从试卷保存的新解析' }], origin: { examTitle: '另一张卷' } });
  assert.equal(result.bank.entries[2].libraryId, first.libraryId); assert.equal(result.bank.entries[2].version, 3);
  assert.equal(result.bank.entries[2].favorite, true);
  await assert.rejects(store.save({ questions: [{ ...clone, bankOrigin: { ...clone.bankOrigin, version: 999 }, stem: '不能保存' }] }), /来源版本不匹配/);
  const fromOriginalExam = await store.save({ questions: [{ ...fixture(), analysis: '原试卷再次修改' }], origin: { examTitle: '新名', examId: 'exam-1' } });
  assert.equal(fromOriginalExam.bank.entries[3].version, 4);
  assert.equal(fromOriginalExam.bank.entries[3].previousVersionId, result.bank.entries[2].id);
});

test('bank imports preserve complete packages, are idempotent and reject conflicts transactionally', async t => {
  const { store: source } = await temp(t), { directory, store } = await temp(t);
  const first = (await source.save({ questions: [fixture()], origin: { examTitle: 'A卷', examId: 'stable' } })).bank.entries[0];
  await source.revise({ id: first.id, question: { ...fixture(), analysis: '第二版' }, expectedContentKey: first.contentKey });
  await source.manage({ action: 'collection-save', collection: { id: 'folder', name: '导入题集' } });
  await source.manage({ action: 'collection-save', collection: { id: 'child', name: '子题集', parentId: 'folder' } });
  await source.manage({ action: 'metadata', ids: [first.id], favorite: true, collectionIds: ['child'] });
  await source.markUsed([first.id]);
  const exported = await source.load(), imported = await store.importBank(JSON.stringify(exported));
  assert.equal(imported.added, 2); assert.equal(imported.duplicates, 0);
  assert.deepEqual(imported.bank.entries, exported.entries); assert.deepEqual(imported.bank.collections, exported.collections);
  const file = path.join(directory, 'question-bank.json'), bytes = await fs.readFile(file, 'utf8');
  const repeated = await store.importBank(exported);
  assert.equal(repeated.added, 0); assert.equal(repeated.duplicates, 2); assert.equal(repeated.bank.revision, imported.bank.revision);
  assert.equal(await fs.readFile(file, 'utf8'), bytes);
  const conflict = structuredClone(exported); conflict.entries[1].question.stem = '同 ID 不同内容';
  conflict.collections.push({ id: 'must-not-import', name: '不应部分写入' });
  await assert.rejects(store.importBank(conflict), /ID 冲突/);
  assert.equal(await fs.readFile(file, 'utf8'), bytes);
  const invalid = structuredClone(exported); invalid.entries[1].question.figure = 'https://example.com/image.png';
  await assert.rejects(store.importBank(invalid), /内嵌图片/);
  assert.equal(await fs.readFile(file, 'utf8'), bytes);
  const conflictingFolder = structuredClone(exported); conflictingFolder.collections[0].name = '冲突题集';
  await assert.rejects(store.importBank(conflictingFolder), /题集 ID 冲突/);
});

test('collection and version graph validation rejects cycles and formula sources are never collapsed', async t => {
  const { store } = await temp(t);
  await store.manage({ action: 'collection-save', collection: { id: 'a', name: 'A' } });
  await store.manage({ action: 'collection-save', collection: { id: 'b', name: 'B', parentId: 'a' } });
  const before = await store.load();
  await assert.rejects(store.manage({ action: 'collection-save', collection: { id: 'a', name: 'A', parentId: 'b' } }), /循环/);
  assert.deepEqual(await store.load(), before);
  const q = fixture(), alternate = { ...q, id: 'q2', stem: q.stem.replace('x^2', 'x_2') };
  const saved = await store.save({ questions: [q, alternate] }); assert.equal(saved.added, 2);
  const malformed = structuredClone(saved.bank); malformed.entries[0].previousVersionId = malformed.entries[0].id;
  assert.throws(() => checkedBank(malformed), /循环/);
  await assert.rejects(store.manage({ action: 'metadata', ids: [saved.bank.entries[0].id], collectionIds: ['missing'] }), /不存在/);
});
