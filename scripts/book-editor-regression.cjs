/* Public UI regression only. Isolated synthetic book, no real keys/network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..'), packaged = process.argv.includes('--packaged');
const out = path.join(root, 'artifacts/qa-book-editor', packaged ? 'packaged' : 'source');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { const deadline = Date.now() + 12000; while (Date.now() < deadline) { if (await check()) return; await pause(45); } throw Error(label); }
async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-book-editor-'));
  const q = id => ({ id, type: 'single', score: 5, stem: `隔离题目${id}：$1+1=$`, options: ['$1$', '$2$', '$3$', '$4$'], answer: ['B'], analysis: '相加得$2$。' });
  const paragraph = text => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
  const book = { version: 1, kind: 'juanye-book', id: 'book-editor-qa', title: '教辅编辑隔离样例', author: '本机验证', chapters: [
    { id: 'one', title: '第一章', kind: 'chapter', content: { type: 'doc', content: [paragraph('第一章正文'), { type: 'bookQuestion', attrs: { questionId: 'q1' } }, { type: 'bookQuestion', attrs: { questionId: 'q2' } }, paragraph('第一章末段')] } },
    { id: 'two', title: '第二章', kind: 'chapter', content: { type: 'doc', content: [paragraph('第二章正文'), { type: 'bookQuestion', attrs: { questionId: 'q3' } }, paragraph('第二章末段')] } },
  ], questions: { q1: q('q1'), q2: q('q2'), q3: q('q3') }, settings: { paper: 'B5', marginTop: 17, marginBottom: 17, marginInner: 20, marginOuter: 16, fontFamily: 'SimSun, serif', fontSize: 10.5, lineHeight: 1.65, paragraphGap: 2, questionGap: 3, numbering: 'chapter', answers: 'book', toc: true, pageNumbers: true, header: '', footer: '', chapterNewPage: true } };
  fs.writeFileSync(path.join(profile, 'book-draft.json'), JSON.stringify(book)); fs.mkdirSync(out, { recursive: true });
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page, report, stage = 'launch'; const checks = [], errors = []; let network = 0;
  const html = packaged ? path.join(root, 'release/win-unpacked/resources/app.asar') : path.join(root, 'dist/index.html');
  const buildHash = crypto.createHash('sha256').update(fs.readFileSync(html)).digest('hex');
  const watchdog = setTimeout(() => { app?.process().kill(); console.error(`Book editor timed out at ${stage}`); process.exit(1); }, 100000);
  const progress = value => { stage = value; console.log(JSON.stringify({ stage, packaged })); };
  try {
    const flags = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? flags : [root, ...flags], env });
    await app.evaluate(({ BrowserWindow, ipcMain }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setPosition(-16000, -16000); win.showInactive();
      globalThis.__bookEditorModels = 0;
      for (const channel of ['model:test', 'model:recognize', 'model:generate', 'exam:analyze']) { ipcMain.removeHandler(channel); ipcMain.handle(channel, () => { globalThis.__bookEditorModels++; throw Error('Models disabled for book editor QA'); }); }
    });
    page = await app.firstWindow(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message)); await page.setViewportSize({ width: 1500, height: 980 });
    await page.route(/^https?:\/\//, route => { network++; return route.abort('blockedbyclient'); });
    const nav = page.getByRole('navigation', { name: '工作区', exact: true });
    await nav.getByRole('button', { name: '教辅编辑台', exact: true }).click();
    const editor = page.getByTestId('book-editor'), prose = editor.locator('[contenteditable=true][aria-label="教辅章节正文"]');
    await prose.waitFor(); await until(() => prose.innerText().then(value => value.includes('第一章正文')), 'Initial chapter not loaded');
    const load = () => page.evaluate(() => window.juanye.bookLoad());
    const nodeTypes = node => [node.type, ...(node.content || []).flatMap(nodeTypes)];
    progress('continuous prose, inline math, native tables and block layout');
    await prose.locator('> p').first().click(); await page.keyboard.press('End'); await page.keyboard.type(' FIRST_TYPED'); await page.keyboard.press('Enter'); await page.keyboard.type('正文公式 $x^2$ ');
    await until(async () => nodeTypes((await load()).chapters[0].content).includes('inlineMath'), 'Dollar input rule did not create an editable math node');
    const proseText=node=>(node.type==='text'?node.text:'')+(node.content||[]).map(proseText).join('');
    await until(async()=>!proseText((await load()).chapters[0].content).includes('$'),'Math input must consume both delimiters instead of leaving raw dollar signs');
    await editor.getByRole('button', { name: '插入表格', exact: true }).click();
    await prose.locator('table').waitFor();
    await editor.getByRole('button', { name: '加行', exact: true }).click();
    assert.equal(await prose.locator('table tr').count(), 4);
    await prose.locator('> p').first().click(); await editor.getByRole('button', { name: '当前块排版', exact: true }).click(); await editor.getByLabel('块前间距', { exact: true }).fill('9');
    await until(async () => (await load()).chapters[0].content.content[0].attrs.spaceBefore === 9, 'Block spacing was not persisted');
    checks.push('Continuous text/Enter, inline math input, table add-row and per-block spacing persist as structured content');
    progress('inline question fields, option splitting and last keystroke chapter isolation');
    await editor.getByRole('button', { name: '编辑教辅题目 1.1', exact: true }).click();
    const stem = editor.getByRole('textbox', { name: '教辅题干 1.1', exact: true });
    await stem.fill('新题干\n');
    await stem.evaluate(element => { const data = new DataTransfer(); data.setData('text/plain', 'A. $1$\nB. $2$\nC. $3$\nD. $4$'); element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); });
    await until(async () => { const current = await load(); return current.questions.q1.stem.includes('新题干') && current.questions.q1.options[3] === '$4$' && !current.questions.q1.stem.includes('A.'); }, 'ABCD paste did not populate actual option fields');
    await stem.focus(); await stem.press('Control+End'); await stem.pressSequentially(' FINAL_Q1');
    await page.locator('.book-chapters button').filter({ hasText: '第二章' }).click();
    await until(async () => (await load()).questions.q1.stem.endsWith(' FINAL_Q1'), 'Last question edit was not saved before chapter switch');
    assert.deepEqual((await load()).questions.q2, book.questions.q2); assert.deepEqual((await load()).questions.q3, book.questions.q3);
    await until(() => prose.innerText().then(value => value.includes('第二章正文')), 'Second chapter did not replace current editor');
    await prose.locator('> p').first().click(); await page.keyboard.press('End'); await page.keyboard.type(' SECOND_TYPED');
    await page.locator('.book-chapters button').filter({ hasText: '第一章' }).click();
    await until(async () => JSON.stringify((await load()).chapters[1].content).includes('SECOND_TYPED'), 'Last prose edit was not saved before chapter switch');
    checks.push('Question stem/options edit real snapshots; ABCD splitting works; immediate chapter switches preserve last input and untouched question IDs');
    progress('question copy/paste clones snapshots and keeps unique references');
    await until(() => editor.locator('[data-book-question=q1]').count().then(value => value === 1), 'First chapter did not return');
    const copied = await editor.locator('[data-book-question=q1]').getAttribute('data-book-question'); assert.equal(copied, 'q1');
    const copiedHtml = await editor.locator('[data-book-question=q1]').evaluate(element => element.outerHTML);
    await prose.locator('> p').last().click(); await page.keyboard.press('End');
    await prose.evaluate((element, html) => { const data = new DataTransfer(); data.setData('text/html', html); element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); }, copiedHtml);
    const references = node => [...(node.type === 'bookQuestion' ? [node.attrs.questionId] : []), ...(node.content || []).flatMap(references)];
    await until(async () => references((await load()).chapters[0].content).length === 3, 'Question paste did not clone its snapshot');
    const latest = await load(), ids = references(latest.chapters[0].content); assert.equal(new Set(ids).size, 3); assert.ok(ids.every(id => latest.questions[id]));
    const cloneId = ids.find(id => id !== 'q1' && id !== 'q2'); assert.equal(latest.questions[cloneId].stem, latest.questions.q1.stem); assert.notEqual(cloneId, 'q1');
    checks.push('Question HTML paste clones a new editable snapshot ID; duplicate references never reach persisted book data');
    assert.deepEqual(errors, []); assert.equal(network, 0); assert.equal(await app.evaluate(() => globalThis.__bookEditorModels), 0);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(html)).digest('hex'), buildHash, 'Build changed during UI validation');
    await page.screenshot({ path: path.join(out, 'book-editor.png') });
    report = { passed: true, packaged, checks, errors, network, buildHash };
  } catch (error) { await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); report = { passed: false, stage, error: error.stack || String(error), errors, checks }; process.exitCode = 1; }
  finally {
    clearTimeout(watchdog); await app?.close().catch(() => app.process().kill()); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    const resolved = fs.realpathSync(profile), temporary = fs.realpathSync(os.tmpdir()); if (path.dirname(resolved).toLowerCase() === temporary.toLowerCase() && path.basename(resolved).startsWith('juanye-book-editor-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
