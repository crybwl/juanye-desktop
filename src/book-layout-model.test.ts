import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { createBlankBook, upgradeBookLayoutVersion, validateBookProject, type BookNode, type BookProject } from './book-model';
import { DEFAULT_BOOK_ANSWER_AREA, DEFAULT_BOOK_BLOCK_STYLES } from './book-blocks';
import { exportBookProject, importBookProject } from './book-project';
const { validateStoredBook, createBookStore } = createRequire(import.meta.url)('../electron/book-store.cjs');

const paragraph = (text = '段落'): BookNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const columns = (content: BookNode[] = [paragraph()]): BookNode => ({ type: 'columnSet', attrs: { count: 2, gap: 6, rule: true }, content });
function fixture(): BookProject {
  const book = createBlankBook(); book.version = 2;
  book.styles = structuredClone([...DEFAULT_BOOK_BLOCK_STYLES]);
  book.chapters[1].content.content = [paragraph('单栏讲解'), columns([
    { type: 'heading', attrs: { level: 2, columnSpan: 'all' }, content: [{ type: 'text', text: '跨栏标题' }] },
    { type: 'callout', attrs: { styleId: 'example' }, content: [paragraph('例题')] },
    { type: 'columnBreak' }, { type: 'answerArea', attrs: { ...DEFAULT_BOOK_ANSWER_AREA } },
  ]), paragraph('恢复通栏')]; return book;
}
function bothReject(value: unknown) { assert.throws(() => validateBookProject(value)); assert.throws(() => validateStoredBook(value)); }

