/* Isolated desktop QA. Synthetic exam, clipboard and local OCR stub; no cloud or real user data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const output = path.join(root, 'artifacts/qa-v020');
const cube = String.raw`\begin{tikzpicture}[line join=round,scale=2]
\coordinate (A) at (0,0);\coordinate (B) at (1,0);\coordinate (C) at (1,1);\coordinate (D) at (0,1);
\coordinate (E) at (0.4,0.4);\coordinate (F) at (1.4,0.4);\coordinate (G) at (1.4,1.4);\coordinate (H) at (0.4,1.4);
\draw[dashed] (A)--(E)--(F) (E)--(H);\draw (A)--(B)--(C)--(D)--cycle;
\draw (B)--(F)--(G)--(H)--(D);\draw (C)--(G);\end{tikzpicture}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message, timeout = 12000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await pause(60); } throw new Error(message); }
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-parity-qa-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const triangle = createCanvas(300, 220), context = triangle.getContext('2d');
  context.fillStyle = 'white'; context.fillRect(0, 0, 300, 220); context.strokeStyle = '#111'; context.lineWidth = 2;
  context.beginPath(); context.moveTo(30, 175); context.lineTo(145, 35); context.lineTo(270, 175); context.closePath(); context.stroke();
  context.fillStyle = '#111'; context.font = 'italic 20px serif'; context.fillText('A', 136, 26); context.fillText('B', 12, 195); context.fillText('C', 272, 195);
  const image = triangle.toDataURL('image/png');
  const sections = [
    { id: 's1', title: '单项选择题', type: 'single', note: '', questions: [] },
    { id: 's2', title: '多项选择题', type: 'multi', note: '', questions: [] },
    { id: 's3', title: '填空题', type: 'blank', note: '', questions: [] },
    { id: 's4', title: '解答题', type: 'essay', note: '', questions: [] },
  ];
  for (let n = 1; n <= 19; n++) {
    const section = sections[n <= 8 ? 0 : n <= 11 ? 1 : n <= 14 ? 2 : 3];
    section.questions.push({ id: `q${n}`, type: section.type, score: n >= 15 ? 12 : 5,
      stem: n === 1 ? '如图，在 $\\triangle ABC$ 中，已知 $AB=AC$，$\\angle A=60^\\circ$，则 $\\angle B$ 的大小为' : n === 19 ? '如图为正方体的示意图，棱长为 $a$。\n(1) 写出与平面 $ABCD$ 平行的平面；\n(2) 求该正方体的体积，并说明理由。' : n >= 15 ? '已知函数 $f(x)=x^2-2x$。\n(1) 求函数 $f(x)$ 的最小值；\n(2) 求不等式 $f(x)\\le 0$ 的解集。' : n >= 12 ? '若 $x+1=3$，则 $x=$______。' : '已知集合 $A=\\{1,2,3\\}$，则下列结论正确的是',
      options: n <= 11 ? ['$30^\\circ$', '$45^\\circ$', '$60^\\circ$', '$90^\\circ$'] : [],
      answer: n <= 11 ? ['C'] : n <= 14 ? ['$2$'] : ['$V=a^3$'], analysis: n >= 15 ? '由题设条件进行计算。' : '',
      ...(n === 1 ? { sourceImage: image, figures: [{ id: 'triangle', src: image, caption: '第 1 题图', layout: 'right' }] } : {}), ...(n === 19 ? { drawing: cube } : {}),
    });
  }
  fs.writeFileSync(path.join(userData, 'draft.json'), JSON.stringify({ version: 1, exam: { title: '数学试卷 · 排版示例', subtitle: '卷页', duration: 120, notice: ['请填写姓名和考号。', '解答题须写出必要的演算步骤。'], sections }, layout: { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: true, answerSpace: true, questionGap: 1.8, optionGap: 0.8, figureWidth: 30, figureGap: 3, answerMode: 'full', quickAnswers: true }, history: [] }));
  let app, stage = 'launch'; const errors = [], checks = []; let network = 0;
  const progress = value => { stage = value; console.log(JSON.stringify({ progress: stage })); };
  const timer = setTimeout(() => { console.error(`QA timeout at ${stage}`); app?.process().kill(); process.exitCode = 1; }, 150000);
  try {
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? [] : [root], env, timeout: 25000 });
    const page = await app.firstWindow(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await page.route(/^https?:\/\//, route => { network++; return route.abort(); });
    await app.evaluate(({ session, ipcMain }) => {
      globalThis.__parityNetwork = 0; globalThis.__parityRecognitions = [];
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { globalThis.__parityNetwork++; callback({ cancel: true }); });
      ipcMain.removeHandler('model:get'); ipcMain.handle('model:get', () => ({ hasKey: true, model: 'local-fixture', baseUrl: 'http://127.0.0.1' }));
      ipcMain.removeHandler('model:recognize'); ipcMain.handle('model:recognize', (_event, options) => { globalThis.__parityRecognitions.push(options.image); return JSON.stringify({ questions: [{ type: 'essay', stem: `本地模拟识别 ${globalThis.__parityRecognitions.length} $x+1=2$`, options: [], score: 12, answer: [], analysis: '' }] }); });
    });
    await page.waitForSelector('textarea');
    await page.evaluate(() => { localStorage.setItem('juanye.appearance.v1', 'telegram'); localStorage.setItem('juanye.sidebar-expanded.v1', 'true'); });
    await page.reload(); await page.waitForSelector('textarea');
    const sidebar = () => page.getByRole('complementary', { name: '试卷目录', exact: true });
    const draft = () => page.evaluate(() => window.juanye.loadDraft());
    progress('rapid clipboard queue');
    await page.getByRole('button', { name: '打开图片识别', exact: true }).click();
    const ocr = page.getByRole('dialog'); await ocr.getByText('识别题目', { exact: true }).waitFor();
    await page.evaluate(() => {
      for (let i = 1; i <= 3; i++) {
        const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80; const ctx = canvas.getContext('2d'); ctx.fillStyle = ['#f55', '#5a5', '#55f'][i - 1]; ctx.fillRect(0, 0, 120, 80);
        const raw = atob(canvas.toDataURL('image/png').split(',')[1]); const file = new File([Uint8Array.from(raw, c => c.charCodeAt(0))], `paste-${i}.png`, { type: 'image/png' });
        const transfer = new DataTransfer(); transfer.items.add(file); window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, cancelable: true }));
      }
    });
    const pageThumbnails = () => ocr.getByRole('button', { name: /^查看第 \d+ 页$/ });
    await until(async () => await pageThumbnails().count() === 3, 'Rapid paste lost pages');
    assert.deepEqual(await pageThumbnails().evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))), ['查看第 1 页', '查看第 2 页', '查看第 3 页']);
    await ocr.getByRole('button', { name: '开始识别', exact: true }).click();
    await until(async () => (await ocr.getByRole('button', { name: '添加 3 道题到试卷', exact: true }).isEnabled()), 'Stub OCR did not finish');
    await page.evaluate(() => { const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNGcAAAAASUVORK5CYII='), c => c.charCodeAt(0))], 'paste-4.png', { type: 'image/png' })); window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, cancelable: true })); });
    await until(async () => await pageThumbnails().count() === 4, 'Append after recognition lost queue');
    assert.equal(await ocr.getByRole('checkbox', { name: '选择此题', exact: true }).count(), 3);
    await ocr.getByRole('button', { name: '继续识别 1 页', exact: true }).click();
    await until(async () => await ocr.getByRole('button', { name: '添加 4 道题到试卷', exact: true }).isEnabled(), 'New page did not finish');
    assert.equal(await app.evaluate(() => globalThis.__parityRecognitions.length), 4, 'Successful pages were requested twice');
    await ocr.getByRole('button', { name: '删除第 2 页', exact: true }).click();
    assert.equal(await ocr.getByRole('checkbox', { name: '选择此题', exact: true }).count(), 3);
    await ocr.getByRole('button', { name: '关闭', exact: true }).click(); await pause(300);
    checks.push('Sequential and rapid Ctrl+V append; successful pages preserved; only new page requested; deletion keeps selection consistent');
    progress('structure and batch');
    await sidebar().getByRole('button', { name: '管理大题', exact: true }).click();
    const structure = page.getByRole('dialog', { name: '管理大题', exact: true });
    await structure.getByRole('combobox', { name: '新增大题题型', exact: true }).click();
    await page.getByRole('option', { name: '判断题', exact: true }).click();
    await structure.getByLabel('新增大题名称', { exact: true }).fill('判断测试');
    await structure.getByRole('button', { name: '添加大题', exact: true }).click();
    await structure.getByRole('button', { name: '关闭管理大题', exact: true }).click();
    await sidebar().getByRole('button', { name: '新建题目', exact: true }).click();
    await until(async () => (await draft())?.exam.sections.find(s => s.type === 'judge')?.questions.length === 1, 'New question did not target created section');
    assert.deepEqual((await draft()).exam.sections.find(s => s.type === 'judge').questions[0].options, ['正确', '错误']);
    await sidebar().getByRole('button', { name: '批量编辑', exact: true }).click();
    const batch = page.getByRole('dialog', { name: /批量属性/ });
    await batch.getByRole('checkbox', { name: '全选', exact: true }).click();
    await batch.getByLabel('批量统一分值', { exact: true }).fill('7');
    await batch.getByRole('button', { name: '应用', exact: true }).first().click();
    await until(async () => (await draft()).exam.sections.flatMap(s => s.questions).every(q => q.score === 7), 'Batch score failed');
    await batch.getByRole('button', { name: '完成', exact: true }).click();
    await sidebar().getByRole('button', { name: '撤销', exact: true }).click();
    await until(async () => (await draft()).exam.sections[0].questions[0].score === 5, 'Undo failed');
    await sidebar().getByRole('button', { name: '重做', exact: true }).click();
    await until(async () => (await draft()).exam.sections[0].questions[0].score === 7, 'Redo failed');
    checks.push('Seven types; created section/new question; batch score; structural undo/redo');
    progress('figures and formulas');
    await sidebar().locator('[data-question-id="q1"]').getByRole('button', { name: '编辑第 1 题', exact: true }).click();
    await page.waitForSelector('[data-editor-figure="triangle"]');
    const figureInput = page.locator('input[type=file][accept="image/png,image/jpeg,image/webp"]');
    const upload = [{ name: 'extra1.png', mimeType: 'image/png', buffer: triangle.toBuffer('image/png') }, { name: 'extra2.png', mimeType: 'image/png', buffer: triangle.toBuffer('image/png') }];
    await figureInput.setInputFiles(upload);
    await until(async () => await page.locator('[data-editor-figure]').count() === 3, 'Multiple figures replaced old image');
    await page.getByRole('button', { name: '删除题图 3', exact: true }).click();
    await page.getByRole('button', { name: '删除题图 2', exact: true }).click();
    await page.getByRole('button', { name: '打开公式编辑器', exact: true }).first().click();
    const formula = page.getByRole('dialog'); await formula.getByLabel('公式代码', { exact: true }).fill(String.raw`\frac{1}{2}`);
    await formula.getByRole('button', { name: '插入公式', exact: true }).click();
    await until(async () => (await draft()).exam.sections[0].questions[0].stem.includes(String.raw`$\frac{1}{2}$`), 'Formula insertion lost delimiters');
    await pause(350);
    const geometry = await page.locator('[data-sheet] [data-qid="q1"]').first().evaluate(el => { const a = el.getBoundingClientRect(), b = el.querySelector('.p-figures-right').getBoundingClientRect(); return { question: { x: a.x, y: a.y, width: a.width, height: a.height }, figure: { x: b.x, y: b.y, width: b.width, height: b.height }, float: getComputedStyle(el.querySelector('.p-figures-right')).float }; });
    assert.equal(geometry.float, 'right'); assert.ok(geometry.figure.x > geometry.question.x + geometry.question.width * 0.55);
    const beforeRetry = (await draft()).exam.sections[0].questions[0].stem;
    await page.getByRole('button', { name: '重新识别', exact: true }).click();
    const comparison = page.getByRole('dialog');
    await comparison.getByText('识别核对', { exact: true }).waitFor();
    assert.equal((await draft()).exam.sections[0].questions[0].stem, beforeRetry, 'Re-recognition overwrote the local edit before confirmation');
    await comparison.getByRole('button', { name: '应用识别结果', exact: true }).click();
    await until(async () => (await draft()).exam.sections[0].questions[0].stem.startsWith('本地模拟识别 5'), 'Confirmed single-question re-recognition failed');
    await sidebar().getByRole('button', { name: '撤销', exact: true }).click();
    await until(async () => (await draft()).exam.sections[0].questions[0].stem === beforeRetry, 'Re-recognition could not be undone');
    checks.push('Multi-image append without loss; editable formula insertion; figure right-float geometry');
    checks.push('Single-question re-recognition preserves edits until confirmed and supports undo');
    progress('offline TikZ and PDFs');
    await until(async () => await page.locator('[data-sheet] [data-qid="q19"] [data-drawing-status="ready"]').count() > 0, 'User cube failed to render');
    assert.equal(await page.locator('[data-sheet] [data-drawing-status="error"]').count(), 0);
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, path.join(output, 'math-with-right-figures.pdf'));
    const paperExportStarted = Date.now();
    await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
    await until(() => fs.existsSync(path.join(output, 'math-with-right-figures.pdf')) && fs.statSync(path.join(output, 'math-with-right-figures.pdf')).mtimeMs >= paperExportStarted, 'Question PDF missing', 25000);
    await page.getByText('PDF 已导出', { exact: true }).waitFor();
    await page.getByRole('tab', { name: '答题卡', exact: true }).click();
    await page.waitForSelector('[data-answer-number="19"][data-answer-space="full"]');
    for (const number of [17, 18, 19]) assert.ok(await page.locator(`[data-sheet] [data-answer-number="${number}"][data-answer-space="full"]`).count());
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, path.join(output, 'answer-card.pdf'));
    const cardExportStarted = Date.now();
    await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
    await until(() => fs.existsSync(path.join(output, 'answer-card.pdf')) && fs.statSync(path.join(output, 'answer-card.pdf')).mtimeMs >= cardExportStarted, 'Answer card PDF missing', 20000);
    for (const file of ['math-with-right-figures.pdf', 'answer-card.pdf']) assert.equal(fs.readFileSync(path.join(output, file)).subarray(0, 4).toString(), '%PDF');
    await page.getByRole('tab', { name: '题卷', exact: true }).click();
    await page.getByRole('tab', { name: '排版预览', exact: true }).click(); await pause(1200);
    await page.screenshot({ path: path.join(output, 'desktop-parity.png') });
    checks.push('Actual offline user TikZ cube; preview and printed PDFs; answers at tail; answer-card questions 17–19 each one full page');
    assert.deepEqual(errors, []);
    assert.equal(network + await app.evaluate(() => globalThis.__parityNetwork), 0);
    const report = { passed: true, packaged, checks, errors, geometry, cloudRequests: 0, stubOcrRequests: await app.evaluate(() => globalThis.__parityRecognitions.length) };
    fs.writeFileSync(path.join(output, `results-${packaged ? 'packaged' : 'source'}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) { console.error(JSON.stringify({ passed: false, stage, message: String(error) })); throw error; }
  finally {
    clearTimeout(timer); if (app) await app.close();
    const verified = fs.realpathSync(userData);
    if (path.dirname(verified).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase() && path.basename(verified).startsWith('juanye-parity-qa-')) fs.rmSync(verified, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
