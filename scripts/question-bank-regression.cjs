/* Local-bank UI integration: isolated synthetic documents; never calls a model. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const capture = process.argv.includes('--screenshots');
const suffix = packaged ? 'packaged' : 'source';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6UGkAAAAASUVORK5CYII=';

async function until(predicate, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(50); }
  throw Error(message);
}
async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-bank-ui-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const q1 = { id: 'bank-fixture-q1', type: 'single', score: 5, stem: '题库指数题：已知 $x=2$，则 $x^2=$（　）。', options: ['$1$', '$2$', '$3$', '$4$'], answer: ['D'], analysis: '代入 $x=2$，得 $x^2=4$。', source: '市统考', knowledge: ['指数'], difficulty: 'easy', figures: [{ id: 'fixture-figure', src: png, layout: 'right', caption: '示意图', width: 35 }], sourceImage: png };
  const q2 = { id: 'bank-fixture-q2', type: 'essay', score: 12, stem: '题库函数题：求函数 $f(x)=x^2$ 的导函数。', options: [], answer: ["$f'(x)=2x$"], analysis: '利用幂函数求导法则。', source: '教辅', knowledge: ['导数'], difficulty: 'hard' };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'none' };
  const examA = { title: '题库样例 A 卷', subtitle: '', duration: 90, notice: [], sections: [{ id: 's1', type: 'single', title: '单项选择题', note: '', questions: [q1] }, { id: 's2', type: 'essay', title: '解答题', note: '', questions: [q2] }] };
  const examB = { title: '题库样例 B 卷', subtitle: '', duration: 90, notice: [], sections: [{ id: 'b-section', type: 'single', title: '单项选择题', note: '', questions: [] }] };
  const draft = exam => ({ version: 1, exam, layout, history: [] });
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify(draft(examA)));
  let app, page;
  const errors = [], checks = [], screenshots = [];
  const watchdog = setTimeout(() => { app?.process().kill(); process.exitCode = 1; }, 85000);
  const bankPanel = () => page.getByRole('dialog', { name: '本地题库', exact: true });
  async function openBank() {
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder('搜索题目、执行命令…', { exact: true }).fill('本地题库');
    await page.getByRole('button', { name: '本地题库', exact: true }).click();
    await bankPanel().getByRole('button', { name: '保存当前题', exact: true }).waitFor();
    await until(async () => !(await bankPanel().getByRole('status').count()), 'Bank load did not finish');
  }
  async function select(label, name) {
    await bankPanel().getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
  }
  async function bankCount(count) {
    await until(async () => await page.evaluate(async () => (await window.juanye.bankLoad()).entries.length) === count, `Expected ${count} bank entries`);
  }
  try {
    const flags = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? flags : [root, ...flags], env });
    await app.evaluate(({ BrowserWindow, ipcMain, session }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setSize(1500, 980); win.setPosition(-16000, -16000); win.showInactive();
      globalThis.__bankUiRequests = 0; globalThis.__bankUiModels = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => { globalThis.__bankUiRequests++; cb({ cancel: true }); });
      ipcMain.removeHandler('model:recognize'); ipcMain.handle('model:recognize', () => { globalThis.__bankUiModels++; throw Error('No OCR during bank QA'); });
    });
    page = await app.firstWindow(); page.setDefaultTimeout(8000); await page.setViewportSize({ width: 1500, height: 980 });
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => void dialog.accept());
    await page.getByPlaceholder('输入题干…', { exact: true }).waitFor();
    await openBank();
    await bankPanel().getByRole('button', { name: '保存当前题', exact: true }).click(); await bankCount(1);
    await bankPanel().getByRole('button', { name: '保存整卷', exact: true }).click(); await bankCount(2);
    await bankPanel().getByRole('button', { name: '保存整卷', exact: true }).click(); await pause(180); await bankCount(2);
    const stored = await page.evaluate(() => window.juanye.bankLoad());
    assert.deepEqual(stored.entries.find(entry => entry.question.id === q1.id).question, q1);
    assert.deepEqual(stored.entries.find(entry => entry.question.id === q2.id).question, q2);
    assert.equal(await bankPanel().locator('[data-bank-id]').count(), 2);
    checks.push('Current question and whole-paper save use independent durable storage; repeated saves are idempotent and preserve formula/image/answer/analysis fields');
    await select('题库题型', '解答题'); assert.equal(await bankPanel().locator('[data-bank-id]').count(), 1);
    await select('题库难度', '较难'); await select('题库知识点', '导数'); await select('题库来源', '教辅');
    await bankPanel().getByRole('textbox', { name: '搜索题库', exact: true }).fill('函数'); assert.equal(await bankPanel().locator('[data-bank-id]').count(), 1);
    await bankPanel().getByRole('textbox', { name: '搜索题库', exact: true }).fill('指数'); assert.equal(await bankPanel().locator('[data-bank-id]').count(), 0);
    await bankPanel().getByRole('textbox', { name: '搜索题库', exact: true }).fill('');
    await select('题库题型', '全部题型'); await select('题库难度', '全部难度'); await select('题库知识点', '全部知识点'); await select('题库来源', '全部来源');
    assert.equal(await bankPanel().locator('[data-bank-id]').count(), 2);
    checks.push('Knowledge/difficulty/source/type filters and searchable content combine correctly');
    await bankPanel().getByRole('button', { name: '关闭本地题库', exact: true }).click();
    await pause(1000); fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify(draft(examB)));
    await page.reload(); await until(async () => (await page.evaluate(() => window.juanye.loadDraft())).exam.title === examB.title, 'New paper not loaded');
    await openBank(); assert.equal(await bankPanel().locator('[data-bank-id]').count(), 2);
    await bankPanel().getByRole('checkbox', { name: '全选筛选结果', exact: true }).click();
    await bankPanel().getByRole('button', { name: '加入所选 2 道题', exact: true }).click();
    let added;
    await until(async () => { added = await page.evaluate(() => window.juanye.loadDraft()); return added.exam.sections[0].questions.length === 2; }, 'Batch insertion was not saved');
    const inserted = added.exam.sections[0].questions;
    assert.deepEqual(inserted.map(q => q.type), ['single', 'essay']); assert.notEqual(inserted[0].id, q1.id); assert.notEqual(inserted[0].figures[0].id, q1.figures[0].id);
    assert.deepEqual(inserted[0].options, q1.options); assert.deepEqual(inserted[0].answer, q1.answer); assert.equal(inserted[0].analysis, q1.analysis);
    assert.deepEqual(inserted[1].answer, q2.answer); assert.equal(inserted[1].analysis, q2.analysis);
    const bankId = stored.entries[0].id;
    // Exercise a native drag transfer: only the local record ID enters the drop target.
    const transfer = await page.evaluateHandle(id => { const data = new DataTransfer(); data.setData('application/x-juanye-bank-id', JSON.stringify([id])); return data; }, bankId);
    const target = page.locator('.workspace-editor-stage');
    await target.dispatchEvent('dragover', { dataTransfer: transfer }); await target.dispatchEvent('drop', { dataTransfer: transfer });
    await until(async () => (await page.evaluate(() => window.juanye.loadDraft())).exam.sections[0].questions.length === 3, 'Bank drag/drop did not add a question');
    assert.equal((await page.evaluate(() => window.juanye.bankLoad())).entries.length, 2);
    checks.push('A different paper can batch-insert and drag-in bank questions, with fresh question/figure IDs and no source-record mutation');
    await bankPanel().getByRole('checkbox', { name: '全选筛选结果', exact: true }).click();
    await bankPanel().getByRole('button', { name: '移除', exact: true }).click(); await bankCount(0);
    assert.equal((await page.evaluate(() => window.juanye.loadDraft())).exam.sections[0].questions.length, 3);
    await bankPanel().getByRole('button', { name: '恢复上次备份', exact: true }).click(); await bankCount(2);
    checks.push('Confirmed deletion affects only the bank and restoring its last backup recovers the removed batch');
    const out = path.join(root, 'artifacts/qa-question-bank'); fs.mkdirSync(out, { recursive: true });
    if (capture) {
      await page.evaluate(async () => { localStorage.setItem('juanye.appearance.v1', 'light'); window.dispatchEvent(new StorageEvent('storage', { key: 'juanye.appearance.v1', newValue: 'light' })); await document.fonts.ready; });
      await pause(300);
      const target = path.join(out, `question-bank-${suffix}.png`);
      const encoded = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'));
      fs.writeFileSync(target, Buffer.from(encoded, 'base64')); screenshots.push(target);
    }
    const requests = await app.evaluate(() => ({ cloudRequests: globalThis.__bankUiRequests, modelCalls: globalThis.__bankUiModels }));
    assert.deepEqual(requests, { cloudRequests: 0, modelCalls: 0 }); assert.deepEqual(errors, []);
    const result = { passed: true, packaged, checks, screenshots, ...requests, errors };
    fs.writeFileSync(path.join(out, `results-${suffix}.json`), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally {
    clearTimeout(watchdog); if (app) await app.close().catch(() => app.process().kill());
    const resolved = fs.realpathSync(profile); assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); assert.ok(path.basename(resolved).startsWith('juanye-bank-ui-')); fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
