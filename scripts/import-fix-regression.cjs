/* Focused 0.3.1 regression: real local file inputs and editable persisted fields, no OCR. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const actualFile = process.argv.includes('--actual-file') ? process.argv[process.argv.indexOf('--actual-file') + 1] : undefined;
async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-import-fix-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: temp }; delete env.ELECTRON_RUN_AS_NODE;
  const questions = (actualFile ? Array.from({ length: 19 }, (_, i) => i + 1) : [5, 12, 16]).map(n => ({ id: `q${n}`, importNumber: n, type: actualFile ? n <= 8 ? 'single' : n <= 11 ? 'multi' : n <= 14 ? 'blank' : 'essay' : n === 5 ? 'single' : 'blank', score: 5, stem: `原题 ${n}。`, options: n <= 11 ? ['甲', '乙', '丙', '丁'] : [], answer: [], analysis: '' }));
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'full' };
  fs.writeFileSync(path.join(temp, 'draft.json'), JSON.stringify({ version: 1, exam: { title: '导入修复检查', subtitle: '', duration: 90, notice: [], sections: [{ id: 's', type: 'single', title: '题目', note: '', questions }] }, layout, history: [] }));
  let app; const errors = [], checks = [];
  const watchdog = setTimeout(() => { app?.process().kill(); process.exitCode = 1; }, 60000);
  try {
    app = await _electron.launch({ executablePath: packaged ? path.join(root, 'release/win-unpacked/卷页.exe') : path.join(root, 'node_modules/electron/dist/electron.exe'), args: packaged ? [] : [root], env });
    await app.evaluate(({ BrowserWindow, session, ipcMain }) => {
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
      globalThis.__requests = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => { globalThis.__requests++; cb({ cancel: true }); });
      ipcMain.removeHandler('model:recognize'); ipcMain.handle('model:recognize', () => { throw Error('Models forbidden'); });
    });
    const page = await app.firstWindow(); page.setDefaultTimeout(7000);
    page.on('pageerror', e => errors.push(e.message));
    await page.getByPlaceholder('输入题干…', { exact: true }).waitFor();
    async function waitFor(predicate) {
      for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 60)); }
      throw Error('Timed out waiting for imported fields');
    }
    await waitFor(async () => await page.getByPlaceholder('输入题干…', { exact: true }).inputValue() === `原题 ${actualFile ? 1 : 5}。`);
    const read = () => page.evaluate(async () => (await window.juanye.loadDraft()).exam.sections.flatMap(s => s.questions));
    async function open(command) {
      await page.keyboard.press('Control+k'); const palette = page.getByRole('dialog');
      await palette.getByPlaceholder('搜索题目、执行命令…').fill(command);
      await palette.getByText(command, { exact: true }).click();
      return page.getByRole('dialog', { name: command, exact: true });
    }
    if (actualFile) {
      const dialog = await open('导入解析文件');
      await dialog.locator('[data-import-file]').setInputFiles(actualFile);
      await dialog.getByRole('button', { name: '应用 19 道解析', exact: true }).click();
      await waitFor(async () => (await read()).every(q => q.answer.length && q.analysis.length));
      const imported = await read(); assert.equal(imported.length, 19);
      const keys = ['A','B','B','C','C','C','B','B','ACD','ABD','ABC'];
      imported.forEach((q, i) => {
        assert.equal(q.stem, `原题 ${i + 1}。`);
        assert.ok(q.answer.length && q.analysis.trim().length > 30, `Missing editable fields for ${i + 1}`);
        assert.ok(!q.answer.join('').includes('方法：'), `Method leaked into answer ${i + 1}`);
        assert.ok(!q.answer.join('').includes('**'), `Dangling emphasis in answer ${i + 1}`);
        if (i < keys.length) assert.equal(q.answer.join(''), keys[i]);
      });
      assert.deepEqual(imported[11].answer, ['$a_n=2^n-1$']);
      assert.deepEqual(imported[12].answer, ['$(3\\ln2,+\\infty)$']);
      assert.deepEqual(imported[13].answer, ['$\\sqrt7$']);
      assert.ok(imported[15].analysis.includes('| $X$ |'));
      assert.ok(!imported[18].analysis.includes('题目依据：'));
      const sidebar = page.getByRole('complementary', { name: '试卷目录', exact: true });
      if (await sidebar.getAttribute('data-sidebar-state') !== 'expanded') await sidebar.getByRole('button', { name: '展开目录面板', exact: true }).click();
      const target = sidebar.getByRole('button', { name: '编辑第 16 题', exact: true });
      await target.focus(); await page.keyboard.press('Enter');
      const analysis = page.getByPlaceholder('写下解题思路…', { exact: true });
      await waitFor(async () => (await analysis.inputValue()).includes('独立性检验'));
      const value = await analysis.inputValue(); await analysis.fill(`${value}\n用户核对标记。`);
      await waitFor(async () => (await read())[15].analysis.endsWith('用户核对标记。'));
      const preview = page.locator('.workspace-preview-stage');
      await waitFor(async () => await preview.locator('[data-pagination-ready="true"]').count() === 1);
      const formulaErrors = await preview.locator('.katex-error').allTextContents();
      assert.deepEqual(formulaErrors, [], 'Actual imported mathematics has rendering errors');
      const cells = await preview.locator('.p-quick-value').evaluateAll(elements => elements.map(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth })));
      assert.equal(cells.length, 14); assert.ok(cells.every(cell => cell.scrollWidth <= cell.width + 1));
      assert.ok(await preview.locator('table.math-table').count() > 0, 'Question 16 distribution table missing from preview');
      assert.equal(await app.evaluate(() => globalThis.__requests), 0); assert.deepEqual(errors, []);
      const report = { passed: true, packaged, file: path.basename(actualFile), questionCount: 19, everyAnswerEditable: true, everyAnalysisEditable: true, stemChanges: 0, quickAnswerCells: cells.length, formulaErrors, cloudRequests: 0, modelCalls: 0, errors };
      fs.mkdirSync(path.join(root, 'artifacts/qa-import-fix'), { recursive: true });
      fs.writeFileSync(path.join(root, `artifacts/qa-import-fix/actual-${packaged ? 'packaged' : 'source'}.json`), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report)); return;
    }
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    const p = text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const cell = lines => `<w:tc>${lines.map(p).join('')}</w:tc>`;
    zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr>${cell(['5. 【答案】C。方法：根据题意求值。', '再计算 $P(A|B)$。'])}${cell(['12. 【答案】$2$', '【解析】根据表格读取。'])}</w:tr></w:tbl></w:body></w:document>`);
    const docx = await zip.generateAsync({ type: 'nodebuffer' });
    const solutions = await open('导入解析文件');
    await solutions.locator('[data-import-file]').setInputFiles({ name: '教辅布局.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx });
    await solutions.getByRole('button', { name: '应用 2 道解析', exact: true }).click();
    await waitFor(async () => (await read()).find(q => q.id === 'q5').analysis.includes('P(A|B)'));
    let imported = await read();
    assert.equal(imported.length, 3); assert.equal(imported[0].stem, '原题 5。');
    assert.deepEqual(imported[0].answer, ['C']); assert.ok(!imported[0].analysis.includes('\\|'));
    assert.deepEqual(imported[1].answer, ['$2$']); assert.equal(imported[1].analysis, '根据表格读取。');
    const analysis = page.getByPlaceholder('写下解题思路…', { exact: true });
    assert.match(await analysis.inputValue(), /根据题意/);
    await analysis.fill('用户编辑后的解析 $P(A|B)$。');
    await waitFor(async () => (await read())[0].analysis === '用户编辑后的解析 $P(A|B)$。');
    checks.push('Word multi-column solution layout becomes answers and analyses in existing editable questions, with no new questions or altered stems');
    const gbk = await open('导入解析文件');
    const bytes = Buffer.from([0x31,0x36,0x2e,0x20,0xb4,0xf0,0xb0,0xb8,0xa3,0xba,0x32,0x0a,0xbd,0xe2,0xce,0xf6,0xa3,0xba,0x41]);
    await gbk.locator('[data-import-file]').setInputFiles({ name: 'Windows答案.txt', mimeType: 'text/plain', buffer: bytes });
    await gbk.getByRole('button', { name: '应用 1 道解析', exact: true }).click();
    await waitFor(async () => (await read()).find(q => q.id === 'q16').analysis === 'A');
    assert.equal(await page.getByPlaceholder('输入答案…', { exact: true }).inputValue(), '2');
    assert.equal(await analysis.inputValue(), 'A');
    await page.getByPlaceholder('输入答案…', { exact: true }).fill('$3$');
    await waitFor(async () => (await read()).find(q => q.id === 'q16').answer[0] === '$3$');
    checks.push('GBK text imports without mojibake; answer and analysis are editable and changes persist');
    const annotated = await open('导入解析版试卷');
    const source = '21. 选择正确结论。\nA. 甲 B. 乙 C. 丙 D. 丁\n【答案】B【详解】第二项成立。';
    await annotated.locator('[data-import-file]').setInputFiles({ name: 'UTF16试卷.txt', mimeType: 'text/plain', buffer: Buffer.concat([Buffer.from([0xff,0xfe]), Buffer.from(source, 'utf16le')]) });
    await annotated.getByRole('button', { name: '导入 1 道题', exact: true }).click();
    await waitFor(async () => (await read()).some(q => q.importNumber === 21));
    imported = await read(); const q21 = imported.find(q => q.importNumber === 21);
    assert.equal(q21.stem, '选择正确结论。'); assert.deepEqual(q21.options, ['甲','乙','丙','丁']); assert.deepEqual(q21.answer, ['B']); assert.equal(q21.analysis, '第二项成立。');
    await waitFor(async () => await analysis.inputValue() === '第二项成立。');
    checks.push('UTF-16 annotated paper splits stem/options/answer/analysis into their actual editor fields');
    assert.deepEqual(errors, []); assert.equal(await app.evaluate(() => globalThis.__requests), 0);
    const report = { passed: true, packaged, checks, cloudRequests: 0, modelCalls: 0, errors };
    fs.mkdirSync(path.join(root, 'artifacts/qa-import-fix'), { recursive: true });
    fs.writeFileSync(path.join(root, `artifacts/qa-import-fix/fields-${packaged ? 'packaged' : 'source'}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    clearTimeout(watchdog); if (app) await app.close().catch(() => app.process().kill());
    const resolved = fs.realpathSync(temp);
    if (path.dirname(resolved).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase() && path.basename(resolved).startsWith('juanye-import-fix-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
