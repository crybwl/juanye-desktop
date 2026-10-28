/* Native Chromium drag -> real local bank IPC. Isolated synthetic data only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..'), packaged = process.argv.includes('--packaged');
const output = path.join(root, 'artifacts', 'qa-collection-drop', packaged ? 'packaged' : 'source');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { const deadline = Date.now() + 12000; while (Date.now() < deadline) { if (await check()) return; await pause(50); } throw Error(label); }

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-folder-drop-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const question = id => ({ id, type: 'single', score: 5, stem: `收藏夹隔离样题 ${id}：$1+1=$`, options: ['$2$', '$3$'], answer: ['A'], analysis: '相加得 $2$。' });
  const exam = { id: 'folder-drop-paper', title: '不可修改的隔离试卷', subtitle: '', duration: 90, notice: [], sections: [{ id: 's1', type: 'single', title: '单选题', note: '', questions: [question('original')] }] };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'none' };
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  let app, page, stage = 'launch', report;
  const errors = [], checks = [];
  const watchdog = setTimeout(() => { app?.process().kill(); console.error(`Folder drop timeout at ${stage}`); process.exit(1); }, 120000);
  const progress = value => { stage = value; console.log(JSON.stringify({ progress: value, packaged })); };
  try {
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? [] : [root], env });
    await app.evaluate(({ BrowserWindow, session, ipcMain }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1280, 900); win.webContents.setBackgroundThrottling(false); win.setPosition(-16000, -16000); win.showInactive();
      globalThis.__folderRequests = { http: 0, model: 0 };
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => { globalThis.__folderRequests.http++; cb({ cancel: true }); });
      ipcMain.removeHandler('model:recognize'); ipcMain.handle('model:recognize', () => { globalThis.__folderRequests.model++; throw Error('No model calls allowed'); });
    });
    page = await app.firstWindow(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    await page.getByPlaceholder('输入题干…', { exact: true }).waitFor();
    const initial = await page.evaluate(async questions => {
      await window.juanye.bankSave({ questions, origin: { examTitle: '隔离题库' } });
      for (const collection of [{ id: 'folder-a', name: '函数' }, { id: 'folder-b', name: '几何目标' }, { id: 'folder-nested', name: '子收藏夹', parentId: 'folder-b' }]) await window.juanye.bankManage({ action: 'collection-save', collection });
      return window.juanye.bankLoad();
    }, [question('one'), question('two')]);
    const nav = name => page.getByRole('navigation', { name: '工作区', exact: true }).getByRole('button', { name, exact: true });
    await nav('本地题库').click(); await page.getByTestId('bank-entry').first().waitFor(); await pause(600);
    const bank = page.getByTestId('bank-workspace'), sidebar = bank.locator('.bank-library-sidebar');
    const load = () => page.evaluate(() => window.juanye.bankLoad());
    const settled = () => until(async () => await bank.getByTestId('bank-question-list').getAttribute('aria-busy') === 'false', 'Bank did not settle');
    const row = id => bank.locator(`[data-bank-entry="${id}"]`);
    const [one, two] = initial.entries;
    await page.evaluate(() => { window.__folderNativeDrags = []; window.__folderDragTrace = []; for (const name of ['dragstart','dragenter','dragover','drop','dragend']) document.addEventListener(name, event => { window.__folderDragTrace.push({ name, x: event.clientX, y: event.clientY, card: event.target.closest('[data-bank-entry]')?.dataset.bankEntry, folder: event.target.closest('[data-collection-id]')?.dataset.collectionId, target: event.target.className, prevented: event.defaultPrevented }); if(window.__folderDragTrace.length>180) window.__folderDragTrace.shift(); if(name==='dragstart') window.__folderNativeDrags.push({ trusted: event.isTrusted, types: [...event.dataTransfer.types] }); }, false); });
    async function nativeDrop(id, folder) {
      await settled();
      const source = row(id).locator('.bank-entry-stem'); await source.scrollIntoViewIfNeeded();
      await source.hover(); await pause(350);
      const box = await source.boundingBox(); assert.ok(box);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 + 8, { steps: 6 });
      await until(async () => await sidebar.getAttribute('data-expanded') === 'true', 'Native drag did not reveal folder targets');
      const target = bank.locator(`[data-collection-id="${folder}"]`); const destination = await target.boundingBox(); assert.ok(destination);
      await page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height / 2, { steps: 15 });
      await page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height / 2);
      await until(async () => await target.getAttribute('data-drop') === 'true', 'Native folder target did not highlight');
      await page.screenshot({ path: path.join(output, 'native-folder-target.png') });
      await page.mouse.up(); await settled();
    }
    progress('native single question drop persists without content revision');
    await nativeDrop(one.id, 'folder-a');
    await until(async () => (await load()).entries.find(item => item.id === one.id).collectionIds.includes('folder-a'), 'Single native drop did not save');
    let stored = await load(); assert.equal(stored.entries.length, 2); assert.deepEqual(stored.entries.find(item => item.id === one.id).question, one.question);
    checks.push('Trusted native single drag auto-expands rail, highlights folder and persists real IPC without editing content');

    progress('native selected group drop appends nested folder memberships');
    for (const entry of [one, two]) { await row(entry.id).hover(); await row(entry.id).getByRole('checkbox').click(); }
    await nativeDrop(one.id, 'folder-nested');
    await until(async () => (await load()).entries.every(item => item.collectionIds.includes('folder-nested')), 'Selected group was not assigned atomically');
    stored = await load(); assert.ok(stored.entries.find(item => item.id === one.id).collectionIds.includes('folder-a'));
    assert.equal(stored.entries.length, 2); assert.ok(stored.entries.every(item => item.version === 1 && item.usageCount === 0));
    const revision = stored.revision;
    await nativeDrop(one.id, 'folder-nested'); await pause(250); assert.equal((await load()).revision, revision, 'Duplicate drop should not create another write');
    checks.push('Selected group enters nested folder; other memberships, history, usage and paper remain unchanged; duplicate drop is idempotent');

    progress('invalid and unrelated native payloads cannot partially write');
    await sidebar.hover();
    const malformed = await bank.locator('[data-collection-id="folder-b"]').evaluate(target => {
      const transfer = new DataTransfer(); transfer.setData('application/x-juanye-bank-id', '["missing-question"]');
      const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }); target.dispatchEvent(event); return event.defaultPrevented;
    });
    assert.equal(malformed, true); await pause(200); assert.equal((await load()).revision, revision);
    const unrelated = await bank.locator('[data-collection-id="folder-b"]').evaluate(target => { const transfer = new DataTransfer(); transfer.setData('text/plain', 'not a bank drag'); const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }); target.dispatchEvent(event); return event.defaultPrevented; });
    assert.equal(unrelated, false); assert.equal((await load()).revision, revision);
    const drags = await page.evaluate(() => window.__folderNativeDrags); assert.ok(drags.length >= 3 && drags.every(item => item.trusted && item.types.includes('application/x-juanye-bank-id')), 'Folder path did not exercise trusted Chromium drags');
    assert.deepEqual((await page.evaluate(() => window.juanye.loadDraft())).exam, exam);
    await page.reload(); await page.locator('.workspace-editor-stage [data-editor-question]:not([inert])').getByPlaceholder('输入题干…', { exact: true }).waitFor(); await nav('本地题库').click(); await page.getByTestId('bank-entry').first().waitFor();
    assert.deepEqual((await load()).entries.map(item => item.collectionIds), stored.entries.map(item => item.collectionIds));
    checks.push('Malformed/foreign payloads make no write; memberships survive reload; current paper is unchanged');
    assert.deepEqual(errors, []); const requests = await app.evaluate(() => globalThis.__folderRequests); assert.deepEqual(requests, { http: 0, model: 0 });
    report = { passed: true, packaged, checks, nativeDrags: drags.length, requests, errors }; console.log(JSON.stringify(report));
  } catch (error) { await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); const trace = await page?.evaluate(() => window.__folderDragTrace).catch(() => []); report = { passed: false, packaged, stage, error: error.stack || String(error), checks, errors, trace }; console.error(JSON.stringify(report)); process.exitCode = 1; }
  finally { clearTimeout(watchdog); if (app) await app.close().catch(() => app.process().kill()); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); const resolved = fs.realpathSync(profile); if (path.dirname(resolved).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase() && path.basename(resolved).startsWith('juanye-folder-drop-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
