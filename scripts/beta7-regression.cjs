/* Experimental background-analysis integration. Real Electron/preload/service,
 * isolated draft, manually released localhost model, no real keys or paid calls.
 * Research: TanStack Query mutationObserver separates observer and task lifetime;
 * shadcn/ui sidebar preserves an icon rail rather than a wide empty container.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const out = path.join(root, 'artifacts', 'qa-beta7', packaged ? 'packaged' : 'source');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 10000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await check()) return; await pause(45); } throw Error(label); }

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-beta7-'));
  fs.mkdirSync(out, { recursive: true });
  const key = 'sk-local-beta7-never-a-real-key';
  const question = { id: 'beta7-q1', type: 'single', score: 5, stem: '隔离样题：已知 $f(x)=x^2$，求 $f(2)$。', options: ['$1$', '$2$', '$3$', '$4$'], answer: ['D'], analysis: '代入得 $4$。', knowledge: ['原知识点'], difficulty: 'easy' };
  const exam = { id: 'beta7-exam', title: '后台任务隔离样卷', subtitle: '', duration: 90, notice: [], sections: [{ id: 'beta7-s1', type: 'single', title: '单项选择题', note: '', questions: [question] }] };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'none' };
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  const pending = [], calls = [], errors = [], checks = [], screenshots = [], appearances = [];
  let mode = 'hold', app, page, stage = 'launch', externalRequests = 0, report;
  const server = http.createServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      assert.ok(input.max_tokens >= 256 && input.max_tokens <= 8192);
      const text = typeof input.messages[0].content === 'string' ? input.messages[0].content : input.messages[0].content[0].text;
      const data = JSON.parse(text.match(/\n<data>([\s\S]*)<\/data>$/)[1]);
      assert.equal(data.globalStructure.questionCount, 1);
      calls.push({ questions: data.questions.map(item => item.id), mode });
      if (mode === 'error') { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: `隔离测试服务错误 ${key}` } })); return; }
      const result = { summary: '后台分析测试报告：需人工核对。', recommendations: ['核对建议后再应用。'], findings: [{ kind: 'coverage', severity: 'info', questionIds: [data.questions[0].id], message: '隔离知识点建议', evidence: '本机模型替身。', suggestion: '请人工核对。' }], questionReviews: data.questions.map(item => ({ questionId: item.id, knowledge: ['后台建议知识点'], estimatedDifficulty: 'medium', rationale: '仅用于验证任务生命周期。', answerCheck: 'not_checked', visualCheck: 'not_checked' })) };
      pending.push({ res, result });
    } catch (error) { if (!res.destroyed) { res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); } }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  const release = () => { for (const item of pending.splice(0)) if (!item.res.destroyed && !item.res.writableEnded) { item.res.writeHead(200, { 'Content-Type': 'application/json' }); item.res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(item.result) } }] })); } };
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const progress = value => { stage = value; console.log(JSON.stringify({ progress: value, packaged })); };
  const watchdog = setTimeout(() => { app?.process().kill(); console.error(`Beta7 QA timeout: ${stage}`); process.exit(1); }, 140000);
  try {
    const flags = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? flags : [root, ...flags], env });
    await app.evaluate(({ BrowserWindow, dialog, ipcMain }, endpoint) => {
      const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setPosition(-16000, -16000); win.showInactive();
      dialog.showSaveDialog = async () => ({ canceled: true }); globalThis.__beta7BlockedFetch = 0; globalThis.__beta7OcrCalls = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (url, options) => { if (!String(url).startsWith(`${endpoint}/`)) { globalThis.__beta7BlockedFetch++; throw Error('External network disabled in beta7 QA'); } return originalFetch(url, options); };
      ipcMain.removeHandler('model:recognize'); ipcMain.handle('model:recognize', () => { globalThis.__beta7OcrCalls++; throw Error('OCR disabled in beta7 QA'); });
    }, endpoint);
    page = await app.firstWindow(); page.setDefaultTimeout(10000); await page.setViewportSize({ width: 1440, height: 900 });
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await page.route(/^https?:\/\//, route => { externalRequests++; return route.abort('blockedbyclient'); });
    await page.getByPlaceholder('输入题干…', { exact: true }).waitFor();
    await page.evaluate(async ({ endpoint, key, exam }) => { await window.juanye.saveModel({ baseUrl: endpoint, model: 'local-beta7-model', key }); await window.juanye.bankSave({ questions: exam.sections.flatMap(section => section.questions), origin: { examId: exam.id, examTitle: exam.title } }); }, { endpoint, key, exam });
    const nav = name => page.getByRole('navigation', { name: '工作区', exact: true }).getByRole('button', { name, exact: true });
    const analyze = () => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '试卷分析与双向细目表', exact: true }) });
    const indicator = () => page.getByTestId('exam-ai-background-task');
    const loadReports = () => page.evaluate(() => window.juanye.loadExamReports('beta7-exam'));
    const loadDraft = () => page.evaluate(() => window.juanye.loadDraft());
    const openAnalysis = async () => { await nav('组卷').click(); await nav('试卷分析').click(); await analyze().getByRole('tab', { name: 'AI 评估', exact: true }).click(); };
    const setBackground = async value => { const toggle = analyze().getByRole('checkbox', { name: '后台分析（实验性）', exact: true }); if ((await toggle.getAttribute('aria-checked') === 'true') !== value) await toggle.click(); };
    const start = async (purpose, background) => {
      await setBackground(background); await analyze().getByLabel('使用目的', { exact: true }).fill(purpose);
      const before = calls.length;
      await analyze().getByRole('button', { name: '预览并确认发送', exact: true }).click();
      assert.equal(calls.length, before, 'Analysis sent before budget confirmation');
      await analyze().getByRole('button', { name: '确认并开始分析', exact: true }).click();
      await until(() => calls.length === before + 1, 'Confirmed analysis did not start exactly one request');
    };
    const shot = async name => { await page.mouse.move(740, 78); await pause(180); const target = path.join(out, `${name}.png`); await page.screenshot({ path: target }); screenshots.push(target); };

    progress('collapsed rail releases the former wide hit area and hover drawer does not relayout catalog');
    await nav('本地题库').click(); await page.getByTestId('bank-entry').first().waitFor();
    await until(() => page.locator('[data-workspace-view="bank"]').evaluate(node => { const style = getComputedStyle(node); return +style.opacity > .999 && (style.transform === 'none' || Math.abs(new DOMMatrixReadOnly(style.transform).m41) < .05); }), 'Bank workspace slide did not settle');
    const bank = page.getByTestId('bank-workspace'), sidebar = bank.locator('.bank-library-sidebar');
    await page.mouse.move(1438, 2); await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await until(async () => await sidebar.getAttribute('data-expanded') === 'false', 'Sidebar did not collapse to its icon rail');
    const railGeometry = () => bank.evaluate(node => { const root = node.getBoundingClientRect(), rail = node.querySelector('.bank-library-sidebar').getBoundingClientRect(), catalog = node.querySelector('.bank-catalog').getBoundingClientRect(); return { rootLeft: root.left, railWidth: rail.width, catalogLeft: catalog.left, catalogWidth: catalog.width }; });
    const collapsed = await railGeometry(); assert.ok(Math.abs(collapsed.railWidth - 60) <= 1 && Math.abs(collapsed.catalogLeft - collapsed.rootLeft - 60) <= 1, JSON.stringify(collapsed));
    await page.mouse.move(collapsed.rootLeft + 180, 450); await pause(250);
    assert.equal(await sidebar.getAttribute('data-expanded'), 'false', 'Invisible wide sidebar captured catalog hover');
    const hit = await page.evaluate(x => { const node = document.elementFromPoint(x, 450); return { catalog: !!node?.closest('.bank-catalog'), sidebar: !!node?.closest('.bank-library-sidebar'), element: node?.tagName }; }, collapsed.rootLeft + 180);
    assert.deepEqual({ catalog: hit.catalog, sidebar: hit.sidebar }, { catalog: true, sidebar: false });
    await sidebar.hover(); await until(async () => await sidebar.getAttribute('data-expanded') === 'true', 'Rail hover did not expand navigation');
    const expanded = await railGeometry(); assert.ok(Math.abs(expanded.catalogLeft - expanded.rootLeft - collapsed.catalogLeft + collapsed.rootLeft) <= .5 && Math.abs(expanded.catalogWidth - collapsed.catalogWidth) <= .5 && Math.abs(expanded.railWidth - collapsed.railWidth) <= .5, `Hover drawer relaid out the catalog: ${JSON.stringify({ collapsed, expanded })}`);
    const drawer = await bank.locator('.bank-sidebar-panel').boundingBox(); assert.ok(drawer && drawer.width >= 210 && drawer.width <= 235, JSON.stringify(drawer));
    const expandedPath = path.join(out, 'bank-hover-drawer.png'); await page.screenshot({ path: expandedPath }); screenshots.push(expandedPath);
    await page.mouse.move(1438, 2); await until(async () => await sidebar.getAttribute('data-expanded') === 'false', 'Rail stayed expanded without hover/focus');
    checks.push('True 60px rail releases catalog hit testing; 220px hover overlay preserves catalog geometry and collapses on leave');

    progress('confirmed background request keeps only a lower-left spinner; foreground editing and navigation continue');
    await openAnalysis(); await start('后台生命周期成功样例', true);
    await until(async () => await page.getByRole('dialog').count() === 0, 'Background request did not release the modal');
    await indicator().waitFor();
    assert.equal(await indicator().getAttribute('aria-label'), '查看后台试卷分析');
    const spinner = await indicator().boundingBox(); assert.ok(spinner && spinner.x <= 30 && spinner.y >= 800 && spinner.width <= 56 && spinner.height <= 56, `Expected compact lower-left task: ${JSON.stringify(spinner)}`);
    assert.equal(await indicator().innerText(), '', 'Pending background task must not expose a large textual progress panel');
    for (const appearance of [{ theme: 'dark' }, { theme: 'light' }, { theme: 'telegram', scheme: 'dark' }, { theme: 'telegram', scheme: 'light' }]) {
      await page.evaluate(item => { for (const [key, value] of Object.entries({ 'juanye.appearance.v1': item.theme, 'juanye.telegram-scheme.v1': item.scheme || 'dark' })) { localStorage.setItem(key, value); window.dispatchEvent(new StorageEvent('storage', { key, newValue: value })); } }, appearance);
      await pause(100); assert.equal(await indicator().isVisible(), true); appearances.push(appearance);
      await shot(`background-pending-${appearance.theme}${appearance.scheme ? `-${appearance.scheme}` : ''}`);
    }
    const editedStem = `${question.stem}\n后台请求期间仍可编辑。`;
    await page.getByPlaceholder('输入题干…', { exact: true }).fill(editedStem);
    await nav('本地题库').click(); await page.getByTestId('bank-entry').first().waitFor(); await indicator().waitFor();
    assert.equal(calls.length, 1);
    await shot('background-pending-bank');
    await indicator().click(); await analyze().getByRole('button', { name: '取消整卷分析', exact: true }).waitFor();
    assert.equal(await analyze().getByRole('tab', { name: 'AI 评估', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(calls.length, 1, 'Reopening pending task requested analysis again');
    await analyze().getByRole('button', { name: '关闭试卷分析', exact: true }).click();
    await until(async () => await page.getByRole('dialog').count() === 0, 'Background modal did not close');
    assert.equal(await indicator().isVisible(), true);
    release(); await until(async () => (await loadReports()).length === 1, 'Completed background report was not persisted');
    await until(async () => await indicator().getAttribute('aria-label') === '查看试卷分析报告', 'Completion affordance did not change');
    await indicator().click(); await analyze().getByText('后台分析测试报告：需人工核对。', { exact: true }).waitFor();
    await analyze().getByText('历史报告：已过期', { exact: true }).waitFor();
    assert.equal(await analyze().getByRole('button', { name: '应用选中建议', exact: true }).isDisabled(), true);
    await until(async () => (await loadDraft()).exam.sections[0].questions[0].stem === editedStem, 'Editing during request was not durably saved');
    const persisted = (await loadDraft()).exam.sections[0].questions[0];
    assert.deepEqual(persisted.knowledge, question.knowledge); assert.deepEqual(persisted.answer, question.answer); assert.equal(persisted.analysis, question.analysis);
    assert.equal(calls.length, 1); await shot('background-complete-stale-report');
    checks.push('Explicit send confirmation; one compact lower-left spinner across four appearances; editing/workspace changes/reopening do not cancel or duplicate request; completed stale report is persisted and cannot auto-apply');

    progress('explicit background cancellation does not persist late results or retry');
    await start('后台生命周期取消样例', true); await indicator().click();
    await analyze().getByRole('button', { name: '取消整卷分析', exact: true }).click();
    await analyze().getByText('整卷分析已取消。', { exact: true }).waitFor();
    release(); await pause(300); assert.equal((await loadReports()).length, 1); assert.equal(calls.length, 2);
    await analyze().getByRole('button', { name: '关闭试卷分析', exact: true }).click();
    checks.push('Explicit background cancellation drops any late result and makes no retry');

    progress('normal foreground close still cancels rather than silently retaining a paid task');
    await openAnalysis(); await start('前台关闭取消样例', false);
    await analyze().getByRole('button', { name: '取消整卷分析', exact: true }).waitFor();
    await analyze().getByRole('button', { name: '关闭试卷分析', exact: true }).click();
    await until(async () => await page.getByRole('dialog').count() === 0, 'Foreground modal did not close');
    release(); await pause(300); assert.equal((await loadReports()).length, 1); assert.equal(calls.length, 3);
    assert.equal(await page.getByRole('button', { name: '查看后台试卷分析', exact: true }).count(), 0);
    checks.push('Normal foreground close cancels; no invisible task or saved late result');

    progress('background errors are reopenable, redact credentials, and do not retry');
    mode = 'error'; await openAnalysis(); await start('后台失败样例', true);
    await until(async () => await indicator().getAttribute('aria-label') === '查看试卷分析失败原因', 'Background error affordance not shown');
    await indicator().click(); await analyze().getByRole('alert').filter({ hasText: '隔离测试服务错误' }).waitFor();
    assert.equal((await analyze().innerText()).includes(key), false, 'Saved credential leaked into displayed service failure');
    assert.equal(calls.length, 4); assert.equal((await loadReports()).length, 1); await shot('background-error');
    checks.push('Background service failure is reopenable, credential-redacted, and never automatically retried');

    assert.deepEqual(errors, []); assert.equal(externalRequests, 0);
    const requests = await app.evaluate(() => ({ blocked: globalThis.__beta7BlockedFetch, ocr: globalThis.__beta7OcrCalls })); assert.deepEqual(requests, { blocked: 0, ocr: 0 });
    const buildFile = path.join(root, packaged ? 'release/win-unpacked/resources/app.asar' : 'dist/index.html');
    report = { passed: true, packaged, checks, appearances, screenshots, localMockModelCalls: calls.length, paidModelCalls: 0, externalRequests, errors, build: { file: buildFile, sha256: crypto.createHash('sha256').update(fs.readFileSync(buildFile)).digest('hex') } };
    console.log(JSON.stringify(report));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    report = { passed: false, packaged, stage, error: error.stack || String(error), checks, localMockModelCalls: calls.length, errors }; console.error(JSON.stringify(report, null, 2)); process.exitCode = 1;
  } finally {
    clearTimeout(watchdog); release(); if (app) await app.close().catch(() => app.process().kill());
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    const resolved = fs.realpathSync(profile), temporaryRoot = fs.realpathSync(os.tmpdir()); assert.equal(path.dirname(resolved).toLowerCase(), temporaryRoot.toLowerCase()); assert.ok(path.basename(resolved).startsWith('juanye-beta7-')); fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
