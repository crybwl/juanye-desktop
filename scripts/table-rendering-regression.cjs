/* Focused offline table QA. Temporary userData, actual editor/preview/export, no model calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');

const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const skipExport = process.argv.includes('--skip-export');
const sampleOnly = process.argv.includes('--sample-only');
const stressOnly = process.argv.includes('--stress-only');
const suffix = packaged ? 'packaged' : 'source';
const output = path.join(root, 'artifacts/qa-tables');
const pdf = path.join(root, 'output/pdf/sleep-question-table-demo.pdf');
const stressRows = Array.from({ length: 48 }, (_, index) => `| 行${String(index + 1).padStart(3, '0')} | 数据说明：本行内容应完整显示 | $${index + 1}$ |`);
const stressTable = `表格分页检查。\n\n| 行号 | 内容 | 数值 |\n| --- | --- | --- |\n${stressRows.join('\n')}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(75); }
  throw new Error(message);
}

async function main() {
  const sample = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', 'import { SLEEP_QUESTION } from "./tests/fixtures/sleep-question.ts"; console.log(JSON.stringify(SLEEP_QUESTION));'], { cwd: root, encoding: 'utf8' }));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-tables-qa-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const exam = { title: '睡眠与注意力 · 表格排版示例', subtitle: '', duration: 120, notice: [], sections: [
    { id: 'qa-essay', type: 'essay', title: '解答题', note: '', questions: [
      { id: 'qa-sleep', type: 'essay', score: 15, stem: stressOnly ? stressTable : sample, options: [], answer: [], analysis: '' },
    ] },
  ] };
  const layout = { style: 'real', density: 'compact', paper: stressOnly ? 'A5' : 'A4', orientation: 'portrait', margin: 11, fontSize: stressOnly ? 14 : 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, answerMode: 'none' };
  fs.writeFileSync(path.join(userData, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(path.dirname(pdf), { recursive: true });
  let app, page, stage = 'launch', network = 0, timedOut = false;
  const errors = [], checks = [], screenshots = [], themes = [];
  const progress = name => { stage = name; console.log(JSON.stringify({ progress: name })); };
  const timer = setTimeout(() => { timedOut = true; console.error(JSON.stringify({ passed: false, stage, error: 'Table QA exceeded 90 seconds' })); try { app?.process().kill(); } catch {} process.exitCode = 1; }, 90000);
  try {
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? [] : [root], env, timeout: 25000 });
    await app.evaluate(({ BrowserWindow, session, ipcMain, dialog }, target) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (typeof window?.webContents.setBackgroundThrottling === 'function') window.webContents.setBackgroundThrottling(false);
      globalThis.__tablesNetwork = 0; globalThis.__tablesModelCalls = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { globalThis.__tablesNetwork++; callback({ cancel: true }); });
      ipcMain.removeHandler('model:recognize');
      ipcMain.handle('model:recognize', () => { globalThis.__tablesModelCalls++; throw new Error('Table QA must not invoke a model'); });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, pdf);
    page = await app.firstWindow(); page.setDefaultTimeout(7000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.route(/^https?:\/\//, route => { network++; return route.abort('blockedbyclient'); });
    await page.setViewportSize({ width: 1440, height: 960 });
    const editor = page.locator('.workspace-editor-stage');
    const preview = page.locator('.workspace-preview-stage');
    const stem = () => editor.getByPlaceholder('输入题干…', { exact: true });
    const sheets = () => preview.locator('.paper[data-sheet]');
    const draft = () => page.evaluate(() => window.juanye.loadDraft());
    const nativeScreenshot = async (target, rect) => {
      // Electron's hidden-host capture explicitly stays awake without showing a testing window.
      const size = page.viewportSize();
      const x = Math.max(0, Math.floor(rect?.x || 0)), y = Math.max(0, Math.floor(rect?.y || 0));
      const clip = { x, y, width: Math.floor(Math.min(rect ? rect.x + rect.width : size.width, size.width) - x), height: Math.floor(Math.min(rect ? rect.y + rect.height : size.height, size.height) - y) };
      const encoded = await app.evaluate(async ({ BrowserWindow }, area) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.webContents.setBackgroundThrottling(false);
        const image = await window.webContents.capturePage(area, { stayHidden: true, stayAwake: true });
        return image.toPNG().toString('base64');
      }, clip);
      fs.writeFileSync(target, Buffer.from(encoded, 'base64'));
    };
    async function ready() {
      await until(async () => await preview.locator('[data-pagination-ready="true"]').count() === 1, 'Paper pagination did not finish');
      await page.evaluate(() => document.fonts.ready);
      await pause(300);
    }
    await stem().waitFor();
    await until(async () => (await stem().inputValue()) === (stressOnly ? stressTable : sample), 'Isolated table question did not load');
    await ready();
    let tableState = [], pagination;
    if (!stressOnly) {
    progress('User sleep question renders two real tables and cell mathematics');
    const card = editor.locator('section').filter({ has: page.getByRole('heading', { name: '题干', exact: true }) });
    assert.equal(await card.locator('table').count(), 2, 'Editor live preview did not render two tables');
    assert.equal(await sheets().locator('table').count(), 2, 'Paper preview did not render two tables');
    tableState = await sheets().locator('table').evaluateAll(tables => tables.map(table => {
      const rect = table.getBoundingClientRect(), parent = table.parentElement.getBoundingClientRect();
      return { rows: table.rows.length, columns: table.rows[0].cells.length, text: table.innerText, math: table.querySelectorAll('.katex').length, clientWidth: table.clientWidth, scrollWidth: table.scrollWidth, withinParent: rect.left >= parent.left - 1 && rect.right <= parent.right + 1 };
    }));
    assert.deepEqual(tableState.map(table => [table.rows, table.columns]), [[4, 4], [2, 5]]);
    assert.ok(tableState.every(table => table.math > 0 && table.scrollWidth <= table.clientWidth + 2 && table.withinParent), 'Table formulas or width are incorrect');
    assert.ok(tableState.every(table => !table.text.includes('| ---')));
    const combined = tableState.map(table => table.text).join('\n');
    for (const value of ['睡眠充足', '睡眠不足', '75', '25', '125', '200', '3.841', '6.635', '7.879', '10.828']) assert.ok(combined.includes(value), `Table content lost ${value}`);
    assert.ok(await card.locator('strong').filter({ hasText: '16.' }).count() > 0, 'Markdown bold was not rendered');
    assert.equal(await preview.locator('.katex-error').count(), 0, 'Question has KaTeX errors');
    checks.push('Exact user question renders two genuine tables, all cell values, LaTeX and bold in editor and paper preview without width overflow');

    // Save evidence before theme and pagination stress checks.
    progress('Actual offline application PDF export');
    if (!skipExport) {
      const exportedAt = Date.now();
      await page.getByRole('button', { name: '导出 PDF', exact: true }).click({ force: true });
      await until(async () => fs.existsSync(pdf) && fs.statSync(pdf).mtimeMs >= exportedAt && fs.statSync(pdf).size > 10000, 'Application PDF export did not finish', 20000);
    }
    assert.equal(fs.readFileSync(pdf).subarray(0, 4).toString(), '%PDF');
    await until(async () => await page.locator('#print-root').count() === 0, 'PDF export did not clean up its print DOM');
    const paperShot = path.join(output, `sleep-question-paper-${suffix}.png`);
    await nativeScreenshot(paperShot, await sheets().first().boundingBox()); screenshots.push(paperShot);
    await card.locator('table').first().evaluate(el => el.scrollIntoView({ block: 'center' }));
    const appShot = path.join(output, `sleep-question-workspace-${suffix}.png`);
    await page.mouse.move(5, 5); await nativeScreenshot(appShot); screenshots.push(appShot);
    checks.push('Application exported the same table question to a local PDF using bundled rendering and fonts');
    }

    if (!sampleOnly) {
    if (!stressOnly) {
    progress('Original themes retain white paper and readable table cells');
    for (const mode of ['dark', 'light', 'telegram']) {
      await page.getByRole('button', { name: '设置', exact: true }).click({ force: true });
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: '外观', exact: true }).click({ force: true });
      await dialog.locator('label').filter({ has: page.locator(`input[name="juanye-appearance"][value="${mode}"]`) }).click({ force: true });
      await until(async () => await page.evaluate(() => document.documentElement.dataset.theme) === mode, `Theme did not become ${mode}`);
      await dialog.getByRole('button', { name: '关闭', exact: true }).click({ force: true });
      const colors = await sheets().first().evaluate(paper => ({ paper: getComputedStyle(paper).backgroundColor, cells: [...paper.querySelectorAll('th,td')].map(cell => ({ color: getComputedStyle(cell).color, background: getComputedStyle(cell).backgroundColor })) }));
      assert.equal(colors.paper, 'rgb(255, 255, 255)');
      assert.ok(colors.cells.every(cell => cell.color.match(/\d+/g).slice(0, 3).every(channel => Number(channel) < 90)), `${mode}: paper table text is not dark`);
      themes.push({ mode, ...colors });
    }
    checks.push('Dark, light and Telegram retain white paper with dark table text');
    }

    progress('A5 large-font table pagination preserves complete rows');
    if (!stressOnly) {
      const stressExam = structuredClone(exam);
      stressExam.sections[0].questions[0].stem = stressTable;
      const project = { schema: 'juanye/1', exam: stressExam, layout: { ...layout, paper: 'A5', fontSize: 14 } };
      await page.locator('input[type="file"][accept*=".juanye"]').setInputFiles({ name: 'table-stress.juanye', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    }
    await until(async () => { const saved = await draft(); return saved.layout.paper === 'A5' && saved.layout.fontSize === 14; }, 'Stress layout did not save');
    await ready();
    assert.ok(await sheets().count() >= 2, 'Long A5 table did not paginate');
    pagination = await sheets().evaluateAll(papers => {
      const rows = [], partial = [];
      for (const [pageIndex, paper] of papers.entries()) for (const row of paper.querySelectorAll('table tr')) {
        const rect = row.getBoundingClientRect();
        let top = paper.getBoundingClientRect().top, bottom = paper.getBoundingClientRect().bottom;
        for (let parent = row.parentElement; parent && parent !== paper; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (['hidden', 'clip'].includes(style.overflowY)) { const clip = parent.getBoundingClientRect(); top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
        }
        const visible = Math.min(rect.bottom, bottom) - Math.max(rect.top, top);
        if (visible <= 0.75) continue;
        const label = row.cells[0]?.textContent.trim();
        rows.push({ pageIndex, label });
        if (rect.top < top - 1 || rect.bottom > bottom + 1) partial.push({ pageIndex, label, top: rect.top, bottom: rect.bottom, clipTop: top, clipBottom: bottom });
      }
      return { pages: papers.length, rows, partial };
    });
    assert.deepEqual(pagination.partial, [], 'A table row was clipped across a page boundary');
    for (let index = 1; index <= 48; index++) assert.ok(pagination.rows.some(row => row.label === `行${String(index).padStart(3, '0')}`), `Pagination lost row ${index}`);
    const longShot = path.join(output, `table-pagination-${suffix}.png`);
    await nativeScreenshot(longShot, await sheets().first().boundingBox()); screenshots.push(longShot);
    checks.push('A5/14pt long table spans pages without clipping any complete row or losing its content');
    }

    const cloudRequests = network + await app.evaluate(() => globalThis.__tablesNetwork);
    const modelCalls = await app.evaluate(() => globalThis.__tablesModelCalls);
    assert.equal(cloudRequests, 0); assert.equal(modelCalls, 0); assert.deepEqual(errors, []); assert.equal(timedOut, false);
    const report = { passed: true, packaged, sampleOnly, stressOnly, checks, errors, cloudRequests, modelCalls, pdfExports: skipExport || stressOnly ? 0 : 1, reusedExistingPdf: skipExport, pdf: fs.existsSync(pdf) ? pdf : undefined, pdfBytes: fs.existsSync(pdf) ? fs.statSync(pdf).size : undefined, screenshots, tables: tableState, themes, pagination, isolatedDraft: true };
    fs.writeFileSync(path.join(output, `table-results-${suffix}${sampleOnly ? '-sample' : stressOnly ? '-stress' : ''}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, packaged, checks, cloudRequests, modelCalls, pdf, screenshots }));
  } catch (error) {
    const report = { passed: false, packaged, stage, error: String(error), errors, checks, timedOut, pdf: fs.existsSync(pdf) ? pdf : undefined, screenshots };
    fs.writeFileSync(path.join(output, `table-results-${suffix}.json`), JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report)); throw error;
  } finally {
    clearTimeout(timer);
    if (app) { try { await Promise.race([app.close(), pause(5000).then(() => { try { app.process().kill(); } catch {} })]); } catch {} }
    const resolved = fs.realpathSync(userData);
    if (path.dirname(resolved).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase() && path.basename(resolved).startsWith('juanye-tables-qa-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
