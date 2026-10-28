/* Exact before/after paper geometry, offline synthetic data only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const arg = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) || fallback;
const label = arg('label', 'current'), baseline = arg('baseline', '');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.join(root, 'artifacts', 'qa-paper-measurements');
const prose = '已知函数 $f(x)=x^2-2x+1$，讨论参数变化时函数图像的位置，说明理由并核验端点。';
const table = `\n\n| 序号 | 数值 | 概率 |\n| --- | --- | --- |\n${Array.from({ length: 47 }, (_, i) => `| ${i + 1} | $x_${i + 1}^2$ | $\\frac{1}{47}$ |`).join('\n')}\n\n`;
const drawing = '\\begin{tikzpicture}[scale=1]\\draw (0,0)--(1,0)--(1,1)--(0,1)--cycle;\\end{tikzpicture}';
const questions = Array.from({ length: 19 }, (_, index) => ({ id: `measure-${index + 1}`, type: index < 10 ? 'single' : index < 14 ? 'blank' : 'essay', score: index < 14 ? 5 : 15, stem: `${prose}\n\n${index === 4 ? table : prose}${index === 15 ? `\n\n${Array.from({ length: 34 }, (_, i) => `（${i + 1}）${prose}`).join('\n\n')}` : ''}`, options: index < 10 ? ['$-1$', '$0$', '$1$', '$2$'] : [], answer: index < 10 ? ['C'] : ['$1$'], analysis: `${prose}\n\n${prose}`, ...(index === 6 ? { drawing } : {}), pageBreakBefore: index === 10 }));
const exam = { id: 'measurement-exact', title: '测量缓存精确分页回归', subtitle: '合成题库', duration: 120, notice: ['请保留完整题目、表格、图片与续页。'], sections: [{ id: 's1', type: 'single', title: '单项选择题', note: '', questions: questions.slice(0, 10) }, { id: 's2', type: 'blank', title: '填空题', note: '', questions: questions.slice(10, 14) }, { id: 's3', type: 'essay', title: '解答题', note: '', questions: questions.slice(14) }] };
const baseLayout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 10, lineHeight: 1.5, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: true, answerSpace: false, paperMode: 'questions', answerMode: 'full', quickAnswers: true };

async function main() {
  assert.match(label, /^[a-zA-Z0-9_-]+$/); if (baseline) assert.match(baseline, /^[a-zA-Z0-9_-]+$/);
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-measure-exact-'));
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify({ version: 1, exam, layout: baseLayout, history: [] }));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page, report; const errors = [], cases = [];
  const watchdog = setTimeout(() => app?.process().kill(), 120000);
  const ready = async () => {
    await page.waitForFunction(() => document.querySelector('.workspace-preview-stage [data-pagination-ready="true"]') && !document.querySelector('[data-drawing-status="pending"]'), null, { timeout: 45000 });
    await page.evaluate(() => document.fonts.ready); await pause(200);
  };
  const capture = async name => {
    await ready();
    const geometry = await page.locator('.workspace-preview-stage').evaluate(stage => [...stage.querySelectorAll('[data-sheet]')].map(sheet => ({
      width: sheet.style.width, height: sheet.style.height,
      questionIds: [...sheet.querySelectorAll('.p-q[data-qid]')].map(node => node.dataset.qid),
      continuations: [...sheet.querySelectorAll('[data-continuation]')].map(node => ({ height: node.style.height, offset: node.firstElementChild.style.top })),
      columns: [...sheet.querySelectorAll('[data-paper-column]')].map(node => ({ column: node.dataset.paperColumn, text: node.textContent.replace(/\s+/g, ' ') })),
      answers: [...sheet.querySelectorAll('[data-answer-number]')].map(node => ({ number: node.dataset.answerNumber, space: node.dataset.answerSpace, height: node.style.height })),
      text: sheet.textContent.replace(/\s+/g, ' '), tables: sheet.querySelectorAll('table.math-table').length,
      drawing: [...sheet.querySelectorAll('[data-drawing-status]')].map(node => node.dataset.drawingStatus),
    })));
    cases.push({ name, geometry, totalDom: await page.locator('body *').count(), measurementCopies: await page.locator('[data-paper-measurer]').count() });
    console.log(JSON.stringify({ label, name, pages: geometry.length, measurementCopies: cases.at(-1).measurementCopies }));
  };
  try {
    app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root], env });
    await app.evaluate(({ BrowserWindow, session, ipcMain }) => {
      const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(1500, 980); window.setPosition(-16000, -16000); window.webContents.setBackgroundThrottling(false); window.showInactive();
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
      for (const name of ['model:recognize', 'exam:analyze']) { ipcMain.removeHandler(name); ipcMain.handle(name, () => { throw Error('No model during pagination regression'); }); }
      globalThis.__measurementPrint = null;
      ipcMain.removeHandler('document:pdf');
      ipcMain.handle('document:pdf', async () => {
        globalThis.__measurementPrint = await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(`(() => { const root = document.querySelector('#print-root'); return { pending: root.querySelectorAll('[data-drawing-status="pending"]').length, drawings: root.querySelectorAll('[data-drawing-status="ready"]').length, incompleteImages: [...root.querySelectorAll('img')].filter(image => !image.complete || !image.naturalWidth).length, questions: new Set([...root.querySelectorAll('[data-qid]')].map(node => node.dataset.qid)).size, latestInput: root.textContent.includes('追加输入') }; })()`);
        return { canceled: true };
      });
    });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await capture('A4-full-answers-long-table-TikZ');
    await page.locator('.workspace-editor-stage textarea[placeholder="输入题干…"]').fill(`${questions[0].stem}\n\n追加输入 $x=2$。`);
    await page.waitForFunction(() => document.querySelector('.workspace-preview-stage .p-q[data-qid="measure-1"]')?.textContent.includes('追加输入'));
    await capture('A4-edited-question');
    await page.waitForFunction(async () => (await window.juanye.loadDraft()).exam.sections[0].questions[0].stem.includes('追加输入'), null, { timeout: 8000 });
    await page.keyboard.press('Control+2');
    await page.getByRole('button', { name: 'A3 横版印卷', exact: true }).click();
    await page.locator('.workspace-preview-stage [data-paper-columns="2"]').first().waitFor();
    await capture('A3-two-columns-long-table-TikZ');
    assert.equal(cases.at(-1).geometry[0].columns.length, 2, 'Wide fixture was not actually applied');
    await page.keyboard.press('Control+e');
    const printDeadline = Date.now() + 20000;
    while (Date.now() < printDeadline && !await app.evaluate(() => globalThis.__measurementPrint)) await pause(50);
    const print = await app.evaluate(() => globalThis.__measurementPrint);
    assert.ok(print, 'Print export never reached the backend');
    assert.deepEqual({ ...print, drawings: print.drawings > 0 }, { pending: 0, drawings: true, incompleteImages: 0, questions: 19, latestInput: true });
    await page.locator('.workspace-preview-stage').getByRole('tab', { name: '答题卡', exact: true }).click();
    await capture('A3-answer-card-full-17-to-19');
    const full = cases.at(-1).geometry.flatMap((page, index) => page.answers.filter(answer => [17, 18, 19].includes(Number(answer.number))).map(answer => ({ ...answer, page: index, count: page.answers.length })));
    assert.equal(new Set(full.map(answer => answer.page)).size, 3); assert.ok(full.every(answer => answer.count === 1 && answer.space === 'full'));
    assert.deepEqual(errors, []);
    if (baseline) {
      const previous = JSON.parse(fs.readFileSync(path.join(output, `${baseline}.json`)));
      assert.deepEqual(cases.map(({ name, geometry }) => ({ name, geometry })), previous.cases.map(({ name, geometry }) => ({ name, geometry })), 'Page content/boundaries/continuations differ from the pre-optimization build');
    }
    report = { passed: true, label, baseline, build: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'dist/index.html'))).digest('hex'), cases, print, errors };
    console.log(JSON.stringify({ passed: true, label, baseline, cases: cases.length }));
  } catch (error) { report = { passed: false, label, baseline, error: error.stack || String(error), cases, errors }; console.error(report.error); process.exitCode = 1; }
  finally {
    clearTimeout(watchdog); if (app) await app.close().catch(() => app.process().kill());
    fs.writeFileSync(path.join(output, `${label}.json`), JSON.stringify(report, null, 2));
    const resolved = fs.realpathSync(profile), temp = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved).toLowerCase() === temp.toLowerCase() && path.basename(resolved).startsWith('juanye-measure-exact-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
