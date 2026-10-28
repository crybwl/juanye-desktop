/* Real Electron -> local mock model. Isolated synthetic papers and profiles.
 * Metadata must become editable exam data, not merely decorate a report table.
 * Research: TanStack Query guarded mutation updates / RHF keepDirtyValues.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..'), packaged = process.argv.includes('--packaged');
const output = path.join(root, 'artifacts', 'qa-ai-metadata', packaged ? 'packaged' : 'source');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, timeout = 12000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await check()) return; await pause(45); } throw Error(message); }

async function main() {
  const question = number => ({ id: `metadata-q${number}`, type: 'single', score: 5, stem: `隔离第 ${number} 题：函数 $f(x)=x^2$，求 $f(2)$。`, options: ['$1$', '$2$', '$3$', '$4$'], answer: ['D'], analysis: '代入得 $4$。', ...(number === 2 ? { knowledge: ['教师标注知识点'], source: '合成来源，不可由AI改写' } : {}), ...(number === 3 ? { difficulty: 'hard' } : {}), ...(number === 4 ? { knowledge: ['教师保留标签'], difficulty: 'easy' } : {}) });
  const exam = { id: 'metadata-paper', title: 'AI属性同步隔离样卷', subtitle: '', duration: 90, notice: [], sections: [{ id: 'metadata-section', title: '单项选择题', type: 'single', note: '', questions: [1, 2, 3, 4].map(question) }] };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'none' };
  const originalQuestions = exam.sections[0].questions;
  const expected = originalQuestions.map(q => ({ ...q, ...(!q.knowledge?.length ? { knowledge: ['AI函数知识点'] } : {}), ...(!q.difficulty ? { difficulty: 'medium' } : {}) }));
  const buildFile = path.join(root, packaged ? 'release/win-unpacked/resources/app.asar' : 'dist/index.html');
  const buildHash = crypto.createHash('sha256').update(fs.readFileSync(buildFile)).digest('hex');
  const pending = [], calls = [], errors = [], checks = [], profiles = [], screenshots = [];
  let app, page, stage = 'launch', report, hold = false, outsideRequests = 0, savedReports;
  fs.mkdirSync(output, { recursive: true });
  const progress = value => { stage = value; console.log(JSON.stringify({ progress: value, packaged })); };
  const server = http.createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const payload = JSON.parse(raw), prompt = typeof payload.messages[0].content === 'string' ? payload.messages[0].content : payload.messages[0].content[0].text;
      const data = JSON.parse(prompt.match(/\n<data>([\s\S]*)<\/data>$/)[1]);
      assert.equal(data.questions.length, 4); assert.equal(data.globalStructure.questionCount, 4);
      calls.push({ ids: data.questions.map(q => q.id), maxTokens: payload.max_tokens });
      const result = { summary: '隔离模型评估完成：用于核对属性同步。', recommendations: [], findings: [], questionReviews: data.questions.map(q => ({ questionId: q.id, knowledge: ['AI函数知识点'], estimatedDifficulty: 'medium', rationale: '合成模型仅验证字段同步，不代表真实教研质量。', answerCheck: 'not_checked', visualCheck: 'not_checked' })) };
      const finish = () => { if (!res.destroyed && !res.writableEnded) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] })); } };
      if (hold) pending.push(finish); else finish();
    } catch (error) { if (!res.destroyed) { res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); } }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  const release = () => pending.splice(0).forEach(finish => finish());
  const watchdog = setTimeout(() => { app?.process().kill(); console.error(`AI metadata timeout: ${stage}`); process.exit(1); }, 150000);
  const nav = name => page.getByRole('navigation', { name: '工作区', exact: true }).getByRole('button', { name, exact: true });
  const analysis = () => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '试卷分析与双向细目表', exact: true }) });
  const draft = () => page.evaluate(() => window.juanye.loadDraft());
  const editor = () => page.locator('.workspace-editor-stage [data-editor-question]:not([inert])').getByPlaceholder('输入题干…', { exact: true });
  const questions = async () => (await draft()).exam.sections[0].questions;
  async function closeApp() { if (app) { await app.close().catch(() => app.process().kill()); app = null; page = null; } }
  async function launch({ history = false, changed = false } = {}) {
    await closeApp();
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-ai-metadata-')); profiles.push(profile);
    const paper = structuredClone(exam); if (changed) paper.sections[0].questions[0].stem += ' 旧报告后已修改原题。';
    fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify({ version: 1, exam: paper, layout, history: [] }));
    if (history) fs.writeFileSync(path.join(profile, 'exam-ai-reports-v1.json'), savedReports);
    const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
    const flags = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? flags : [root, ...flags], env });
    await app.evaluate(({ BrowserWindow, ipcMain }, endpoint) => {
      const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setPosition(-16000, -16000); win.showInactive();
      const original = globalThis.fetch; globalThis.__metadataBlocked = 0; globalThis.__metadataCsv = null;
      globalThis.fetch = (url, options) => { if (!String(url).startsWith(`${endpoint}/`)) { globalThis.__metadataBlocked++; throw Error('Metadata QA blocks external network'); } return original(url, options); };
      ipcMain.removeHandler('document:text'); ipcMain.handle('document:text', (_event, options) => { globalThis.__metadataCsv = options.content; return { canceled: true }; });
      for (const channel of ['model:recognize', 'model:generate']) { ipcMain.removeHandler(channel); ipcMain.handle(channel, () => { globalThis.__metadataBlocked++; throw Error('Metadata QA forbids OCR/generation'); }); }
    }, endpoint);
    page = await app.firstWindow(); page.setDefaultTimeout(10000); await page.setViewportSize({ width: 1440, height: 900 });
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => { outsideRequests++; return route.abort('blockedbyclient'); });
    await editor().waitFor();
    await page.waitForFunction(() => document.querySelector('.workspace-editor-stage [data-editor-question="metadata-q1"] textarea[placeholder="输入题干…"]')?.value.startsWith('隔离第 1 题：'));
    await page.evaluate(endpoint => window.juanye.saveModel({ baseUrl: endpoint, model: 'local-metadata-model', key: 'sk-local-metadata-qa-never-real' }), endpoint);
    return profile;
  }
  async function openAnalysis(ai = false) { await nav('组卷').click(); await nav('试卷分析').click(); await analysis().getByRole('tab', { name: ai ? 'AI 评估' : '本地统计', exact: true }).click(); }
  async function start(background, purpose) {
    const before = calls.length;
    await analysis().getByLabel('使用目的', { exact: true }).fill(purpose);
    const toggle = analysis().getByRole('checkbox', { name: '后台分析（实验性）', exact: true });
    if ((await toggle.getAttribute('aria-checked') === 'true') !== background) await toggle.click();
    await analysis().getByRole('button', { name: '预览并确认发送', exact: true }).click(); assert.equal(calls.length, before);
    await analysis().getByRole('button', { name: '确认并开始分析', exact: true }).click();
    await until(() => calls.length === before + 1, 'Explicitly confirmed analysis did not issue exactly one request');
  }
  const assertFilled = async () => { await until(async () => JSON.stringify(await questions()) === JSON.stringify(expected), 'Missing metadata was not automatically written, or manual fields/content were overwritten'); assert.deepEqual(await questions(), expected); };
  async function screenshot(name) { await page.evaluate(() => document.fonts.ready); await pause(350); const file = path.join(output, name); await page.screenshot({ path: file }); screenshots.push(file); }
  async function assertNoExternal() { assert.equal(await app.evaluate(() => globalThis.__metadataBlocked), 0); assert.equal(outsideRequests, 0); assert.deepEqual(errors, []); }
  try {
    progress('foreground completion updates editable data and keeps manual fields per property');
    const firstProfile = await launch(); await openAnalysis(true); await start(false, '前台属性同步'); await assertFilled();
    assert.equal(await analysis().getByText('历史报告：已过期', { exact: true }).count(), 0, 'An analysis must not become stale solely because its missing metadata was auto-filled');
    savedReports = fs.readFileSync(path.join(firstProfile, 'exam-ai-reports-v1.json'));
    const immutableReport = JSON.parse(savedReports).reports[0];
    assert.deepEqual(immutableReport.snapshot.sections[0].questions.map(q => q.knowledge), [[], ['教师标注知识点'], [], ['教师保留标签']], 'Autofill mutated the report snapshot');
    checks.push('Foreground result fills missing knowledge/difficulty per field, preserves manual metadata/source/content, and leaves its immutable report current');

    progress('detail, knowledge×difficulty matrix and CSV read the same updated exam');
    await analysis().getByRole('tab', { name: '逐题细目', exact: true }).click();
    await analysis().getByRole('heading', { name: '逐题细目', exact: true }).waitFor();
    const detail = analysis().getByRole('table').filter({ has: page.getByRole('columnheader', { name: '来源', exact: true }) });
    const rows = await detail.locator('tbody tr').evaluateAll(items => items.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent)));
    assert.deepEqual(rows.map(row => [row[3], row[4], row[5]]), [['AI函数知识点', '中等', '未设置'], ['教师标注知识点', '中等', '合成来源，不可由AI改写'], ['AI函数知识点', '较难', '未设置'], ['教师保留标签', '基础', '未设置']]);
    await screenshot('metadata-detail.png');
    await analysis().getByRole('button', { name: '导出 CSV', exact: true }).click();
    await until(async () => (await app.evaluate(() => globalThis.__metadataCsv))?.includes('AI函数知识点'), 'CSV still uses unset metadata');
    const csv = await app.evaluate(() => globalThis.__metadataCsv); assert.ok(csv.includes('"1","单项选择题","5","AI函数知识点","中等","未设置"'));
    await analysis().getByRole('tab', { name: '双向细目表', exact: true }).click();
    await analysis().getByRole('button', { name: '知识点 × 难度', exact: true }).click();
    const matrix = analysis().locator('.exam-table-scroll table');
    await matrix.getByRole('columnheader', { name: '较难', exact: true }).waitFor();
    assert.ok((await matrix.innerText()).includes('AI函数知识点')); assert.ok((await matrix.innerText()).includes('教师保留标签'));
    await screenshot('metadata-matrix.png');
    checks.push('Detail table, both-way knowledge/difficulty matrix and actual CSV IPC expose the persisted question attributes, not report-only display overlays');

    progress('undo is respected on reopen and reload, with no repeat analysis');
    await analysis().getByRole('button', { name: '关闭试卷分析', exact: true }).click();
    await page.locator('.workspace-editor-stage').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Control+z');
    await until(async () => JSON.stringify(await questions()) === JSON.stringify(originalQuestions), 'One Ctrl+Z did not restore the original unset/manual metadata');
    await openAnalysis(); await pause(400); assert.deepEqual(await questions(), originalQuestions);
    await analysis().getByRole('button', { name: '关闭试卷分析', exact: true }).click();
    await page.reload(); await editor().waitFor(); await openAnalysis(); await pause(400);
    assert.deepEqual(await questions(), originalQuestions); assert.equal(calls.length, 1, 'Undo/reopen/reload must not silently request another report');
    checks.push('Autofill is one undoable edit; the same report cannot refill after Ctrl+Z, panel reopening or renderer reload'); await assertNoExternal();

    progress('matching historical report fills an old draft without a model request');
    await launch({ history: true }); await openAnalysis(); await assertFilled(); assert.equal(calls.length, 1);
    await analysis().getByRole('tab', { name: 'AI 评估', exact: true }).click();
    await analysis().getByText('隔离模型评估完成：用于核对属性同步。', { exact: true }).waitFor();
    assert.equal(await analysis().getByText('历史报告：已过期', { exact: true }).count(), 0, 'Loading a matching historical report must restore its own settings before checking staleness');
    checks.push('A validated matching stored report can backfill an older draft directly from local data without another model request'); await assertNoExternal();

    progress('background result applies while the dialog is closed and bank is active');
    hold = true; await launch(); await openAnalysis(true); await start(true, '后台属性同步');
    await until(async () => await page.getByRole('dialog').count() === 0, 'Background start did not close the dialog');
    await nav('本地题库').click(); release(); await assertFilled(); assert.equal(calls.length, 2);
    assert.equal(await page.getByRole('dialog').count(), 0, 'Completing metadata must not force-open the report');
    checks.push('Background completion writes only the missing fields while the dialog is absent and the bank workspace is active'); await assertNoExternal();

    progress('edited in-flight content and stale historical snapshots never write metadata');
    await launch(); await openAnalysis(true); await start(true, '原题变化保护');
    const changedStem = `${originalQuestions[0].stem} 请求期间修改原题。`;
    await editor().fill(changedStem); await until(async () => (await questions())[0].stem === changedStem, 'Edited stem did not persist');
    release(); await until(async () => (await page.evaluate(() => window.juanye.loadExamReports('metadata-paper'))).length === 1, 'Stale result was not retained for review'); await pause(350);
    assert.deepEqual(await questions(), [{ ...originalQuestions[0], stem: changedStem }, ...originalQuestions.slice(1)]); assert.equal(calls.length, 3); await assertNoExternal();
    await launch({ history: true, changed: true }); await openAnalysis(); await pause(400);
    const staleQuestions = await questions(); assert.ok(staleQuestions[0].stem.endsWith('旧报告后已修改原题。'));
    assert.deepEqual(staleQuestions.slice(1), originalQuestions.slice(1)); assert.equal(staleQuestions[0].knowledge, undefined); assert.equal(staleQuestions[0].difficulty, undefined); assert.equal(calls.length, 3); await assertNoExternal();
    checks.push('Content changes during a request or after a stored report invalidate all automatic metadata writes; no automatic retry/network or source fabrication');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(buildFile)).digest('hex'), buildHash, 'Do not rebuild during this multi-profile regression');
    report = { passed: true, packaged, checks, localMockModelCalls: calls.length, paidModelCalls: 0, externalRequests: outsideRequests, errors, screenshots, build: { file: buildFile, sha256: buildHash } };
    console.log(JSON.stringify(report));
  } catch (error) {
    await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    report = { passed: false, packaged, stage, checks, localMockModelCalls: calls.length, error: error.stack || String(error), errors }; console.error(JSON.stringify(report, null, 2)); process.exitCode = 1;
  } finally {
    clearTimeout(watchdog); release(); await closeApp(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    for (const profile of profiles) { const resolved = fs.realpathSync(profile), temporary = fs.realpathSync(os.tmpdir()); assert.equal(path.dirname(resolved).toLowerCase(), temporary.toLowerCase()); assert.ok(path.basename(resolved).startsWith('juanye-ai-metadata-')); fs.rmSync(resolved, { recursive: true, force: true }); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
