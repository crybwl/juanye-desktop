/* Focused offline OCR options QA. Temporary draft and local IPC fixtures only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');

const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const suffix = packaged ? 'packaged' : 'source';
const output = path.join(root, 'artifacts/qa-ocr-options');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(60); }
  throw new Error(message);
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-ocr-options-qa-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNGcAAAAASUVORK5CYII=';
  const exam = { title: '选项自动填入 · 本地示例', subtitle: '', duration: 120, notice: [], sections: [
    { id: 'qa-choice', type: 'single', title: '单项选择题', note: '', questions: [] },
    { id: 'qa-essay', type: 'essay', title: '解答题', note: '', questions: [
      { id: 'qa-existing', type: 'essay', score: 12, stem: '待重新识别的原题。', options: [], answer: [], analysis: '', sourceImage: image },
    ] },
  ] };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: true, answerMode: 'none' };
  fs.writeFileSync(path.join(userData, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  fs.mkdirSync(output, { recursive: true });
  let app, page, stage = 'launch', network = 0, timedOut = false;
  const errors = [], checks = [];
  const progress = value => { stage = value; console.log(JSON.stringify({ progress: stage })); };
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(JSON.stringify({ passed: false, stage, error: 'OCR options QA exceeded 90 seconds' }));
    try { app?.process().kill(); } catch {}
    process.exitCode = 1;
  }, 90000);
  try {
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? [] : [root], env, timeout: 25000 });
    await app.evaluate(({ BrowserWindow, session, ipcMain }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (typeof window?.webContents.setBackgroundThrottling === 'function') window.webContents.setBackgroundThrottling(false);
      globalThis.__ocrOptionsNetwork = 0;
      globalThis.__ocrOptionsCalls = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { globalThis.__ocrOptionsNetwork++; callback({ cancel: true }); });
      ipcMain.removeHandler('model:get');
      ipcMain.handle('model:get', () => ({ hasKey: true, model: 'local-fixture', baseUrl: 'http://127.0.0.1' }));
      ipcMain.removeHandler('model:recognize');
      ipcMain.handle('model:recognize', () => {
        const call = ++globalThis.__ocrOptionsCalls;
        return JSON.stringify({ questions: [{ type: 'single', stem: `${call === 1 ? '1. 已知函数' : '2. 重新识别：已知函数'} $f(x)=x$，则 $f(2)$ 的值为 A. 1 B. 2 C. 3 D. 4`, options: [], answer: [], analysis: '' }] });
      });
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.route(/^https?:\/\//, route => { network++; return route.abort('blockedbyclient'); });
    await page.setViewportSize({ width: 1440, height: 940 });
    await page.waitForSelector('textarea');
    await page.evaluate(() => { localStorage.setItem('juanye.appearance.v1', 'telegram'); localStorage.setItem('juanye.sidebar-expanded.v1', 'true'); });
    await page.reload();
    await page.waitForSelector('.workspace-editor-stage textarea');
    const draft = () => page.evaluate(() => window.juanye.loadDraft());
    const question = async id => (await draft()).exam.sections.flatMap(section => section.questions).find(item => item.id === id);
    const sidebar = () => page.getByRole('complementary', { name: '试卷目录', exact: true });
    progress('OCR review automatically populates A/B/C/D fields');
    await page.getByRole('button', { name: '打开图片识别', exact: true }).click();
    const ocr = page.getByRole('dialog');
    await ocr.getByText('识别题目', { exact: true }).waitFor();
    await page.evaluate(png => {
      const raw = atob(png.split(',')[1]);
      const file = new File([Uint8Array.from(raw, char => char.charCodeAt(0))], 'question.png', { type: 'image/png' });
      const transfer = new DataTransfer(); transfer.items.add(file);
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, cancelable: true }));
    }, image);
    await ocr.getByRole('button', { name: '查看第 1 页', exact: true }).waitFor();
    await ocr.getByRole('button', { name: '开始识别', exact: true }).click();
    await until(() => ocr.getByRole('button', { name: '添加 1 道题到试卷', exact: true }).isEnabled(), 'Fixture recognition did not finish');
    await ocr.getByRole('button', { name: '编辑', exact: true }).click();
    const reviewStem = await ocr.getByRole('textbox', { name: '识别题干', exact: true }).inputValue();
    assert.match(reviewStem, /已知函数/);
    assert.doesNotMatch(reviewStem, /[A-D]\.\s*\d/);
    for (const [index, letter] of [...'ABCD'].entries()) assert.equal(await ocr.getByRole('textbox', { name: `选项 ${letter}`, exact: true }).inputValue(), `$${index + 1}$`);
    await ocr.getByRole('button', { name: '添加 1 道题到试卷', exact: true }).click();
    await until(async () => (await draft()).exam.sections.flatMap(section => section.questions).length === 2, 'Imported question was not saved');
    const imported = (await draft()).exam.sections.flatMap(section => section.questions).find(item => item.id !== 'qa-existing');
    assert.equal(imported.type, 'single');
    assert.deepEqual(imported.options, ['$1$', '$2$', '$3$', '$4$']);
    assert.doesNotMatch(imported.stem, /[A-D]\.\s*\d/);
    checks.push('OCR review separates inline A/B/C/D labels into editable math-normalized option fields and imports them once');
    progress('Imported option stays editable and persists to draft');
    const optionB = page.getByRole('button', { name: '将 B 设为正确答案', exact: true }).locator('..');
    await optionB.locator('.cursor-text').click();
    await optionB.locator('input').fill('$20$');
    await optionB.locator('input').press('Enter');
    await until(async () => (await question(imported.id)).options[1] === '$20$', 'Edited option did not persist');
    checks.push('Imported choices remain editable in the question editor and save to the isolated draft');
    progress('Re-recognition applies options and changes a previously misclassified essay to a choice');
    await sidebar().locator('[data-question-id="qa-existing"]').getByRole('button').first().click();
    await page.getByRole('button', { name: '重新识别', exact: true }).click();
    const comparison = page.getByRole('dialog');
    await comparison.getByText('识别核对', { exact: true }).waitFor();
    await comparison.getByRole('button', { name: '应用识别结果', exact: true }).click();
    await until(async () => {
      const item = await question('qa-existing');
      return item.type === 'single' && item.options.length === 4;
    }, 'Re-recognized choice options remained hidden behind the original essay type');
    const recognized = await question('qa-existing');
    assert.deepEqual(recognized.options, ['$1$', '$2$', '$3$', '$4$']);
    assert.doesNotMatch(recognized.stem, /[A-D]\.\s*\d/);
    assert.equal(recognized.sourceImage, image);
    assert.equal(await page.getByRole('combobox', { name: '题型', exact: true }).innerText(), '单项选择题');
    for (const letter of 'ABCD') await page.getByRole('button', { name: `将 ${letter} 设为正确答案`, exact: true }).waitFor();
    checks.push('Re-recognition applies the same option splitting, preserves the source image, and exposes option controls for a previously non-choice question');
    await page.getByRole('heading', { name: '选项', exact: true }).evaluate(el => el.scrollIntoView({ block: 'center' }));
    await page.mouse.move(5, 5); await pause(700);
    const screenshot = path.join(output, `ocr-options-${suffix}.png`);
    await page.screenshot({ path: screenshot });
    const cloudRequests = network + await app.evaluate(() => globalThis.__ocrOptionsNetwork);
    const stubOcrRequests = await app.evaluate(() => globalThis.__ocrOptionsCalls);
    assert.equal(cloudRequests, 0, 'QA attempted an external request');
    assert.equal(stubOcrRequests, 2, 'QA made unexpected recognition calls');
    assert.deepEqual(errors, []);
    assert.equal(timedOut, false);
    const report = { passed: true, packaged, checks, cloudRequests, stubOcrRequests, pdfExports: 0, errors, screenshot, isolatedDraft: true };
    fs.writeFileSync(path.join(output, `ocr-options-results-${suffix}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    const report = { passed: false, packaged, stage, error: String(error), errors, checks, timedOut };
    fs.writeFileSync(path.join(output, `ocr-options-results-${suffix}.json`), JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report));
    throw error;
  } finally {
    clearTimeout(timer);
    if (app) {
      try { await Promise.race([app.close(), pause(5000).then(() => { try { app.process().kill(); } catch {} })]); } catch {}
    }
    const resolved = fs.realpathSync(userData);
    if (path.dirname(resolved).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase() && path.basename(resolved).startsWith('juanye-ocr-options-qa-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
