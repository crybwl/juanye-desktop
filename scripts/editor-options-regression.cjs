/* Offline editor-only options QA: real textarea events, isolated draft, no OCR/PDF requests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');

const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const suffix = packaged ? 'packaged' : 'source';
const output = path.join(root, 'artifacts/qa-editor-options');
const sample = '**2.** 为研究某新品种水稻的产量，某农业科技站随机选取了 5 块面积相同的试验田，现测得其亩产量（单位：kg）分别为：$610，620，630，640，700$，则（　　）\n\nA. 该组数据极差为 80\nB. 该组数据中位数为 630\nC. 由样本数据可知，该地区所有试验田的亩产量均不超过 700 kg\nD. 该组数据中，数据“700”存在较大误差，计算平均数时应舍去。';
const expected = ['该组数据极差为 80', '该组数据中位数为 630', '由样本数据可知，该地区所有试验田的亩产量均不超过 700 kg', '该组数据中，数据“700”存在较大误差，计算平均数时应舍去。'];
const emptyOptions = ['', '', '', ''];
const localOptions = ['本地保留 A', '本地保留 B', '本地保留 C', '本地保留 D'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(60); }
  throw new Error(message);
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-editor-options-qa-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const q = (id, stem, options = emptyOptions) => ({ id, type: 'single', score: 5, stem, options: [...options], answer: [], analysis: '' });
  const exam = { title: '编辑台选项拆分 · 水稻样例', subtitle: '', duration: 120, notice: [], sections: [
    { id: 'qa-single', type: 'single', title: '单项选择题', note: '', questions: [q('qa-existing', sample), q('qa-paste', ''), q('qa-typing', ''), q('qa-conflict', sample, localOptions)] },
  ] };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: true, answerMode: 'none' };
  fs.writeFileSync(path.join(userData, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  fs.mkdirSync(output, { recursive: true });
  let app, page, stage = 'launch', network = 0, timedOut = false;
  const checks = [], errors = [], values = {};
  const progress = name => { stage = name; console.log(JSON.stringify({ progress: stage })); };
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(JSON.stringify({ passed: false, stage, error: 'Editor options QA exceeded 90 seconds' }));
    try { app?.process().kill(); } catch {}
    process.exitCode = 1;
  }, 90000);
  try {
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? [] : [root], env, timeout: 25000 });
    await app.evaluate(({ BrowserWindow, session, ipcMain }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (typeof window?.webContents.setBackgroundThrottling === 'function') window.webContents.setBackgroundThrottling(false);
      globalThis.__editorOptionsNetwork = 0; globalThis.__editorOptionsModelCalls = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { globalThis.__editorOptionsNetwork++; callback({ cancel: true }); });
      ipcMain.removeHandler('model:recognize');
      ipcMain.handle('model:recognize', () => { globalThis.__editorOptionsModelCalls++; throw new Error('Editor-only QA must not invoke a model'); });
    });
    page = await app.firstWindow(); page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => { network++; return route.abort('blockedbyclient'); });
    await page.setViewportSize({ width: 1440, height: 940 });
    const editor = page.locator('.workspace-editor-stage');
    const stem = () => editor.getByPlaceholder('输入题干…', { exact: true });
    const sidebar = () => page.getByRole('complementary', { name: '试卷目录', exact: true });
    const draft = () => page.evaluate(() => window.juanye.loadDraft());
    const question = async id => (await draft()).exam.sections.flatMap(section => section.questions).find(item => item.id === id);
    const select = async id => {
      await sidebar().locator(`[data-question-id="${id}"]`).getByRole('button').first().click();
      const number = ['qa-existing', 'qa-paste', 'qa-typing', 'qa-conflict'].indexOf(id) + 1;
      await editor.getByRole('heading', { name: `第 ${number} 题`, level: 1, exact: true }).waitFor();
      await stem().waitFor();
      await pause(250);
    };
    const fields = async () => {
      const result = [];
      for (const letter of 'ABCD') {
        const card = editor.getByRole('button', { name: `将 ${letter} 设为正确答案`, exact: true }).locator('..');
        await card.locator('.cursor-text').click({ force: true });
        const input = card.locator('input');
        result.push(await input.inputValue());
        await input.press('Enter');
      }
      return result;
    };
    const assertSplit = async (id, inspectFields = false) => {
      await until(async () => JSON.stringify((await question(id))?.options) === JSON.stringify(expected), `${id}: options were not populated and saved`);
      const item = await question(id);
      assert.match(item.stem, /为研究某新品种水稻的产量/);
      assert.doesNotMatch(item.stem, /(?:^|\n)[A-D]\.\s/);
      assert.ok(item.stem.includes('$610，620，630，640，700$'), 'Original math content was altered');
      if (inspectFields) assert.deepEqual(await fields(), expected, `${id}: editor fields disagree with saved values`);
      else for (const letter of 'ABCD') await editor.getByRole('button', { name: `将 ${letter} 设为正确答案`, exact: true }).waitFor();
      values[id] = { stem: item.stem, options: item.options };
    };
    await stem().waitFor();
    progress('Existing selected question automatically fills four empty option fields');
    await until(async () => JSON.stringify((await question('qa-existing'))?.options) === JSON.stringify(expected), 'Existing question did not auto-split on startup');
    if ((await sidebar().getAttribute('data-sidebar-state')) !== 'expanded') await sidebar().getByRole('button', { name: '展开目录面板', exact: true }).click();
    await assertSplit('qa-existing', true);
    checks.push('The exact user-provided rice-yield sample automatically fills all four option fields for an existing selected choice');
    progress('Undo restores raw stem without immediately applying the extraction again');
    await sidebar().getByRole('button', { name: '撤销', exact: true }).click();
    await until(async () => (await stem().inputValue()) === sample, 'Undo did not restore the raw question');
    await pause(1000);
    assert.equal(await stem().inputValue(), sample, 'Automatic extraction ran again after undo');
    const undone = await question('qa-existing');
    assert.deepEqual(undone.options, emptyOptions);
    assert.equal(undone.stem, sample);
    await sidebar().getByRole('button', { name: '重做', exact: true }).click();
    await until(async () => JSON.stringify((await question('qa-existing'))?.options) === JSON.stringify(expected), 'Redo did not restore extracted options');
    checks.push('Undo keeps the full original stem and empty fields unchanged; redo restores the extraction');
    progress('Pasting into the actual stem textarea immediately fills A/B/C/D');
    await select('qa-paste');
    assert.equal(await stem().inputValue(), '');
    await stem().evaluate((el, text) => {
      el.focus();
      const transfer = new DataTransfer(); transfer.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    }, sample);
    await until(async () => !(await stem().inputValue()).includes('\nA.'), 'Paste left option labels inside the stem');
    await assertSplit('qa-paste');
    checks.push('The real textarea paste handler immediately distributes the sample into A/B/C/D without an OCR request');
    progress('Ordinary input waits until the stem loses focus');
    await select('qa-typing');
    await stem().fill(sample);
    await pause(700);
    assert.equal(await stem().inputValue(), sample, 'Ordinary input was extracted before blur');
    assert.ok(await stem().evaluate(el => el === document.activeElement), 'Typing test unexpectedly lost focus');
    assert.deepEqual((await question('qa-typing')).options, emptyOptions);
    await editor.getByRole('spinbutton', { name: '本题分值', exact: true }).click();
    await assertSplit('qa-typing');
    checks.push('Normal typing leaves the full text intact while focused, then fills the options on blur');
    progress('Conflicting local option edits are preserved');
    await select('qa-conflict');
    await pause(800);
    const conflicting = await question('qa-conflict');
    assert.equal(await stem().inputValue(), sample);
    assert.equal(conflicting.stem, sample);
    assert.deepEqual(conflicting.options, localOptions);
    for (const letter of 'ABCD') await editor.getByRole('button', { name: `将 ${letter} 设为正确答案`, exact: true }).waitFor();
    checks.push('Existing non-empty local options are not overwritten and conflicting stem content is not deleted');
    await select('qa-paste');
    await editor.getByRole('heading', { name: '选项', exact: true }).evaluate(el => el.scrollIntoView({ block: 'center' }));
    await page.mouse.move(5, 5); await pause(650);
    const screenshot = path.join(output, `editor-options-${suffix}.png`);
    await page.screenshot({ path: screenshot });
    const cloudRequests = network + await app.evaluate(() => globalThis.__editorOptionsNetwork);
    const modelCalls = await app.evaluate(() => globalThis.__editorOptionsModelCalls);
    assert.equal(cloudRequests, 0); assert.equal(modelCalls, 0); assert.deepEqual(errors, []); assert.equal(timedOut, false);
    const report = { passed: true, packaged, checks, cloudRequests, modelCalls, pdfExports: 0, errors, screenshot, isolatedDraft: true, values };
    fs.writeFileSync(path.join(output, `editor-options-results-${suffix}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, values: undefined }));
  } catch (error) {
    const report = { passed: false, packaged, stage, error: String(error), checks, errors, timedOut };
    fs.writeFileSync(path.join(output, `editor-options-results-${suffix}.json`), JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report));
    throw error;
  } finally {
    clearTimeout(timer);
    if (app) {
      try { await Promise.race([app.close(), pause(5000).then(() => { try { app.process().kill(); } catch {} })]); } catch {}
    }
    const resolved = fs.realpathSync(userData);
    if (path.dirname(resolved).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase() && path.basename(resolved).startsWith('juanye-editor-options-qa-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
