/* Offline workflow QA. All drafts/files are synthetic; no API key, OCR, or external request is used.
 * Use --imports-only for import checks and --layout-only --with-pdf to inspect actual PDF output.
 * --pdf-only exports the three current layout variants without repeating the import checks.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');

const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const layoutOnly = process.argv.includes('--layout-only') || process.argv.includes('--pdf-only');
const pdfOnly = process.argv.includes('--pdf-only');
const withPdf = process.argv.includes('--with-pdf') || pdfOnly;
const phase = layoutOnly ? 'layout' : 'imports';
const suffix = packaged ? 'packaged' : 'source';
const output = path.join(root, 'artifacts/qa-import-workflow');
const pdfOutput = path.join(root, 'output/pdf');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(80); }
  throw new Error(message);
}

const questionFile = `# 题目文件样例
一、单项选择题
**21.**（5 分）导入题目甲：已知 $f(x)=x$，则 $f(2)$ 为
A. $1$ B. $2$ C. $3$ D. $4$
答案：B
解析：题目文件模式不应带入这段解析。
二、解答题
**22.**（12 分）导入题目乙：求 $x+1=3$ 的解。
（1）写出等式；（2）求解。
答案：$x=2$
解析：同样不应进入题目文件模式的解析框。`;
const solutionsFile = `# 参考答案与解析
**16.**
答案：B
解析：解析文件按原题号匹配，代入 $f(2)=2$，故选 $B$。
来源：解析导入来源
知识点：函数，代入
难度：中等
**17.**
答案：$x=2$
解析：两边同时减去 $1$，得 $x=2$。
**99.**
答案：A
解析：没有对应题目，不应新建题目。`;
const solutionOverwriteFile = `**16.**
答案：B
解析：解析文件按原题号匹配，代入 $f(2)=2$，故选 $B$。
来源：解析导入来源
知识点：函数，代入
难度：中等`;
const duplicateSolutionsFile = `16. 答案：B
解析：第一条。
16. 答案：C
解析：重复题号不应按次序错配。`;
const annotatedAfterFile = `# 题后解析版样例
一、单项选择题
**31.**（5 分）题后版甲：下列正确的是
A. $1$ B. $2$ C. $3$ D. $4$
答案：C
解析：题后解析样例，保留表格与数学。
| 项目 | 值 |
| --- | --- |
| 数据 | $3$ |
二、解答题
**32.**（12 分）题后版乙：求 $x+1=3$ 的解。
答案：$x=2$
解析：题后版乙解析，移项即可。`;
const annotatedTailFile = `# 卷尾解析版样例
一、多项选择题
**41.**（6 分）卷尾版甲：下列说法正确的是
A. 甲 B. 乙 C. 丙 D. 丁
二、填空题
**42.**（5 分）卷尾版乙：已知 $x+1=3$，则 $x=$______。

# 参考答案与解析
**41.**
答案：AD
解析：卷尾解析样例，第一项与第四项正确。
**42.**
答案：$2$
解析：卷尾版乙解析，由 $x+1=3$ 得 $x=2$。`;

const baseLayout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: true, paperMode: 'questions', answerMode: 'none', quickAnswers: true };
function seedExam(layoutMode) {
  if (!layoutMode) return { title: '导入工作流 · 本地隔离检查', subtitle: '', duration: 120, notice: [], sections: [
    { id: 'qa-single', type: 'single', title: '单项选择题', note: '', questions: [
      { id: 'qa-original-16', importNumber: 16, type: 'single', score: 8, stem: '原有题干：已知 $f(x)=x$，求 $f(2)$。', options: ['$1$', '$2$', '$3$', '$4$'], answer: ['A'], analysis: '本地解析保留。', source: '本地手动来源', knowledge: ['本地知识点'], difficulty: 'hard' },
    ] },
    { id: 'qa-essay', type: 'essay', title: '解答题', note: '', questions: [
      { id: 'qa-original-17', importNumber: 17, type: 'essay', score: 15, stem: '原有第17题：求 $x+1=3$ 的解。', options: [], answer: [], analysis: '', answerSpace: 'full' },
    ] },
  ] };
  const sections = [
    { id: 'qa-single', type: 'single', title: '单项选择题', note: '', questions: [] },
    { id: 'qa-blank', type: 'blank', title: '填空题', note: '', questions: [] },
    { id: 'qa-essay', type: 'essay', title: '解答题', note: '', questions: [] },
  ];
  for (let n = 1; n <= 19; n++) {
    const type = n <= 12 ? 'single' : n <= 16 ? 'blank' : 'essay';
    sections[type === 'single' ? 0 : type === 'blank' ? 1 : 2].questions.push({ id: `qa-q${n}`, importNumber: n, type, score: type === 'essay' ? 12 : 5,
      stem: type === 'essay' ? `解答题 ${n}：已知函数 $f(x)=x^2-2x$。\n（1）求最小值；（2）求 $f(x)\\le0$ 的解集。` : type === 'single' ? `第 ${n} 小题，$1+1$ 的值为` : `第 ${n} 小题，求 $2+2$ 的值：______。`,
      options: type === 'single' ? ['$1$', '$2$', '$3$', '$4$'] : [], answer: [], analysis: '', ...(type === 'essay' ? { answerSpace: 'full' } : {}),
    });
  }
  return { title: '试卷与答题空间 · 本地排版示例', subtitle: '普通试卷 / 答题卡 / 一体卷', duration: 120, notice: [], sections };
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-import-workflow-qa-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  fs.writeFileSync(path.join(userData, 'draft.json'), JSON.stringify({ version: 1, exam: seedExam(layoutOnly), layout: baseLayout, history: [] }));
  let app, page, stage = 'launch', network = 0, timedOut = false, pdfExports = 0;
  const checks = [], errors = [], snapshots = [], files = [];
  const progress = name => { stage = name; console.log(JSON.stringify({ progress: name })); };
  const timer = setTimeout(() => { timedOut = true; console.error(JSON.stringify({ passed: false, stage, error: 'Focused import/layout QA exceeded 140 seconds' })); try { app?.process().kill(); } catch {} process.exitCode = 1; }, 140000);
  try {
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? [] : [root], env, timeout: 25000 });
    await app.evaluate(({ BrowserWindow, session, ipcMain, dialog }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false);
      globalThis.__workflowNetwork = 0; globalThis.__workflowModelCalls = 0; globalThis.__workflowSaveCalls = []; globalThis.__workflowSaveTarget = undefined;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { globalThis.__workflowNetwork++; callback({ cancel: true }); });
      ipcMain.removeHandler('model:recognize'); ipcMain.handle('model:recognize', () => { globalThis.__workflowModelCalls++; throw new Error('Import/layout QA may not invoke OCR'); });
      dialog.showSaveDialog = async (_window, options) => { globalThis.__workflowSaveCalls.push(options); return globalThis.__workflowSaveTarget ? { canceled: false, filePath: globalThis.__workflowSaveTarget } : { canceled: true }; };
    });
    page = await app.firstWindow(); page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await page.route(/^https?:\/\//, route => { network++; return route.abort('blockedbyclient'); });
    await page.setViewportSize({ width: 1440, height: 960 });
    const editor = page.locator('.workspace-editor-stage');
    const preview = page.locator('.workspace-preview-stage');
    const sidebar = () => page.getByRole('complementary', { name: '试卷目录', exact: true });
    const draft = () => page.evaluate(() => window.juanye.loadDraft());
    const flat = async () => (await draft()).exam.sections.flatMap(section => section.questions);
    const byId = async id => (await flat()).find(q => q.id === id);
    const byNumber = async number => (await flat()).find(q => q.importNumber === number);
    const sheets = () => preview.locator('.paper[data-sheet]');
    await editor.getByPlaceholder('输入题干…', { exact: true }).waitFor();
    async function ready() {
      await until(async () => await preview.locator('[data-pagination-ready="true"]').count() === 1, 'Paper pagination did not finish');
      await page.evaluate(() => document.fonts.ready); await pause(120);
    }
    async function expandSidebar() {
      if (await sidebar().getAttribute('data-sidebar-state') !== 'expanded') await sidebar().getByRole('button', { name: '展开目录面板', exact: true }).click({ force: true });
    }
    async function command(title) {
      await page.keyboard.press('Control+k');
      const palette = page.getByRole('dialog').filter({ has: page.getByPlaceholder('搜索题目、执行命令…', { exact: true }) });
      await palette.getByPlaceholder('搜索题目、执行命令…', { exact: true }).fill(title);
      await palette.getByText(title, { exact: true }).click({ force: true });
    }
    async function openImport(title) {
      await command(title);
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      await dialog.waitFor(); return dialog;
    }
    async function loadText(dialog, name, content, allowError = false) {
      await dialog.locator('input[data-import-file]').setInputFiles({ name, mimeType: 'text/markdown', buffer: Buffer.from(content, 'utf8') });
      await until(async () => await dialog.getByRole('button', { name: /^(?:导入 \d+ 道题|应用 \d+ 道解析)$/ }).count() === 1 || allowError && await dialog.getByRole('alert').count() > 0, 'Import preview did not produce a confirmation action');
    }
    async function chooseQuestion(id) {
      await expandSidebar();
      const target = sidebar().locator(`[data-question-id="${id}"]`).getByRole('button', { name: /^编辑第 \d+ 题$/ });
      await target.focus(); await target.press('Enter');
      await until(async () => await editor.getByPlaceholder('输入题干…', { exact: true }).inputValue() === (await byId(id)).stem, `Editor did not select ${id}`);
    }
    async function selectOption(label, option) {
      const trigger = page.getByRole('combobox', { name: label, exact: true });
      await trigger.focus(); await trigger.press('ArrowDown');
      await page.getByRole('option', { name: option, exact: true }).click();
    }
    async function switchView(label) {
      await preview.getByRole('tab', { name: label, exact: true }).click({ force: true });
      await until(async () => label === '答题卡' ? await preview.locator('[data-answer-card]').count() === 1 : await preview.locator('[data-answer-card]').count() === 0 && await sheets().count() > 0, `Preview did not switch to ${label}`);
      await ready();
    }
    async function paperState() {
      await ready();
      return sheets().evaluateAll(papers => ({ pages: papers.length, spaces: [...papers.flatMap(p => [...p.querySelectorAll('[data-paper-answer-space]')])].map(el => ({ id: el.getAttribute('data-space-for'), space: el.getAttribute('data-paper-answer-space'), height: el.offsetHeight })), questionIds: [...new Set(papers.flatMap(p => [...p.querySelectorAll('[data-qid]')].map(el => el.dataset.qid)))] }));
    }
    async function cardState() {
      await ready();
      return sheets().evaluateAll(papers => ({ pages: papers.length, boxes: papers.flatMap(paper => [...paper.querySelectorAll('[data-answer-number]')].map(el => ({ number: Number(el.dataset.answerNumber), space: el.dataset.answerSpace, height: el.offsetHeight }))) }));
    }
    async function exportPdf(name) {
      if (!withPdf) return;
      fs.mkdirSync(pdfOutput, { recursive: true });
      const target = path.join(pdfOutput, name);
      await app.evaluate((_electron, filename) => { globalThis.__workflowSaveTarget = filename; }, target);
      const start = Date.now();
      await page.getByRole('button', { name: '导出 PDF', exact: true }).click({ force: true });
      await until(async () => fs.existsSync(target) && fs.statSync(target).mtimeMs >= start && fs.statSync(target).size > 10000, `PDF not created: ${name}`, 25000);
      await until(async () => await page.locator('#print-root').count() === 0, 'PDF export did not release the print DOM');
      assert.equal(fs.readFileSync(target).subarray(0, 4).toString(), '%PDF');
      files.push(target); pdfExports++;
    }
    if (!layoutOnly) {
      progress('Three command-only import entries and questions-only isolation');
      assert.equal(await page.getByRole('button', { name: '导入文件 / 项目', exact: true }).count(), 0, 'Legacy sidebar import button remains');
      const questionImport = await openImport('导入题目文件');
      assert.equal(await questionImport.locator('[aria-label="答案解析位置"]').count(), 0, 'Questions-only import asks about answer placement');
      await loadText(questionImport, 'questions.md', questionFile);
      await questionImport.getByRole('button', { name: '导入 2 道题', exact: true }).click({ force: true });
      await until(async () => (await flat()).length === 4, 'Questions-only file was not committed as two questions');
      const q21 = await byNumber(21), q22 = await byNumber(22);
      assert.ok(q21 && q22, 'Source question numbers were not retained');
      assert.deepEqual(q21.options, ['$1$', '$2$', '$3$', '$4$']);
      for (const q of [q21, q22]) { assert.deepEqual(q.answer, []); assert.equal(q.analysis, ''); }
      checks.push('Commands expose three distinct import routes; questions-only mode imports stems/options without answers/analysis');

      progress('Solutions-only matches source numbers, skips unmatched rows, and protects local answers');
      const original16 = structuredClone(await byId('qa-original-16'));
      const solutionImport = await openImport('导入解析文件');
      assert.equal(await solutionImport.locator('[aria-label="答案解析位置"]').count(), 0, 'Solutions-only import asks about answer placement');
      await loadText(solutionImport, 'solutions.md', solutionsFile);
      const overwrite = solutionImport.getByRole('checkbox', { name: '允许覆盖已有内容', exact: true });
      assert.equal(await overwrite.isChecked(), false);
      await solutionImport.locator('[data-import-number="99"]').waitFor();
      assert.match(await solutionImport.locator('[data-import-number="99"]').innerText(), /未匹配|无对应|找不到/);
      await solutionImport.getByRole('button', { name: '应用 1 道解析', exact: true }).click({ force: true });
      await until(async () => (await byId('qa-original-17')).analysis.includes('两边同时减去'), 'Matched solution did not enter the original question');
      assert.equal((await flat()).length, 4, 'Solutions-only import created questions');
      assert.deepEqual(await byId('qa-original-16'), original16, 'Existing answer/analysis changed without overwrite permission');
      assert.equal((await byId('qa-original-17')).stem, '原有第17题：求 $x+1=3$ 的解。');
      await chooseQuestion('qa-original-17');
      assert.equal(await editor.getByPlaceholder('输入答案…', { exact: true }).inputValue(), '$x=2$');
      assert.match(await editor.getByPlaceholder('写下解题思路…', { exact: true }).inputValue(), /两边同时减去/);
      checks.push('Solutions match importNumber instead of current positions, populate real answer/analysis editors, skip unmatched rows, and do not create or overwrite questions');

      progress('Explicit overwrite updates only imported solution fields and remains undoable');
      const overwriteImport = await openImport('导入解析文件');
      await loadText(overwriteImport, 'overwrite.md', solutionOverwriteFile);
      assert.equal(await overwriteImport.getByRole('button', { name: '应用 0 道解析', exact: true }).isDisabled(), true);
      await overwriteImport.getByRole('checkbox', { name: '允许覆盖已有内容', exact: true }).check({ force: true });
      await overwriteImport.getByRole('button', { name: '应用 1 道解析', exact: true }).click({ force: true });
      await until(async () => (await byId('qa-original-16')).analysis.includes('解析文件按原题号匹配'), 'Explicit solution overwrite was not saved');
      const overwritten16 = await byId('qa-original-16');
      assert.equal(overwritten16.id, original16.id); assert.equal(overwritten16.stem, original16.stem); assert.deepEqual(overwritten16.options, original16.options); assert.equal(overwritten16.score, original16.score);
      assert.deepEqual(overwritten16.answer, ['B']); assert.equal(overwritten16.source, '解析导入来源'); assert.deepEqual(overwritten16.knowledge, ['函数', '代入']); assert.equal(overwritten16.difficulty, 'medium');
      await chooseQuestion('qa-original-16');
      assert.match(await editor.getByPlaceholder('写下解题思路…', { exact: true }).inputValue(), /解析文件按原题号匹配/);
      assert.equal(await editor.getByRole('button', { name: '将 B 设为正确答案', exact: true }).locator('svg').count(), 1);
      assert.equal(await editor.getByRole('textbox', { name: '题目来源', exact: true }).inputValue(), '解析导入来源');
      assert.equal(await editor.getByRole('textbox', { name: '题目知识点', exact: true }).inputValue(), '函数，代入');
      assert.equal(await editor.getByRole('combobox', { name: '题目难度', exact: true }).innerText(), '中等');
      assert.equal(await editor.getByRole('spinbutton', { name: '本题分值', exact: true }).inputValue(), '8');
      await sidebar().getByRole('button', { name: '撤销', exact: true }).click({ force: true });
      await until(async () => (await byId('qa-original-16')).analysis === original16.analysis, 'Solution application did not undo as one operation');
      await sidebar().getByRole('button', { name: '重做', exact: true }).click({ force: true });
      await until(async () => (await byId('qa-original-16')).analysis === overwritten16.analysis, 'Solution application did not redo');
      checks.push('Overwrite requires explicit permission, retains stem/options/ID/score, applies provided metadata, and is one undoable batch');

      progress('Duplicate solution numbers are visible and cannot be silently applied');
      const duplicates = await openImport('导入解析文件');
      await loadText(duplicates, 'duplicate-solutions.md', duplicateSolutionsFile, true);
      assert.match(await duplicates.innerText(), /重复/);
      const duplicateApply = duplicates.getByRole('button', { name: /^应用 \d+ 道解析$/ });
      if (await duplicateApply.count()) assert.equal(await duplicateApply.isDisabled(), true);
      await duplicates.getByRole('button', { name: '取消', exact: true }).click({ force: true });
      checks.push('Duplicate or unmatched source numbers are surfaced before committing instead of being positionally shifted');

      progress('Annotated papers use distinct after-question and end-of-paper paths');
      const after = await openImport('导入解析版试卷');
      const afterPlacement = after.locator('[aria-label="答案解析位置"]');
      await afterPlacement.getByRole('tab', { name: '题后', exact: true }).click({ force: true });
      await loadText(after, 'annotated-after.md', annotatedAfterFile);
      await after.getByRole('button', { name: '导入 2 道题', exact: true }).click({ force: true });
      await until(async () => (await flat()).length === 6, 'After-question annotated paper was not imported');
      assert.deepEqual((await byNumber(31)).answer, ['C']); assert.match((await byNumber(31)).analysis, /题后解析样例/); assert.match((await byNumber(31)).analysis, /\| 项目 \| 值 \|/);
      assert.equal((await byNumber(32)).answer[0], '$x=2$');
      const tail = await openImport('导入解析版试卷');
      await tail.locator('[aria-label="答案解析位置"]').getByRole('tab', { name: '卷尾', exact: true }).click({ force: true });
      await loadText(tail, 'annotated-tail.md', annotatedTailFile);
      await tail.getByRole('button', { name: '导入 2 道题', exact: true }).click({ force: true });
      await until(async () => (await flat()).length === 8, 'End-of-paper annotated paper was not imported');
      assert.equal((await byNumber(41)).type, 'multi'); assert.deepEqual((await byNumber(41)).answer, ['A', 'D']); assert.match((await byNumber(41)).analysis, /卷尾解析样例/);
      assert.deepEqual((await byNumber(42)).answer, ['$2$']); assert.match((await byNumber(42)).analysis, /卷尾版乙解析/);
      assert.doesNotMatch((await byNumber(41)).stem, /参考答案|解析：/);
      checks.push('Only annotated papers show after/end choices; both routes attach each answer and analysis to its own source question');

      progress('Markdown export uses the native .md extension and retains editable content');
      const mdTarget = path.join(output, 'exported-paper.md');
      await app.evaluate((_electron, target) => { globalThis.__workflowSaveTarget = target; }, mdTarget);
      const markdownStarted = Date.now();
      const savesBeforeMarkdown = await app.evaluate(() => globalThis.__workflowSaveCalls.length);
      await command('导出 Markdown');
      await until(async () => (await app.evaluate(() => globalThis.__workflowSaveCalls.length)) > savesBeforeMarkdown && fs.existsSync(mdTarget) && fs.statSync(mdTarget).mtimeMs >= markdownStarted && fs.statSync(mdTarget).size > 100, 'Markdown export was not created');
      const md = fs.readFileSync(mdTarget, 'utf8');
      for (const text of ['原有题干', '导入题目甲', '题后解析样例', '卷尾解析样例', '$f(x)=x$', '| 项目 | 值 |']) assert.ok(md.includes(text), `Markdown lost ${text}`);
      const mdOptions = (await app.evaluate(() => globalThis.__workflowSaveCalls)).at(-1);
      assert.ok(mdOptions.defaultPath.endsWith('.md'), 'Native Markdown save dialog still defaults to .txt');
      assert.ok(mdOptions.filters.some(filter => filter.extensions.includes('md')), 'Native save filter does not allow Markdown');
      files.push(mdTarget); checks.push('Native Markdown export retains question/choice/answer/analysis/math/table content and actually saves with an MD extension');
    } else {
      await ready(); await expandSidebar();
      progress('Ordinary paper excludes answer-card spaces even when questions request full pages');
      const normal = await paperState();
      assert.equal(normal.spaces.length, 0, 'Ordinary paper contains answer-space blocks');
      assert.equal(normal.questionIds.length, 19, 'Ordinary paper lost a question');
      await exportPdf('ordinary-paper.pdf');
      if (!pdfOnly) {
        await chooseQuestion('qa-q17');
        await selectOption('答题卡空间', '半页');
        await until(async () => (await byId('qa-q17')).answerSpace === 'half', 'Card-space change did not persist');
        const unchanged = await paperState();
        assert.equal(unchanged.pages, normal.pages); assert.equal(unchanged.spaces.length, 0);
        snapshots.push({ label: 'ordinary-before-and-after-card-space-change', before: normal, after: unchanged });
        checks.push('Changing a full-page answer-card space to half a page does not change ordinary-paper page count or add any space blocks');
        await switchView('答题卡');
        const halfCard = await cardState();
        assert.equal(halfCard.boxes.find(box => box.number === 17).space, 'half');
        assert.equal(halfCard.boxes.find(box => box.number === 18).space, 'full'); assert.equal(halfCard.boxes.find(box => box.number === 19).space, 'full');
        await selectOption('答题卡空间', '整页');
        await until(async () => (await byId('qa-q17')).answerSpace === 'full', 'Card full-page setting did not persist');
      } else await switchView('答题卡');
      progress('Answer-card questions 17 to 19 retain real full-page spaces');
      const card = await cardState();
      for (const number of [17, 18, 19]) { const box = card.boxes.find(item => item.number === number); assert.ok(box); assert.equal(box.space, 'full'); assert.ok(box.height > 850, `Question ${number} is not a real page-height answer box`); }
      assert.ok(card.pages >= 4, 'Full-page answer-card questions were collapsed');
      await exportPdf('answer-card.pdf'); snapshots.push({ label: 'answer-card-full-pages', ...card });
      checks.push('Answer-card questions 17/18/19 each retain their explicit full-page answer area');

      progress('An explicit integrated-paper mode can follow card spaces without coupling ordinary paper');
      await switchView('题卷');
      await page.keyboard.press('Control+2');
      const integratedTab = page.getByRole('tab', { name: '试题答题一体卷', exact: true });
      await integratedTab.focus(); await integratedTab.press('Enter');
      await until(async () => (await draft()).layout.paperMode === 'integrated', 'Integrated-paper mode did not persist');
      await page.keyboard.press('Control+1');
      const integrated = await paperState();
      assert.ok(integrated.pages > normal.pages, 'Integrated paper did not allocate answer pages');
      for (const id of ['qa-q17', 'qa-q18', 'qa-q19']) assert.ok(integrated.spaces.some(space => space.id === id), `${id} has no integrated answer space`);
      assert.equal(integrated.questionIds.length, 19, 'Integrated paper lost a question');
      await exportPdf('integrated-paper.pdf'); snapshots.push({ label: 'integrated-following-card', ...integrated });
      checks.push('Integrated-paper mode is explicitly selectable and follows full-page card settings while keeping every question');
      if (!pdfOnly) {
        await chooseQuestion('qa-q17');
        await selectOption('卷内答题空间', '四分之一页');
        await until(async () => (await byId('qa-q17')).paperAnswerSpace === 'quarter', 'Independent in-paper space did not persist');
        assert.equal((await byId('qa-q17')).answerSpace, 'full', 'In-paper setting changed the answer-card setting');
        const independent = await paperState();
        assert.ok(independent.spaces.find(space => space.id === 'qa-q17').height < integrated.spaces.find(space => space.id === 'qa-q17').height, 'Independent paper override did not shrink the integrated answer area');
        await switchView('答题卡');
        assert.equal((await cardState()).boxes.find(box => box.number === 17).space, 'full');
        await switchView('题卷');
        await page.keyboard.press('Control+2');
        const normalTab = page.getByRole('tab', { name: '普通试卷', exact: true });
        await normalTab.focus(); await normalTab.press('Enter');
        await until(async () => (await draft()).layout.paperMode === 'questions', 'Ordinary-paper mode did not restore');
        await page.keyboard.press('Control+1');
        const restored = await paperState(); assert.equal(restored.spaces.length, 0); assert.equal(restored.pages, normal.pages);
        checks.push('Independent integrated-paper override never alters card space; returning to ordinary mode restores the original compact page count');
      }
    }
    const cloudRequests = network + await app.evaluate(() => globalThis.__workflowNetwork);
    const modelCalls = await app.evaluate(() => globalThis.__workflowModelCalls);
    assert.equal(cloudRequests, 0); assert.equal(modelCalls, 0); assert.deepEqual(errors, []); assert.equal(timedOut, false);
    const report = { passed: true, phase, packaged, pdfOnly, checks, cloudRequests, modelCalls, pdfExports, errors, snapshots, files, isolatedDraft: true };
    fs.writeFileSync(path.join(output, `workflow-${phase}-${suffix}${pdfOnly ? '-pdf' : ''}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, snapshots: undefined }));
  } catch (error) {
    const report = { passed: false, phase, packaged, stage, error: String(error), checks, errors, snapshots, timedOut, files, pdfExports };
    fs.writeFileSync(path.join(output, `workflow-${phase}-${suffix}${pdfOnly ? '-pdf' : ''}.json`), JSON.stringify(report, null, 2)); console.error(JSON.stringify(report)); throw error;
  } finally {
    clearTimeout(timer);
    if (app) { try { await Promise.race([app.close(), pause(5000).then(() => { try { app.process().kill(); } catch {} })]); } catch {} }
    const resolved = fs.realpathSync(userData);
    if (path.dirname(resolved).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase() && path.basename(resolved).startsWith('juanye-import-workflow-qa-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
