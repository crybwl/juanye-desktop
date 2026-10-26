/* Focused print-layout QA, isolated synthetic draft; no model calls or user files. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const screenshots = process.argv.includes('--screenshots');
// Caller runs the artifact-operation marker before requesting PDF artifacts.
const exportPdf = process.argv.includes('--pdf');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-columns-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const long = '已知函数 $f(x)=x^2-2x+1$，讨论参数变化时函数图像的位置。说明理由并写出必要的计算过程。';
  const questions = Array.from({ length: 19 }, (_, index) => ({ id: `q${index + 1}`, type: index < 12 ? 'single' : index < 15 ? 'blank' : 'essay', score: index < 15 ? 5 : 15,
    stem: index < 15 ? `${long}\n\n${long}\n\n| 自变量 | 函数值 |\n| --- | --- |\n| $2$ | $1$ |` : `${long}\n\n（1）${long}\n\n（2）${long}\n\n（3）${long}`,
    options: index < 12 ? ['$-1$', '$0$', '$1$', '$2$'] : [], answer: index < 12 ? ['C'] : ['$1$'], analysis: long.repeat(3), pageBreakBefore: index === 10 }));
  const exam = { title: '数学双栏印卷校对', subtitle: 'A3与8K排版', duration: 120, notice: ['请在密封线内填写个人信息。'], sections: [{ id: 's1', type: 'single', title: '单项选择题', note: '', questions: questions.slice(0,12) }, { id: 's2', type: 'blank', title: '填空题', note: '', questions: questions.slice(12,15) }, { id: 's3', type: 'essay', title: '解答题', note: '', questions: questions.slice(15) }] };
  const layout = { style: 'real', density: 'compact', paper: 'A3', orientation: 'landscape', margin: 11, fontSize: 10.5, lineHeight: 1.5, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: true, answerSpace: false, paperMode: 'questions', answerMode: 'full', columns: 2, columnGap: 8, sealLine: true, sealWidth: 18 };
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  const out = path.join(root, 'artifacts/qa-paper-columns'); fs.mkdirSync(out, { recursive: true });
  const checks = [], errors = [], captures = [], pdfs = []; let app;
  const watchdog = setTimeout(() => { try { app?.process().kill(); } catch {} process.exitCode = 1; }, 100000);
  try {
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? [] : [root], env });
    await app.evaluate(({ BrowserWindow, ipcMain, session }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.setSize(1700, 1000); win.setPosition(-16000, -16000); win.webContents.setBackgroundThrottling(false); win.showInactive();
      globalThis.__columnRequests = 0; globalThis.__columnModels = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*','https://*/*'] }, (_, cb) => { globalThis.__columnRequests++; cb({ cancel: true }); });
      ipcMain.removeHandler('model:recognize'); ipcMain.handle('model:recognize', () => { globalThis.__columnModels++; throw Error('No model during layout QA'); });
    });
    const page = await app.firstWindow(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    await page.getByPlaceholder('输入题干…', { exact: true }).waitFor();
    await page.keyboard.press('Control+2');
    const preview = page.locator('.workspace-preview-stage');
    const ready = async () => { await preview.locator('[data-pagination-ready="true"]').waitFor(); await pause(250); };
    const inspect = async (name, width, height) => {
      await ready();
      const state = await preview.evaluate((stage) => {
        const sheets = [...stage.querySelectorAll('[data-sheet]')];
        return { sheets: sheets.length, width: sheets[0].offsetWidth, height: sheets[0].offsetHeight,
          seals: stage.querySelectorAll('[data-seal-line]').length,
          columns: sheets.map(sheet => [...sheet.querySelectorAll('[data-paper-column]')].map(column => ({ width: column.offsetWidth, scrollWidth: column.scrollWidth, height: column.offsetHeight, scrollHeight: column.scrollHeight }))),
          ids: [...new Set(sheets.flatMap(sheet => [...sheet.querySelectorAll('.p-q[data-qid]')].map(el => el.dataset.qid)))],
          forcedPage: stage.querySelector('.p-q[data-qid="q11"]')?.closest('[data-paper-column]')?.dataset.paperColumn,
          overlap: sheets.some(sheet => { const seal = sheet.querySelector('[data-seal-line]'); const body = sheet.querySelector('[data-paper-columns]'); return seal.getBoundingClientRect().right >= body.getBoundingClientRect().left; }),
          mathErrors: stage.querySelectorAll('.katex-error').length,
        };
      });
      assert.ok(Math.abs(state.width - width * 96/25.4) <= 1, `${name} physical width`);
      assert.ok(Math.abs(state.height - height * 96/25.4) <= 1, `${name} physical height`);
      assert.ok(state.sheets > 1); assert.equal(state.seals, state.sheets); assert.equal(state.overlap, false);
      assert.equal(state.forcedPage, '1', 'Explicit page break must start on the next physical page, not the right column');
      assert.deepEqual(state.ids, questions.map(q => q.id)); assert.equal(state.mathErrors, 0);
      for (const columns of state.columns) { assert.equal(columns.length, 2); for (const column of columns) { assert.ok(column.scrollWidth <= column.width + 2, `${name} horizontal column overflow: ${JSON.stringify(state)}`); assert.ok(column.scrollHeight <= column.height + 2, `${name} vertical column overflow: ${JSON.stringify(state)}`); } }
      checks.push({ name, ...state });
      if (screenshots) { const target = path.join(out, `${name}-${packaged ? 'packaged' : 'source'}.png`); const data = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64')); fs.writeFileSync(target, Buffer.from(data,'base64')); captures.push(target); }
      if (exportPdf) {
        const target = path.join(out, `${name}-${packaged ? 'packaged' : 'source'}.pdf`);
        await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, target);
        const previous = fs.existsSync(target) ? fs.statSync(target).mtimeMs : 0;
        await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline && (!fs.existsSync(target) || fs.statSync(target).mtimeMs <= previous)) await pause(100);
        assert.ok(fs.existsSync(target) && fs.statSync(target).mtimeMs > previous, `${name} app PDF export did not finish`);
        assert.ok(fs.statSync(target).size > 1000, `${name} PDF is empty`);
        pdfs.push({ path: target, bytes: fs.statSync(target).size, expectedWidthMm: width, expectedHeightMm: height, expectedPages: state.sheets });
      }
    };
    await inspect('A3', 420, 297);
    await page.getByRole('button', { name: '8K 横版印卷', exact: true }).click(); await inspect('8K', 390, 270);
    await preview.getByRole('tab', { name: '答题卡', exact: true }).click(); await ready();
    const card = await preview.evaluate(stage => { const sheets=[...stage.querySelectorAll('[data-sheet]')]; return { count:sheets.length, seals:stage.querySelectorAll('[data-seal-line]').length, full:[17,18,19].map(n => { const el=stage.querySelector(`[data-answer-number="${n}"]`); const sheet=el?.closest('[data-sheet]'); return {number:n, height:el?.offsetHeight, page:sheet?sheets.indexOf(sheet):-1, standalone:sheet?.querySelectorAll('[data-answer-number]').length}; }) }; });
    assert.equal(card.count, card.seals); assert.equal(new Set(card.full.map(item => item.page)).size, 3);
    for (const item of card.full) { assert.ok(item.height > 800); assert.equal(item.standalone, 1); }
    checks.push({ name:'physical-full-answer-pages', ...card });
    assert.deepEqual(errors, []);
    const requests = await app.evaluate(() => ({ cloudRequests:globalThis.__columnRequests, modelCalls:globalThis.__columnModels })); assert.deepEqual(requests,{cloudRequests:0,modelCalls:0});
    const report = {passed:true,packaged,checks,captures,pdfs,errors,...requests}; fs.writeFileSync(path.join(out,`results-${packaged?'packaged':'source'}.json`),JSON.stringify(report,null,2)); console.log(JSON.stringify({passed:true,packaged,checks:checks.map(c=>({name:c.name,pages:c.sheets??c.count})),captures,pdfs,errors,...requests}));
  } finally {
    clearTimeout(watchdog); if (app) await app.close().catch(()=>app.process().kill());
    const target=fs.realpathSync(profile); if(path.dirname(target).toLowerCase()===fs.realpathSync(os.tmpdir()).toLowerCase() && path.basename(target).startsWith('juanye-columns-'))fs.rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
