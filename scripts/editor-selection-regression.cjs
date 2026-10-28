/* Offline identity/animation regression: isolated 120-question draft only.
 * Source: Motion AnimatePresence/PresenceChild primary sources, MIT.
 * Rapid selection must never leave a stale active editor or cross-write stems.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const output = path.join(root, 'artifacts/qa-editor-selection', packaged ? 'packaged' : 'source');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const stem = index => `本地性能样例第 ${index} 题：已知函数 $f_${index}(x)=x^2+\\sin x$，且 $P(A\\mid B)=\\frac{3}{4}$，下列结论正确的是。分析函数的单调性，并比较各个数值。${index % 8 === 0 ? '\n\n| 类别 | 数量 | 概率 |\n| --- | --- | --- |\n| 甲 | 75 | $\\frac{3}{4}$ |\n| 乙 | 25 | $\\frac{1}{4}$ |' : ''}`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-editor-selection-'));
  const questions = Array.from({ length: 120 }, (_, i) => ({ id: `editor-${i + 1}`, type: 'single', score: 5, stem: stem(i + 1), options: ['$\\frac{\\sqrt{3}}{2}$', '$\\int_0^1 x^2\\,dx=\\frac{1}{3}$', '$\\sin^2 x+\\cos^2 x=1$', '$a_n=2^n-1$'], answer: ['A'], analysis: '' }));
  const draft = { version: 1, exam: { id: 'editor-selection', title: '隔离编辑回归', subtitle: '', duration: 120, notice: [], sections: [{ id: 'section', title: '单项选择题', type: 'single', note: '', questions }] }, layout: { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'none' }, history: [] };
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify(draft));
  fs.mkdirSync(output, { recursive: true });
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page, report, requests = 0;
  const errors = [], checks = [];
  const watchdog = setTimeout(() => { app?.process().kill(); process.exit(1); }, 65000);
  try {
    const flags = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? flags : [root, ...flags], env });
    await app.evaluate(({ BrowserWindow, ipcMain, session }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setPosition(-16000, -16000); win.showInactive();
      globalThis.__editorSelectionRequests = 0;
      globalThis.fetch = () => { globalThis.__editorSelectionRequests++; throw Error('Offline editor QA blocks HTTP'); };
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, done) => { globalThis.__editorSelectionRequests++; done({ cancel: true }); });
      for (const name of ['model:recognize', 'model:test', 'model:generate', 'exam:analyze']) { ipcMain.removeHandler(name); ipcMain.handle(name, () => { globalThis.__editorSelectionRequests++; throw Error('Editor QA must not invoke a model'); }); }
    });
    page = await app.firstWindow(); page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => { requests++; return route.abort('blockedbyclient'); });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const sidebar = page.getByRole('complementary', { name: '试卷目录', exact: true });
    const row = number => sidebar.getByRole('button', { name: `编辑第 ${number} 题`, exact: true });
    const editor = number => page.locator(`.workspace-editor-stage [data-editor-question="editor-${number}"]:not([inert]) textarea[placeholder="输入题干…"]`);
    const ready = async number => {
      await page.waitForFunction(number => {
        const bodies = [...document.querySelectorAll('.workspace-editor-stage [data-editor-question]')];
        return bodies.length === 1 && bodies[0].dataset.editorQuestion === `editor-${number}` && !bodies[0].inert && +getComputedStyle(bodies[0]).opacity > .999 && ['none', 'blur(0px)'].includes(getComputedStyle(bodies[0]).filter);
      }, number);
      assert.equal(await row(number).getAttribute('aria-pressed'), 'true');
    };
    const saved = () => page.evaluate(() => window.juanye.loadDraft());
    const previewReady = async number => {
      try {
        await page.waitForFunction(number => {
          const node = document.querySelector(`.workspace-preview-stage [data-sheet] .p-q[data-qid="editor-${number}"]`), canvas = document.querySelector('.preview-canvas');
          if (!node || !canvas) return false;
          const a = node.getBoundingClientRect(), b = canvas.getBoundingClientRect(); return a.top < b.bottom && a.bottom > b.top;
        }, number);
      } catch (error) {
        console.log('preview-navigation-failure', number, await page.evaluate(number => {
          const c = document.querySelector('.preview-canvas'), q = document.querySelector(`.workspace-preview-stage [data-sheet] .p-q[data-qid="editor-${number}"]`);
          return { scrollTop: c?.scrollTop, canvas: c?.getBoundingClientRect().toJSON(), q: q?.getBoundingClientRect().toJSON(), wrappers: [...c.querySelectorAll('[data-page]')].map(n => ({ page: n.dataset.page, mounted: n.dataset.pageMounted, r: n.getBoundingClientRect().toJSON() })) };
        }, number)); throw error;
      }
    };
    await editor(1).waitFor();
    if (await sidebar.getAttribute('data-sidebar-state') === 'collapsed') await sidebar.getByRole('button', { name: '展开目录面板', exact: true }).click();
    await pause(350); await ready(1);
    await row(2).click(); await pause(80); await row(1).click(); await ready(1);
    assert.equal(await editor(1).inputValue(), stem(1)); checks.push('Rapid q1→q2→q1 selects the latest identity and removes outgoing bodies');
    await row(120).click(); await ready(120); await previewReady(120); await row(1).click(); await ready(1); await previewReady(1);
    checks.push('Last-question and first-question navigation preserve editor identity');

    await editor(1).focus(); await editor(1).press('Control+End'); await editor(1).pressSequentially(' Q1_MARKER');
    await row(2).click(); await editor(2).waitFor();
    // Inspect actual presence during an existing exit animation. Inert old
    // inputs must reject browser focus rather than becoming a second editor.
    const transition = await page.evaluate(() => {
      const bodies = [...document.querySelectorAll('.workspace-editor-stage [data-editor-question]')];
      const old = bodies.find(node => node.dataset.editorQuestion === 'editor-1');
      const input = old?.querySelector('textarea'); input?.focus();
      return { outgoingPresent: !!old, outgoingInert: !!old?.inert, rejectedOldFocus: !input || document.activeElement !== input, bodies: bodies.map(node => ({ id: node.dataset.editorQuestion, inert: node.inert, opacity: +getComputedStyle(node).opacity })) };
    });
    if (transition.outgoingPresent) assert.ok(transition.outgoingInert && transition.rejectedOldFocus);
    await editor(2).focus(); await editor(2).press('Control+End'); await editor(2).pressSequentially(' Q2_MARKER');
    await row(1).click(); await ready(1);
    await page.waitForFunction(async () => {
      const data = await window.juanye.loadDraft(), qs = data.exam.sections[0].questions;
      return qs[0].stem.endsWith(' Q1_MARKER') && qs[1].stem.endsWith(' Q2_MARKER');
    });
    const data = await saved();
    assert.equal(data.exam.sections[0].questions[0].stem, `${stem(1)} Q1_MARKER`);
    assert.equal(data.exam.sections[0].questions[1].stem, `${stem(2)} Q2_MARKER`);
    assert.deepEqual(data.exam.sections[0].questions.slice(2), questions.slice(2));
    checks.push('Typing during entry and switching/blur write only to their own question IDs');
    await page.screenshot({ path: path.join(output, 'editor-settled.png') });
    assert.deepEqual(errors, []); assert.equal(requests + await app.evaluate(() => globalThis.__editorSelectionRequests), 0);
    report = { passed: true, packaged, checks, transition, questions: 120, requests: 0, errors };
  } catch (error) {
    await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    report = { passed: false, packaged, checks, error: error.stack || String(error), errors }; process.exitCode = 1;
  } finally {
    clearTimeout(watchdog); await app?.close().catch(() => app.process().kill());
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    const resolved = fs.realpathSync(profile), temp = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved).toLowerCase() === temp.toLowerCase() && path.basename(resolved).startsWith('juanye-editor-selection-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
