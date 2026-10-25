/* Local document-reader integration: in-memory DOCX/JSON fixtures, no network or model calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-document-reader-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: temp }; delete env.ELECTRON_RUN_AS_NODE;
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'none' };
  fs.writeFileSync(path.join(temp, 'draft.json'), JSON.stringify({ version: 1, exam: { title: '文件读取检查', subtitle: '', duration: 90, notice: [], sections: [{ id: 's', type: 'essay', title: '解答题', note: '', questions: [{ id: 'seed', type: 'essay', score: 12, stem: '原题。', options: [], answer: [], analysis: '' }] }] }, layout, history: [] }));
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const p = text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const cell = text => `<w:tc>${p(text)}</w:tc>`;
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p('30.（15 分）已知下表，求样本合计。')}<w:tbl><w:tr>${cell('类别')}${cell('数值')}</w:tr><w:tr>${cell('甲')}${cell('$75$')}</w:tr></w:tbl>${p('答案：$75$')}${p('解析：根据表格读取。')}${p('知识点：统计，样本')}</w:body></w:document>`);
  const docx = await zip.generateAsync({ type: 'nodebuffer' });
  let app, network = 0;
  const checks = [], errors = [];
  const watchdog = setTimeout(() => { app?.process().kill(); process.exitCode = 1; }, 60000);
  try {
    app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root], env });
    await app.evaluate(({ BrowserWindow, session, ipcMain }) => {
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
      globalThis.__documentRequests = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { globalThis.__documentRequests++; callback({ cancel: true }); });
      ipcMain.removeHandler('model:recognize'); ipcMain.handle('model:recognize', () => { throw new Error('No models allowed'); });
    });
    const page = await app.firstWindow(); page.setDefaultTimeout(7000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => { network++; return route.abort(); });
    await page.getByPlaceholder('输入题干…', { exact: true }).waitFor();
    const readQuestion = async number => {
      const deadline = Date.now() + 9000;
      while (Date.now() < deadline) {
        const found = await page.evaluate(async number => (await window.juanye.loadDraft()).exam.sections.flatMap(s => s.questions).find(q => q.importNumber === number), number);
        if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 80));
      }
      throw new Error(`Imported question ${number} missing: ${JSON.stringify(await page.evaluate(() => window.juanye.loadDraft()))}`);
    };
    for (let i = 0; i < 100 && await page.getByPlaceholder('输入题干…', { exact: true }).inputValue() !== '原题。'; i++) await new Promise(resolve => setTimeout(resolve, 50));
    async function open() {
      await page.keyboard.press('Control+k'); const palette = page.getByRole('dialog');
      await palette.getByPlaceholder('搜索题目、执行命令…').fill('导入解析版试卷');
      await palette.getByText('导入解析版试卷', { exact: true }).click();
      return page.getByRole('dialog', { name: '导入解析版试卷', exact: true });
    }
    const imported = await open();
    await imported.locator('[data-import-file]').setInputFiles({ name: 'fixture.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx });
    await imported.getByRole('button', { name: '导入 1 道题', exact: true }).click();
    const q = await readQuestion(30);
    assert.match(q.stem, /\| 类别 \| 数值 \|/); assert.match(q.stem, /\| 甲 \| \$75\$ \|/);
    assert.deepEqual(q.answer, ['$75$']); assert.equal(q.analysis, '根据表格读取。'); assert.deepEqual(q.knowledge, ['统计', '样本']); assert.equal(q.score, 15);
    await page.locator('.workspace-editor-stage .math-table').waitFor();
    checks.push('DOCX goes through the real file input, preserves a table and math, and populates editor answer/analysis/metadata');
    const json = await open();
    const source = { questions: [{ number: 40, type: 'blank', score: 7, stem: '依次填写。', options: [], answer: ['$1$', '$2$'], analysis: '两空分别填写。', difficulty: 'hard', source: '测试来源', knowledge: ['统计'], answerSpace: 'full', paperAnswerSpace: 'quarter', pageBreakBefore: true }] };
    await json.locator('[data-import-file]').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
    await json.getByRole('button', { name: '导入 1 道题', exact: true }).click();
    const q40 = await readQuestion(40);
    await page.getByPlaceholder('输入第 2 项答案…', { exact: true }).waitFor();
    assert.equal(await page.getByPlaceholder('输入答案…', { exact: true }).inputValue(), '$1$');
    assert.equal(await page.getByPlaceholder('输入第 2 项答案…', { exact: true }).inputValue(), '$2$');
    assert.equal(q40.paperAnswerSpace, 'quarter'); assert.equal(q40.answerSpace, 'full'); assert.equal(q40.pageBreakBefore, true); assert.equal(q40.difficulty, 'hard');
    checks.push('JSON metadata and multiple independent answers populate the existing editor without losing either answer');
    assert.equal(network + await app.evaluate(() => globalThis.__documentRequests), 0); assert.deepEqual(errors, []);
    const report = { passed: true, checks, errors, cloudRequests: 0, modelCalls: 0 };
    const out = path.join(root, 'artifacts/qa-import-workflow'); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'document-readers.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally {
    clearTimeout(watchdog); if (app) await app.close().catch(() => app.process().kill());
    const resolved = fs.realpathSync(temp);
    if (path.dirname(resolved).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase() && path.basename(resolved).startsWith('juanye-document-reader-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
