/* Teacher workflow integration: isolated fixtures, real storage/export IPC, mocked models only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const withDocx = process.argv.includes('--docx');
const capture = process.argv.includes('--screenshots');
const suffix = packaged ? 'packaged' : 'source';
const out = path.join(root, 'artifacts/qa-teacher-workflows');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const stem = '已知 $f(x)=x^2$，则 $f(2)$ 的值为（　）。\n\n| 条件 | 数值 |\n| --- | --- |\n| 输入 | $2$ |';
const variantStem = '已知 $f(x)=x^2$，则 $f(3)$ 的值为（　）。';
const analysisText = '代入 $x=2$，得 $f(2)=4$。';

async function until(predicate, message, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await pause(50); }
  throw Error(message);
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-teacher-ui-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  fs.mkdirSync(out, { recursive: true });
  const exam = { title: '教师工具样例 A 卷', subtitle: '', duration: 90, notice: [], sections: [
    { id: 's1', type: 'single', title: '单项选择题', note: '', questions: [{ id: 'q1', type: 'single', score: 5, stem, options: ['$1$', '$2$', '$3$', '$4$'], answer: ['D'], analysis: '', knowledge: ['函数', '代入'], difficulty: 'easy', source: '测试来源' }] },
    { id: 's2', type: 'blank', title: '填空题', note: '', questions: [{ id: 'q2', type: 'blank', score: 7, stem: '若 $x+1=3$，则 $x=$______。', options: [], answer: ['$2$'], analysis: '移项即可。', knowledge: ['方程'], difficulty: 'medium', source: '测试来源' }] },
  ] };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'full', quickAnswers: true };
  const initialDraft = { version: 1, exam, layout, history: [] };
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify(initialDraft));
  const checks = [], errors = [], screenshots = [], pasteEvents = [];
  let app, page, stage = 'launch';
  const progress = value => { stage = value; console.log(JSON.stringify({ progress: value })); };
  const watchdog = setTimeout(() => { app?.process().kill(); console.error(`Teacher workflow QA timeout at ${stage}`); process.exit(1); }, 110000);
  const load = () => page.evaluate(() => window.juanye.loadDraft());
  const count = draft => draft.exam.sections.reduce((total, section) => total + section.questions.length, 0);
  async function command(name) {
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder('搜索题目、执行命令…', { exact: true }).fill(name);
    await page.getByRole('button', { name, exact: true }).click();
  }
  async function selectFirst() {
    await page.getByRole('button', { name: '编辑第 1 题', exact: true }).click();
    await until(async () => (await page.getByPlaceholder('输入题干…', { exact: true }).inputValue()) === stem, 'First original question not selected');
  }
  async function pasteAt(selector, text = '', includeImage = true) {
    const result = await page.locator(selector).first().evaluate((el, { text, includeImage }) => {
      const raw = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6UGkAAAAASUVORK5CYII=');
      const file = new File([Uint8Array.from(raw, char => char.charCodeAt(0))], 'screenshot.png', { type: 'image/png' });
      const data = new DataTransfer(); if (includeImage) data.items.add(file); if (text) data.setData('text/plain', text);
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      return { tag: el.tagName, group: el.closest('[data-workbench-group]')?.getAttribute('data-workbench-group'), textLength: text.length, includeImage, prevented: event.defaultPrevented, dialogs: document.querySelectorAll('[role="dialog"]').length };
    }, { text, includeImage });
    pasteEvents.push({ selector, ...result });
  }
  try {
    const flags = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? flags : [root, ...flags], env });
    await app.evaluate(({ BrowserWindow, ipcMain, session, dialog }, { out, stem, variantStem, analysisText }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setSize(1500, 980); win.setPosition(-16000, -16000); win.showInactive();
      globalThis.__teacherRequests = 0; globalThis.__teacherOcr = 0; globalThis.__teacherGenerations = []; globalThis.__teacherSaves = []; globalThis.__teacherGenerationDelay = 0; globalThis.__teacherCancels = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => { globalThis.__teacherRequests++; cb({ cancel: true }); });
      ipcMain.removeHandler('model:get'); ipcMain.handle('model:get', () => ({ baseUrl: 'https://example.invalid/v1', model: 'test-only', hasKey: true }));
      ipcMain.removeHandler('model:cancel'); ipcMain.handle('model:cancel', () => { globalThis.__teacherCancels++; });
      ipcMain.removeHandler('model:recognize'); ipcMain.handle('model:recognize', (_, options) => {
        globalThis.__teacherOcr++;
        if (!options.image.startsWith('data:image/png;base64,')) throw Error('Screenshot was not passed intact');
        return JSON.stringify({ questions: [{ type: 'essay', score: 12, stem: '粘贴识别样例：求 $2+3$。', options: [], answer: [], analysis: '' }] });
      });
      ipcMain.removeHandler('model:generate'); ipcMain.handle('model:generate', async (_, options) => {
        globalThis.__teacherGenerations.push({ action: options.action, question: options.question });
        if (globalThis.__teacherGenerationDelay) await new Promise(resolve => setTimeout(resolve, globalThis.__teacherGenerationDelay));
        const q = options.question;
        return JSON.stringify({ questions: [{ type: q.type, score: q.score, stem: options.action === 'variant' ? variantStem : q.stem, options: options.action === 'variant' ? ['$6$', '$7$', '$8$', '$9$'] : q.options, answer: options.action === 'variant' ? ['D'] : ['A'], analysis: options.action === 'variant' ? '代入 $x=3$，得 $f(3)=9$。' : analysisText }] });
      });
      dialog.showSaveDialog = async (_window, options) => {
        const extension = options.filters[0].extensions[0];
        const filePath = `${out}/${extension === 'docx' ? 'sample.docx' : `analysis.${extension}`}`;
        globalThis.__teacherSaves.push({ extension, filePath }); return { canceled: false, filePath };
      };
    }, { out, stem, variantStem, analysisText });
    page = await app.firstWindow(); page.setDefaultTimeout(9000); await page.setViewportSize({ width: 1500, height: 980 });
    page.on('pageerror', error => errors.push(error.message));
    await page.getByPlaceholder('输入题干…', { exact: true }).waitFor();
    await page.evaluate(() => { localStorage.setItem('juanye.sidebar-expanded.v1', 'true'); localStorage.setItem('juanye.appearance.v1', 'light'); });
    await page.reload(); await page.getByRole('button', { name: '编辑第 1 题', exact: true }).waitFor();
    await until(async () => count(await load()) === 2, 'Initial fixture not loaded');

    progress('analysis and CSV');
    await command('试卷分析与双向细目表');
    const analysis = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '试卷分析与双向细目表', exact: true }) });
    await analysis.getByText('2 题 · 12 分', { exact: true }).waitFor();
    assert.equal(await analysis.locator('table').count(), 3);
    await analysis.getByRole('tab', { name: '双向细目表', exact: true }).click();
    assert.equal(await analysis.locator('table').count(), 1);
    await analysis.getByRole('tab', { name: '逐题细目', exact: true }).click();
    assert.equal(await analysis.locator('table').count(), 1);
    await analysis.getByRole('button', { name: '导出 CSV', exact: true }).click();
    const csvPath = path.join(out, 'analysis.csv'); await until(async () => fs.existsSync(csvPath), 'CSV export missing');
    const csv = fs.readFileSync(csvPath, 'utf8'); assert.ok(csv.startsWith('\uFEFF')); assert.match(csv, /双向细目表/); assert.match(csv, /函数/); assert.match(csv, /2.5/); assert.match(csv, /方程/);
    await analysis.getByRole('button', { name: '关闭试卷分析', exact: true }).click();
    checks.push('Analysis and two-way detail matrix show type/knowledge/difficulty score allocation, and real CSV export preserves Chinese text and totals');

    progress('B paper and rollback');
    await command('生成 B 卷（选项乱序）');
    await page.getByRole('button', { name: '生成并使用 B 卷', exact: true }).click();
    let b;
    await until(async () => { b = await load(); return b.exam.title.endsWith('B卷'); }, 'B paper not applied');
    const backupPath = path.join(profile, 'draft.pre-0.4.0.json');
    await until(async () => fs.existsSync(backupPath), 'Pre-upgrade recovery draft was not created');
    assert.equal(fs.readFileSync(backupPath, 'utf8'), JSON.stringify(initialDraft));
    const bq = b.exam.sections[0].questions[0]; assert.notDeepEqual(bq.options, exam.sections[0].questions[0].options); assert.equal(bq.options[bq.answer[0].charCodeAt(0) - 65], '$4$');
    assert.ok(b.history.some(item => item.label.includes('生成B卷前') && item.exam.sections[0].questions[0].answer[0] === 'D'));
    await page.keyboard.press('Control+z'); await until(async () => (await load()).exam.title === exam.title, 'Undo did not restore A paper');
    assert.deepEqual((await load()).exam.sections[0].questions[0].options, exam.sections[0].questions[0].options);
    checks.push('B paper remaps answer letters with options, preserves A in history, and a single workspace undo restores the original');

    progress('workspace screenshot paste auto OCR');
    await pasteAt('[data-editor-workbench]');
    const ocr = page.getByRole('dialog').filter({ hasText: '识别题目' });
    await ocr.getByRole('button', { name: '添加 1 道题到试卷', exact: true }).waitFor({ state: 'visible' });
    await until(async () => !(await ocr.getByRole('button', { name: '添加 1 道题到试卷', exact: true }).isDisabled()), 'Pasted screenshot was not recognized automatically');
    assert.equal(await app.evaluate(() => globalThis.__teacherOcr), 1); assert.equal(count(await load()), 2);
    await ocr.getByRole('button', { name: '添加 1 道题到试卷', exact: true }).click();
    await until(async () => count(await load()) === 3, 'Confirmed OCR question not added');
    await selectFirst();
    await pasteAt('textarea[placeholder="输入题干…"]', '本地粘贴文字', false); await pause(150);
    assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(await app.evaluate(() => globalThis.__teacherOcr), 1);
    await page.getByPlaceholder('输入题干…', { exact: true }).fill(stem);
    await pasteAt('textarea[placeholder="输入题干…"]', '带截图的文字'); await pause(150);
    assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(await app.evaluate(() => globalThis.__teacherOcr), 1);
    await page.getByPlaceholder('输入题干…', { exact: true }).fill(stem);
    await pasteAt('textarea[placeholder="输入题干…"]');
    await until(async () => await app.evaluate(() => globalThis.__teacherOcr) === 2, 'Screenshot pasted into stem did not auto-recognize');
    await ocr.getByRole('button', { name: '添加 1 道题到试卷', exact: true }).waitFor({ state: 'visible' });
    await until(async () => !(await ocr.getByRole('button', { name: '添加 1 道题到试卷', exact: true }).isDisabled()), 'Stem screenshot OCR did not finish');
    assert.equal(count(await load()), 3);
    await ocr.getByRole('button', { name: '关闭', exact: true }).click();
    await pasteAt('[data-workbench-group="figures"] .space-y-3');
    try {
      await until(async () => (await load()).exam.sections[0].questions[0].figures?.length === 1, 'Image-area paste did not attach a figure');
    } catch (error) {
      const state = { pasteEvents, draft: await load(), editor: await page.locator('[data-editor-workbench]').innerText(), alerts: await page.getByRole('alert').allTextContents(), counters: await app.evaluate(() => ({ ocr: globalThis.__teacherOcr, generations: globalThis.__teacherGenerations.length })) };
      const target = path.join(out, `image-paste-failure-${suffix}.json`); fs.writeFileSync(target, JSON.stringify(state, null, 2)); console.error(JSON.stringify({ failureDiagnostic: target, pasteEvents, alerts: state.alerts, counters: state.counters })); throw error;
    }
    assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(await app.evaluate(() => globalThis.__teacherOcr), 2);
    checks.push('Screenshot paste in the workspace or stem starts OCR once and requires confirmation; plain/mixed text paste stays text, while dedicated image-area paste only attaches an image');

    progress('variant and analysis review');
    await command('生成变式题');
    let generation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '生成变式题', exact: true }) });
    await generation.getByRole('button', { name: '生成草稿', exact: true }).click();
    await generation.getByRole('heading', { name: '草稿 · 待核对', exact: true }).waitFor();
    assert.equal(count(await load()), 3);
    await generation.getByRole('button', { name: '作为新题加入', exact: true }).click();
    await until(async () => count(await load()) === 4, 'Variant insertion missing');
    const variant = (await load()).exam.sections.flatMap(section => section.questions).find(q => q.flag?.includes('生成变式题'));
    assert.ok(variant); assert.match(variant.stem, /f\(3\)/); assert.notEqual(variant.id, 'q1'); assert.match(variant.flag, /待核对/); assert.equal(variant.options[3], '$9$');
    await selectFirst();
    await command('补写解析草稿');
    generation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '补写解析', exact: true }) });
    await generation.getByRole('button', { name: '生成草稿', exact: true }).click();
    await generation.getByRole('heading', { name: '草稿 · 待核对', exact: true }).waitFor();
    assert.equal((await load()).exam.sections[0].questions[0].analysis, '');
    await generation.getByRole('button', { name: '写入解析草稿', exact: true }).click();
    let final;
    await until(async () => { final = await load(); return final.exam.sections[0].questions[0].analysis === analysisText; }, 'Analysis draft not applied');
    const original = final.exam.sections[0].questions[0]; assert.deepEqual(original.answer, ['D']); assert.equal(original.stem, stem); assert.match(original.flag, /待核对/);
    assert.equal(await app.evaluate(() => globalThis.__teacherGenerations.length), 2);
    checks.push('Variant and explanation models return reviewable drafts only; explicit insertion flags generated content, preserves original questions and never changes original answers');

    progress('generation cancellation and immutable recovery baseline');
    await app.evaluate(() => { globalThis.__teacherGenerationDelay = 700; });
    await command('补写解析草稿');
    generation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '补写解析', exact: true }) });
    await generation.getByRole('button', { name: '生成草稿', exact: true }).click();
    await generation.getByRole('button', { name: '取消生成', exact: true }).click();
    const cancellationCount = await app.evaluate(() => globalThis.__teacherCancels);
    assert.ok(cancellationCount >= 1, 'Cancel did not invoke the shared native cancel IPC');
    await pause(900);
    assert.equal(await generation.getByRole('heading', { name: '草稿 · 待核对', exact: true }).count(), 0);
    assert.ok(await generation.getByRole('button', { name: '写入解析草稿', exact: true }).isDisabled());
    await generation.getByRole('button', { name: '关闭生成草稿', exact: true }).click();
    assert.equal(count(await load()), 4);
    assert.equal(fs.readFileSync(backupPath, 'utf8'), JSON.stringify(initialDraft));
    checks.push('Cancelling generation discards a late model response; the pre-0.4.0 draft backup remains byte-for-byte equivalent to the original fixture after AB/undo/OCR/AI saves');

    progress('draft lifecycle across repeated source and task changes');
    await app.evaluate(() => { globalThis.__teacherGenerationDelay = 0; });
    await command('补写解析草稿');
    generation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '补写解析', exact: true }) });
    assert.equal(await generation.getByRole('heading', { name: '草稿 · 待核对', exact: true }).count(), 0);
    assert.ok(await generation.getByRole('button', { name: '写入解析草稿', exact: true }).isDisabled());
    await generation.getByRole('button', { name: '生成草稿', exact: true }).click();
    await generation.getByRole('heading', { name: '草稿 · 待核对', exact: true }).waitFor();
    // Replacing an AI task for the same question uses the existing React component.
    await command('生成变式题');
    generation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '生成变式题', exact: true }) });
    await generation.getByRole('button', { name: '生成草稿', exact: true }).waitFor();
    assert.equal(await generation.getByRole('heading', { name: '草稿 · 待核对', exact: true }).count(), 0);
    assert.ok(await generation.getByRole('button', { name: '作为新题加入', exact: true }).isDisabled());
    await generation.getByRole('button', { name: '关闭生成草稿', exact: true }).click();
    assert.equal(count(await load()), 4);
    checks.push('Reopening the same question and switching AI actions never exposes or applies the previous task draft');

    if (withDocx) {
      progress('real Word export IPC');
      const target = path.join(out, 'sample.docx');
      if (fs.existsSync(target)) fs.unlinkSync(target);
      await command('导出 Word（可编辑公式）');
      await until(async () => fs.existsSync(target) && fs.statSync(target).size > 1000, 'Word file missing', 15000);
      const zip = await JSZip.loadAsync(fs.readFileSync(target));
      const xml = await zip.file('word/document.xml').async('string');
      assert.match(xml, /<m:oMath/); assert.match(xml, /<w:tbl>/); assert.match(xml, /参考答案/); assert.match(xml, /解析/); assert.ok(!xml.includes('$f(x)'));
      checks.push('Real Word export IPC creates an OOXML document with editable text, native OMML equations, tables and answer/analysis sections (Word layout rendering remains a separate gate)');
    }
    if (capture) {
      await command('试卷分析与双向细目表'); await pause(300); await page.evaluate(() => document.fonts.ready);
      const target = path.join(out, `analysis-${suffix}.png`);
      const data = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'));
      fs.writeFileSync(target, Buffer.from(data, 'base64')); screenshots.push(target);
    }
    assert.deepEqual(errors, []);
    const requests = await app.evaluate(() => ({ cloudRequests: globalThis.__teacherRequests, mockedOcrCalls: globalThis.__teacherOcr, mockedGenerationCalls: globalThis.__teacherGenerations.length, cancelIpcCalls: globalThis.__teacherCancels }));
    assert.equal(requests.cloudRequests, 0);
    const report = { passed: true, packaged, docxExported: withDocx, checks, screenshots, pasteEvents, ...requests, realModelCalls: 0, errors };
    fs.writeFileSync(path.join(out, `results-${suffix}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally {
    clearTimeout(watchdog); if (app) await app.close().catch(() => app.process().kill());
    const resolved = fs.realpathSync(profile); assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); assert.ok(path.basename(resolved).startsWith('juanye-teacher-ui-')); fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