test('v2 flow, styles, counters and answer areas survive both validators and portable ZIP', async () => {
  const book = fixture(), checked = validateBookProject(book);
  assert.deepEqual(validateStoredBook(book), checked);
  const bytes = await exportBookProject(book), zip = await JSZip.loadAsync(bytes);
  assert.equal(JSON.parse(await zip.file('manifest.json')!.async('string')).schema, 'juanye-book/2');
  assert.deepEqual(await importBookProject(bytes), checked);
});
test('old projects retain v1; explicit editor upgrade is required for new feature nodes', () => {
  const old = createBlankBook(); delete (old.settings as Partial<typeof old.settings>).optionColumns;
  const loaded = validateBookProject(old); assert.equal(loaded.version, 1); assert.equal(loaded.settings.optionColumns, 'auto');
  const modified = createBlankBook(); modified.chapters[1].content.content = [columns()];
  bothReject(modified); const upgraded = upgradeBookLayoutVersion(modified);
  assert.equal(upgraded.version, 2); assert.equal(modified.version, 1);
  assert.equal(validateBookProject(upgraded).version, 2);
});
test('columns cannot nest and column breaks cannot escape their direct flow', () => {
  for (const content of [
    [{ type: 'columnBreak' }],
    [{ type: 'callout', attrs: { kind: 'lesson' }, content: [columns()] }],
    [columns([columns()])],
    [columns([{ type: 'blockquote', content: [{ type: 'columnBreak' }] }])],
    [columns([{ type: 'doc', content: [paragraph()] }])],
  ] as BookNode[][]) { const book = fixture(); book.chapters[1].content.content = content; bothReject(book); }
});
test('strict numeric, boolean and atom constraints reject malformed flow attributes', () => {
  const mutations: ((book: BookProject) => void)[] = [
    b => { b.chapters[1].content.content = [{ ...columns(), attrs: { count: 5, gap: 6, rule: false } }]; },
    b => { b.chapters[1].content.content = [{ ...columns(), attrs: { count: 2, gap: 21, rule: false } }]; },
    b => { b.chapters[1].content.content = [{ ...columns(), attrs: { count: 2, gap: 6, rule: 'true' } }]; },
    b => { b.chapters[1].content.content = [{ ...columns(), content: [] }]; },
    b => { b.chapters[1].content.content = [columns([{ type: 'columnBreak', attrs: { ignored: null } }])]; },
    b => { b.chapters[1].content.content = [columns([{ type: 'columnBreak', content: [paragraph()] }])]; },
    b => { b.chapters[1].content.content = [{ type: 'heading', attrs: { level: 2, columnSpan: 'all' } }]; },
    b => { b.settings.optionColumns = 3 as never; },
  ]; for (const mutate of mutations) { const book = fixture(); mutate(book); bothReject(book); }
});
test('per-question option attributes accept only null auto 1 2 4 and survive persistence', () => {
  for (const optionColumns of [null,'auto',1,2,4]) {
    const book = fixture(); book.questions.q = { id: 'q', type: 'single', score: 5, stem: '题目', options: ['1','2','3','4'], answer: ['A'], analysis: '' };
    book.chapters[1].content.content = [columns([{ type: 'bookQuestion', attrs: { questionId: 'q', optionColumns } }])];
    assert.deepEqual(validateStoredBook(book), validateBookProject(book));
  }
  const book = fixture(); book.questions.q = { id:'q',type:'single',score:5,stem:'题目',options:[],answer:[],analysis:'' };
  book.chapters[1].content.content = [{ type:'bookQuestion',attrs:{questionId:'q',optionColumns:3} }]; bothReject(book);
});
test('answer areas enforce units, geometry and atom-only structure', () => {
  for (const kind of ['blank','lines','grid','coordinate']) { const book = fixture(); book.chapters[1].content.content = [{ type: 'answerArea', attrs: { ...DEFAULT_BOOK_ANSWER_AREA, kind, unit: 'mm', size: 60 } }]; assert.deepEqual(validateStoredBook(book), validateBookProject(book)); }
  for (const attrs of [
    { ...DEFAULT_BOOK_ANSWER_AREA, size: 2.5 }, { ...DEFAULT_BOOK_ANSWER_AREA, size: 40, lineHeight: 15 },
    { ...DEFAULT_BOOK_ANSWER_AREA, gridSize: 0 }, { ...DEFAULT_BOOK_ANSWER_AREA, unit: 'px' },
    { ...DEFAULT_BOOK_ANSWER_AREA, html: '<script/>' }, { ...DEFAULT_BOOK_ANSWER_AREA, lineHeight: null },
  ]) { const book = fixture(); book.chapters[1].content.content = [{ type:'answerArea',attrs }]; bothReject(book); }
});
test('style definitions reject CSS, arbitrary icons, missing references and malformed counters', () => {
  for (const change of [
    (b: BookProject) => { b.styles![0].background = 'url(https://bad)'; },
    (b: BookProject) => { b.styles![0].icon = '<svg onload="bad"/>'; },
    (b: BookProject) => { b.styles!.push(b.styles![0]); },
    (b: BookProject) => { b.styles![1].counter!.format = '例{bad}.{n}'; },
    (b: BookProject) => { b.styles![1].counter!.format = '{章}'; },
    (b: BookProject) => { b.styles![1].counter!.start = .5; },
    (b: BookProject) => { b.chapters[1].content.content = [{type:'callout',attrs:{styleId:'missing'},content:[paragraph()]}]; },
  ]) { const book = fixture(); change(book); bothReject(book); }
});
test('ZIP rejects mismatching version envelope even with a correct content hash', async () => {
  const zip = await JSZip.loadAsync(await exportBookProject(fixture()));
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')); manifest.schema = 'juanye-book/1';
  zip.file('manifest.json', JSON.stringify(manifest)); await assert.rejects(importBookProject(await zip.generateAsync({ type:'uint8array' })), /版本/);
});
test('v2 local saves and history restore all print data without touching old documents', async () => {
  const fs = await import('node:fs/promises'), os = await import('node:os'), path = await import('node:path');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'juanye-p0-model-'));
  try {
    const store = createBookStore({directory}), book = fixture();
    await store.save(book); const version = await store.checkpoint(book); await store.save({...book,title:'新标题'});
    assert.deepEqual(await store.version(version.id), book); assert.deepEqual(await store.restore(), book);
    assert.equal((await createBookStore({directory}).load()).version,2);
    const invalid = fixture(); invalid.chapters[1].content.content = [{type:'columnBreak'}];
    assert.throws(()=>store.save(invalid)); assert.deepEqual(await store.load(), book);
  } finally {
    const resolved = await fs.realpath(directory), parent = await fs.realpath(os.tmpdir());
    assert.equal(path.dirname(resolved).toLowerCase(),parent.toLowerCase()); assert.ok(path.basename(resolved).startsWith('juanye-p0-model-'));
    await fs.rm(resolved,{recursive:true,force:true});
  }
});
