/* Focused offline quick-answer layout check. No PDF, models, network, or real user profile. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(80); }
  throw new Error(message);
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-quick-qa-'));
  const longAnswer = 'C。方法：利用三角恒等变换及辅助角公式，逐步化简可得该函数值域。'.repeat(40);
  const longFormula = `$${Array.from({ length: 45 }, (_, i) => `x_{${i + 1}}`).join('+')}=1$`;
  const table = '| 类别 | 注意力集中 | 注意力不集中 | 合计 |\n| --- | --- | --- | --- |\n| 充足 | $75$ | $25$ | $100$ |\n| 不足 | $50$ | $50$ | $100$ |';
  const answers = [['A'], [longAnswer], [table], ['A', 'C'], [String.raw`$\frac{\sqrt{3}}{2}$`], [longFormula], ['$|x|$'], []];
  const exam = { title: '速对框布局压力检查', subtitle: '', duration: 120, notice: [], sections: [{ id: 'qa', type: 'single', title: '测试题', note: '', questions: answers.map((answer, i) => ({ id: `q${i + 1}`, type: i < 4 ? 'single' : 'blank', score: 5, stem: `第${i + 1}道本地样例题。`, options: i < 4 ? ['甲', '乙', '丙', '丁'] : [], answer, analysis: `第${i + 1}题独立解析，不能进入速对格。` })) }] };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'full', quickAnswers: true };
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root], env, timeout: 20000 });
    await app.evaluate(({ BrowserWindow, session, ipcMain }) => {
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
      globalThis.__quickNetwork = 0; globalThis.__quickModel = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { globalThis.__quickNetwork++; callback({ cancel: true }); });
      ipcMain.removeHandler('model:recognize');
      ipcMain.handle('model:recognize', () => { globalThis.__quickModel++; throw new Error('Quick-answer QA must not invoke models'); });
    });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 960 });
    const preview = page.locator('.workspace-preview-stage');
    await until(async () => await preview.locator('[data-pagination-ready="true"]').count() === 1 && await preview.locator('.p-quick-cell').count() === 8, 'Isolated quick-answer fixture did not paginate');
    await page.evaluate(() => document.fonts.ready); await sleep(250);
    const cells = await preview.locator('.p-quick-cell').evaluateAll(elements => elements.map(cell => {
      const value = cell.querySelector('.p-quick-value');
      const bounds = cell.getBoundingClientRect(), row = cell.parentElement.getBoundingClientRect(), content = value.getBoundingClientRect();
      return { id: cell.dataset.quickAnswerFor, text: value.innerText.trim(), width: value.clientWidth, scrollWidth: value.scrollWidth, bounded: bounds.left >= row.left - 1 && bounds.right <= row.right + 1 && content.left >= bounds.left - 1 && content.right <= bounds.right + 1 };
    }));
    assert.ok(cells.every(cell => cell.bounded && cell.scrollWidth <= cell.width + 1), 'Quick-answer content overflowed into a neighboring cell');
    assert.equal(cells.find(cell => cell.id === 'q2').text, '见下方');
    assert.equal(cells.find(cell => cell.id === 'q3').text, '见下方');
    assert.equal(cells.find(cell => cell.id === 'q6').text, '见下方');
    assert.ok(!cells.some(cell => cell.text.includes('独立解析')));
    const text = await preview.innerText();
    assert.ok(text.includes(longAnswer), 'Full answer disappeared below the quick-check grid');
    assert.ok(text.includes('注意力不集中') && await preview.locator('table.math-table').count() > 0, 'Complete table answer disappeared');
    assert.ok(text.includes('第6题独立解析'), 'Separate analysis disappeared');
    const counts = await app.evaluate(() => ({ cloudRequests: globalThis.__quickNetwork, modelCalls: globalThis.__quickModel }));
    assert.equal(counts.cloudRequests, 0); assert.equal(counts.modelCalls, 0); assert.deepEqual(errors, []);
    const output = path.join(root, 'artifacts/qa-quick-answers'); fs.mkdirSync(output, { recursive: true });
    const report = { passed: true, cells, ...counts, errors, isolatedProfile: true, pdfExports: 0 };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    if (app) { try { await Promise.race([app.close(), sleep(5000).then(() => app.process().kill())]); } catch {} }
    const resolved = fs.realpathSync(profile);
    if (path.dirname(resolved).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase() && path.basename(resolved).startsWith('juanye-quick-qa-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
