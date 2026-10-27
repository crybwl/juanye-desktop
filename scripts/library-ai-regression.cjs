/* Isolated Electron integration, local mock model only: no real keys or paid requests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const suffix = packaged ? 'packaged' : 'source';
const out = path.join(root, 'artifacts/qa-library-ai');
const themes = ['ocean', 'spring', 'frost', 'gem', 'classroom', 'blossom', 'dusk', 'ember', 'neon'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(callback, message, timeout = 10000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await callback()) return; await pause(60); } throw Error(message); }

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-library-ai-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const q1 = { id: 'qa-q1', type: 'single', score: 5, stem: '已知 $f(x)=x^2$，则 $f(2)$ 的值为（　）。', options: ['$1$', '$2$', '$3$', '$4$'], answer: ['D'], analysis: '代入可得 $f(2)=4$。', knowledge: ['函数'], difficulty: 'easy' };
  const q2 = { id: 'qa-q2', type: 'essay', score: 12, stem: '求方程 $x^2-1=0$ 的解。\n\n| 条件 | 数值 |\n| --- | --- |\n| 常数项 | $-1$ |', options: [], answer: ['$x=\\pm1$'], analysis: '因式分解。' };
  const exam = { id: 'qa-stable-exam', title: '题库与 AI · 隔离样卷', subtitle: '', duration: 90, notice: [], sections: [{ id: 's1', title: '单项选择题', type: 'single', note: '', questions: [q1] }, { id: 's2', title: '解答题', type: 'essay', note: '', questions: [q2] }] };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'none' };
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  fs.mkdirSync(out, { recursive: true });
  let calls = 0, delay = 0, app, page, stage = 'launch';
  const errors = [], checks = [], appearances = [], screenshots = [];
  const progress = name => { stage = name; console.log(JSON.stringify({ progress: name, packaged })); };
  const server = http.createServer(async (req, res) => {
    try {
      let body = ''; for await (const bytes of req) body += bytes;
      const request = JSON.parse(body); calls++;
      assert.ok(request.max_tokens >= 256 && request.max_tokens <= 8192);
      const text = typeof request.messages[0].content === 'string' ? request.messages[0].content : request.messages[0].content[0].text;
      const data = JSON.parse(text.match(/\n<data>([\s\S]*)<\/data>$/)[1]);
      assert.equal(data.globalStructure.questionCount, 2);
      const result = { summary: '测试报告：本卷范围覆盖需要人工复核。', recommendations: ['核查知识点标注。'], findings: [{ kind: 'coverage', severity: 'info', questionIds: [data.questions[0].id], message: '知识点建议', evidence: '依据当前题干。', suggestion: '请教师核对。' }], questionReviews: data.questions.map(q => ({ questionId: q.id, knowledge: ['AI建议知识点'], estimatedDifficulty: 'medium', rationale: '这是测试的定性建议。', answerCheck: 'not_checked', visualCheck: 'not_checked' })) };
      if (delay) await pause(delay);
      if (!res.destroyed) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] })); }
    } catch (error) { if (!res.destroyed) { res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); } }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  const watchdog = setTimeout(() => { app?.process().kill(); console.error(`Library QA timed out at ${stage}`); process.exit(1); }, 180000);
  const draft = () => page.evaluate(() => window.juanye.loadDraft());
  const analyze = () => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '试卷分析与双向细目表', exact: true }) });
  const nav = () => page.getByRole('navigation', { name: '工作区', exact: true });
  try {
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? [] : [root], env });
    await app.evaluate(({ BrowserWindow, dialog, ipcMain }) => { const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setPosition(-16000, -16000); win.showInactive(); dialog.showSaveDialog = async () => ({ canceled: true }); globalThis.__qaOcrCancels = 0; ipcMain.removeHandler('model:cancel'); ipcMain.handle('model:cancel', () => { globalThis.__qaOcrCancels++; }); });
    page = await app.firstWindow(); page.setDefaultTimeout(9000);
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await page.getByPlaceholder('输入题干…', { exact: true }).waitFor();
    await page.evaluate(async ({ endpoint, exam }) => { await window.juanye.saveModel({ baseUrl: endpoint, model: 'local-qa-model', key: 'sk-local-tests-only-never-real' }); await window.juanye.bankSave({ questions: exam.sections.flatMap(s => s.questions), origin: { examTitle: exam.title, examId: exam.id } }); }, { endpoint, exam });

    progress('20 appearances, two editor variants and narrow window');
    const variants = [{ theme: 'dark' }, { theme: 'light' }, ...themes.flatMap(id => [{ theme: 'telegram', scheme: 'dark', id }, { theme: 'telegram', scheme: 'light', id }])];
    for (const item of variants) {
      await page.evaluate(item => { const values = { 'juanye.appearance.v1': item.theme, 'juanye.telegram-scheme.v1': item.scheme || 'dark', 'juanye.telegram-theme.v1': item.id || 'ember' }; for (const [key, value] of Object.entries(values)) { localStorage.setItem(key, value); window.dispatchEvent(new StorageEvent('storage', { key, newValue: value })); } }, item);
      await nav().getByRole('button', { name: '本地题库', exact: true }).click();
      await page.getByTestId('bank-entry').first().waitFor();
      // Inspect settled palette/layout, not the patch's initial clips, stagger
      // or the mounted workspace's slide into view.
      await until(() => page.locator('[data-workspace-view="bank"]').evaluate(element => {
        const style = getComputedStyle(element);
        return Number(style.opacity) > .999 && (style.transform === 'none' || Math.abs(new DOMMatrixReadOnly(style.transform).m41) < .1);
      }), 'Workspace transition did not settle');
      await pause(750);
      for (const experimental of [false, true]) {
        await page.evaluate(value => { const key = 'juanye.experimental-workbench.v1'; localStorage.setItem(key, String(value)); window.dispatchEvent(new StorageEvent('storage', { key, newValue: String(value) })); }, experimental);
        const colors = await page.getByTestId('bank-workspace').evaluate(el => { const style = getComputedStyle(el), list = el.querySelector('.bank-catalog'); return { theme: document.documentElement.dataset.theme, scheme: document.documentElement.dataset.telegramScheme, color: style.color, bg: style.backgroundColor, fg: style.getPropertyValue('--color-fg').trim(), panel: style.getPropertyValue('--color-panel').trim(), width: el.getBoundingClientRect().width, viewport: innerWidth, overflow: el.scrollWidth > el.clientWidth + 1, listWidth: list?.getBoundingClientRect().width ?? 0 }; });
        assert.equal(colors.theme, item.theme); if (item.theme === 'telegram') assert.equal(colors.scheme, item.scheme);
        assert.ok(colors.fg && colors.panel && colors.fg !== colors.panel); assert.ok(!colors.overflow, JSON.stringify({ item, colors }));
        appearances.push({ ...item, experimental, ...colors });
      }
    }
    for (const width of [1000, 1280, 1500]) {
      await page.setViewportSize({ width, height: 800 }); await pause(80);
      const bounds = await page.getByTestId('bank-workspace').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, right: el.getBoundingClientRect().right, viewport: innerWidth }));
      assert.ok(bounds.scroll <= bounds.width + 1 && bounds.right <= bounds.viewport + 1, `Bank overflows at ${width}: ${JSON.stringify(bounds)}`);
    }
    await page.setViewportSize({ width: 1500, height: 980 });
    const shot = path.join(out, `bank-${suffix}.png`); await page.screenshot({ path: shot }); screenshots.push(shot);
    checks.push('20 appearances × classic/experimental editor preference, and 1000/1280/1500px bank layout bounds');

    progress('bank-only edits survive workspace switching and do not change paper');
    const bank = page.getByTestId('bank-workspace');
    await bank.locator('.bank-detail-tools').hover();
    await bank.getByRole('button', { name: '编辑', exact: true }).click();
    const bankEditor = page.getByTestId('bank-question-editor');
    await bankEditor.getByPlaceholder('输入题干…', { exact: true }).fill('未保存的题库草稿 $x+1$');
    await nav().getByRole('button', { name: '组卷', exact: true }).click();
    await nav().getByRole('button', { name: '本地题库', exact: true }).click();
    assert.equal(await bankEditor.getByPlaceholder('输入题干…', { exact: true }).inputValue(), '未保存的题库草稿 $x+1$');
    assert.equal((await draft()).exam.sections[1].questions[0].stem, q2.stem);
    await bank.locator('.bank-edit-footer').getByRole('button', { name: '取消', exact: true }).click();
    checks.push('Unsaved bank draft is retained across workspaces; paper content remains unchanged');

    progress('real analysis IPC against localhost model, cache, metadata apply and undo');
    await nav().getByRole('button', { name: '组卷', exact: true }).click();
    await nav().getByRole('button', { name: '试卷分析', exact: true }).click();
    await analyze().getByRole('tab', { name: 'AI 评估', exact: true }).click();
    await analyze().getByRole('button', { name: '预览并确认发送', exact: true }).click();
    assert.equal(calls, 0, 'Model called before explicit budget confirmation');
    await analyze().getByRole('button', { name: '确认并开始分析', exact: true }).click();
    await analyze().getByText('测试报告：本卷范围覆盖需要人工复核。', { exact: true }).waitFor(); assert.equal(calls, 1);
    let reports = await page.evaluate(() => window.juanye.loadExamReports('qa-stable-exam'));
    assert.equal(reports.length, 1); assert.equal(reports[0].requestCount, 1); assert.ok(reports[0].questionReviews.every(q => q.visualCheck === 'not_checked'));
    await analyze().getByRole('button', { name: '预览并确认发送', exact: true }).click();
    await analyze().getByRole('button', { name: '确认并开始分析', exact: true }).click();
    await until(async () => (await page.evaluate(() => window.juanye.loadExamReports('qa-stable-exam'))).length === 2, 'Repeated report not saved');
    reports = await page.evaluate(() => window.juanye.loadExamReports('qa-stable-exam')); assert.equal(calls, 1); assert.equal(reports[0].cacheHits, 1);
    await analyze().getByRole('button', { name: '应用选中建议', exact: true }).click();
    await until(async () => (await draft()).exam.sections[0].questions[0].knowledge.includes('AI建议知识点'), 'Suggested tags not applied');
    await analyze().getByText('历史报告：已过期', { exact: true }).waitFor();
    assert.equal((await draft()).exam.sections[0].questions[0].analysis, q1.analysis);
    await analyze().getByRole('button', { name: '撤销本次应用', exact: true }).click();
    await until(async () => JSON.stringify((await draft()).exam.sections[0].questions[0].knowledge) === JSON.stringify(q1.knowledge), 'Metadata undo did not restore original');
    assert.equal((await draft()).exam.sections[1].questions[0].difficulty, undefined);
    await analyze().getByRole('button', { name: '定位第 1 题', exact: true }).click();
    await page.getByPlaceholder('输入题干…', { exact: true }).waitFor(); assert.equal(await page.getByPlaceholder('输入题干…', { exact: true }).inputValue(), q1.stem);
    checks.push('Real preload/main/service/model HTTP flow, explicit confirmation, persisted reports, zero-request cache repeat, guarded tag apply, stale report and exact undo');

    progress('cancel is task-local and does not invoke OCR cancel');
    await nav().getByRole('button', { name: '试卷分析', exact: true }).click(); await analyze().getByRole('tab', { name: 'AI 评估', exact: true }).click();
    await analyze().getByLabel('使用目的', { exact: true }).fill('测试取消'); delay = 2000;
    await analyze().getByRole('button', { name: '预览并确认发送', exact: true }).click(); await analyze().getByRole('button', { name: '确认并开始分析', exact: true }).click();
    await until(async () => calls === 2, 'Cancel fixture request did not start');
    await analyze().getByRole('button', { name: '取消整卷分析', exact: true }).click();
    await analyze().getByText('整卷分析已取消。', { exact: true }).waitFor();
    await pause(250); assert.equal((await page.evaluate(() => window.juanye.loadExamReports('qa-stable-exam'))).length, 2); assert.equal(await app.evaluate(() => globalThis.__qaOcrCancels), 0);
    await analyze().getByRole('button', { name: '关闭试卷分析', exact: true }).click();
    checks.push('Cancellation stops analysis without saving a partial report or calling the shared OCR cancel endpoint');

    progress('export center and real editable Word IPC');
    await page.getByRole('button', { name: '导出中心', exact: true }).click();
    const center = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '导出', exact: true }) });
    await center.getByRole('button', { name: /Word 可编辑文字/ }).click();
    await app.evaluate(({ dialog }, out) => { dialog.showSaveDialog = async (_win, options) => ({ canceled: false, filePath: `${out}/export-center.${options.filters[0].extensions[0]}` }); }, out);
    await center.getByRole('button', { name: '导出 Word', exact: true }).click();
    await until(async () => fs.existsSync(path.join(out, 'export-center.docx')), 'Export center Word did not use actual exporter');
    assert.ok(fs.statSync(path.join(out, 'export-center.docx')).size > 1000);
    assert.deepEqual(errors, []);
    checks.push('Export center dispatches to actual editable Word exporter');

    progress('bank source revisions are compared and manually adopted, never auto overwritten');
    await nav().getByRole('button', { name: '本地题库', exact: true }).click();
    const firstRow = bank.getByTestId('bank-entry').filter({ hasText: 'f(2)' }).first();
    await firstRow.hover();
    await firstRow.getByRole('button', { name: '选题', exact: true }).click();
    await bank.getByRole('button', { name: '加入当前试卷', exact: true }).click();
    await until(async () => (await draft()).exam.sections[0].questions.length === 2, 'Linked snapshot not inserted');
    const inserted = (await draft()).exam.sections[0].questions[1]; assert.ok(inserted.bankOrigin);
    await page.evaluate(async () => { const bank = await window.juanye.bankLoad(); const entry = bank.entries.find(entry => entry.question.id === 'qa-q1'); await window.juanye.bankRevise({ id: entry.id, expectedContentKey: entry.contentKey, question: { ...entry.question, stem: '题库新版：计算 $f(3)$。' } }); });
    assert.equal((await draft()).exam.sections[0].questions[1].stem, q1.stem);
    await nav().getByRole('button', { name: '本地题库', exact: true }).click(); await nav().getByRole('button', { name: '组卷', exact: true }).click();
    await page.getByText('题库有新版本 · v2', { exact: true }).waitFor();
    await page.getByRole('button', { name: '与题库比较', exact: true }).click();
    const compare = page.getByRole('dialog', { name: '与题库比较', exact: true });
    await compare.getByText('当前试卷 · 来源 v1 · 5 分', { exact: true }).waitFor();
    await compare.getByRole('button', { name: '采用题库新版本', exact: true }).click();
    await until(async () => (await draft()).exam.sections[0].questions[1].bankOrigin.version === 2, 'Manual adoption failed');
    const adopted = (await draft()).exam.sections[0].questions[1]; assert.equal(adopted.id, inserted.id); assert.equal(adopted.stem, '题库新版：计算 $f(3)$。');
    await page.locator('.workspace-editor-stage').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Control+z');
    await until(async () => (await draft()).exam.sections[0].questions[1].bankOrigin.version === 1, 'Adoption undo failed');
    checks.push('Source update does not modify paper; explicit two-column comparison adopts newer revision preserving local ID and can undo');
    const result = { passed: true, packaged, checks, appearances, screenshots, localMockModelCalls: calls, paidModelCalls: 0, errors };
    fs.writeFileSync(path.join(out, `results-${suffix}.json`), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ ...result, appearances: appearances.length }));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(out, `failure-${suffix}.png`) }).catch(() => {});
    throw Error(`${stage}: ${error.stack || error}`);
  } finally {
    clearTimeout(watchdog); if (app) await app.close().catch(() => app.process().kill());
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    const resolved = fs.realpathSync(profile); assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); assert.ok(path.basename(resolved).startsWith('juanye-library-ai-')); fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
