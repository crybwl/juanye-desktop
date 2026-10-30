/* Real main-process PDF lock/cancel/error safety. Isolated synthetic data only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { initialBook, stressBook } = require('./book-workspace-regression.cjs');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const output = path.join(root, 'artifacts/qa-book-pdf-safety', packaged ? 'packaged' : 'source');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-book-pdf-safety-'));
const target = path.join(profile, 'protected-export.pdf');
const sentinel = Buffer.from('Existing document must survive a cancelled or failed export.');
const env = { ...process.env, JUANYE_TEST_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  let app, page, stage = 'launch', report;
  const checks = [];
  const watchdog = setTimeout(() => { app?.process().kill(); console.error(`PDF safety timed out: ${stage}`); process.exit(1); }, 120000);
  const until = async (predicate, message) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { if (await predicate()) return; await pause(50); }
    throw Error(message);
  };
  try {
    fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(target, sentinel);
    const flags = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? flags : [root, ...flags], env });
    await app.evaluate(({ BrowserWindow, dialog, session }) => {
      const main = BrowserWindow.getAllWindows()[0]; main.setPosition(-16000, -16000); main.showInactive();
      globalThis.__bookHttpCalls = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, done) => { globalThis.__bookHttpCalls++; done({ cancel: true }); });
      dialog.showSaveDialog = () => new Promise(resolve => { globalThis.__bookSaveGate = resolve; });
    });
    page = await app.firstWindow(); await page.waitForFunction(() => !!window.juanye?.bookExportPdf);
    stage = 'save-dialog lock and cancellation';
    await page.evaluate(book => { window.__pendingBookPdf = window.juanye.bookExportPdf(book).then(result => ({ result }), error => ({ error: error.message })); }, initialBook());
    await until(() => app.evaluate(() => typeof globalThis.__bookSaveGate === 'function'), 'Save dialog did not open');
    const duplicate = await page.evaluate(book => window.juanye.bookExportPdf(book).then(() => '', error => error.message), initialBook());
    assert.match(duplicate, /仍在导出/);
    await page.evaluate(() => window.juanye.bookCancelPdf());
    await app.evaluate((_electron, target) => { globalThis.__bookSaveGate({ canceled: false, filePath: target }); delete globalThis.__bookSaveGate; }, target);
    assert.deepEqual(await page.evaluate(() => window.__pendingBookPdf), { result: { canceled: true } });
    assert.deepEqual(fs.readFileSync(target), sentinel);
    checks.push('Job lock starts before native save dialog; cancel while dialog is open preserves existing destination');

    stage = 'cancel active pagination';
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, target);
    await page.evaluate(book => { window.__pendingBookPdf = window.juanye.bookExportPdf(book).then(result => ({ result }), error => ({ error: error.message })); }, stressBook());
    await until(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => win.webContents.getURL().endsWith('book-renderer.html'))), 'Dedicated render window did not load');
    await page.evaluate(() => window.juanye.bookCancelPdf());
    assert.deepEqual(await page.evaluate(() => window.__pendingBookPdf), { result: { canceled: true } });
    assert.deepEqual(fs.readFileSync(target), sentinel);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    checks.push('Cancelling active long-book pagination destroys only its renderer and leaves old PDF bytes intact');

    stage = 'invalid formula cannot overwrite existing PDF';
    const invalid = initialBook(); invalid.chapters[1].content.content.push({ type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: '\\JuanyeUnsupportedCommand{x}' } }] });
    const failure = await page.evaluate(book => window.juanye.bookExportPdf(book).then(() => '', error => error.message), invalid);
    assert.match(failure, /修复书稿/); assert.deepEqual(fs.readFileSync(target), sentinel);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    checks.push('Fatal formula errors reject export before destination write, clean renderer and release job lock');

    stage = 'retry after failure';
    const result = await page.evaluate(book => window.juanye.bookExportPdf(book), initialBook());
    assert.equal(result.canceled, false); assert.ok(result.pages > 0);
    assert.equal(fs.readFileSync(target).subarray(0, 5).toString(), '%PDF-');
    assert.deepEqual(fs.readdirSync(profile).filter(name => name.endsWith('.tmp')), []);
    assert.equal(await app.evaluate(() => globalThis.__bookHttpCalls), 0);
    checks.push('A subsequent real PDF succeeds; no temp-file leaks or HTTP requests');
    report = { passed: true, packaged, checks, externalRequests: 0 }; console.log(JSON.stringify(report));
  } catch (error) { report = { passed: false, packaged, stage, checks, error: error.stack || String(error) }; console.error(JSON.stringify(report)); process.exitCode = 1; }
  finally {
    clearTimeout(watchdog); await app?.close().catch(() => app.process().kill());
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    const resolved = fs.realpathSync(profile);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); assert.ok(path.basename(resolved).startsWith('juanye-book-pdf-safety-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
