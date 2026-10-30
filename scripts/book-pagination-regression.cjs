/* Isolated rich book pagination: actual bundled Paged.js, local TikZ worker,
 * no PDF write and no user book/key/model. PDF raster QA is a separate gate. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts', 'qa-book-pagination');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const drawing = '\\begin{tikzpicture}\\draw (0,0)--(1,0)--(1,1)--(0,1)--cycle;\\end{tikzpicture}';
const paragraph = value => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });
const prose = '已知函数 $f(x)=x^2-2x+1$，讨论参数变化时函数图像的位置，说明理由并核验端点。';
const book = { version: 1, kind: 'juanye-book', id: 'book-render-qa', title: '教辅分页隔离样例', author: '本机合成数据', settings: { paper: 'B5', marginTop: 17, marginBottom: 17, marginInner: 20, marginOuter: 16, fontFamily: 'SimSun', fontSize: 10.5, lineHeight: 1.65, paragraphGap: 2, questionGap: 3, numbering: 'chapter', answers: 'book', toc: true, pageNumbers: true, header: '', footer: '', chapterNewPage: true }, questions: {
  q1: { id: 'q1', type: 'single', score: 5, stem: '计算 $\\frac{1}{2}+\\frac{1}{3}$。', options: ['$1$', '$\\frac{5}{6}$', '$2$', '$0$'], answer: ['B'], analysis: '通分计算。' },
  q2: { id: 'q2', type: 'essay', score: 15, stem: '观察立体几何图形并证明。', options: [], answer: ['$1$'], analysis: `${prose} ANSWER_LAST_MARKER`, drawing },
 }, chapters: [
  { id: 'cover', title: '封面', kind: 'cover', content: { type: 'doc', content: [paragraph('覆盖公式、长表格、题图、目录与卷尾解析。')] } },
  { id: 'chapter-one', title: '第一章 函数与代数', kind: 'chapter', content: { type: 'doc', content: [{type:'heading',attrs:{level:2},content:[{type:'text',text:'分数与函数值'}]},paragraph('CHAPTER_ONE_START'), { type: 'bookQuestion', attrs: { questionId: 'q1' } }, { type: 'table', content: [
    { type: 'tableRow', content: [{ type: 'tableHeader', content: [paragraph('长表格表头')] }, { type: 'tableHeader', content: [paragraph('概率')] }] },
    ...Array.from({ length: 80 }, (_, index) => ({ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph(`ROW_${String(index + 1).padStart(3, '0')}`)] }, { type: 'tableCell', content: [paragraph('$\\frac{1}{80}$')] }] })),
   ] }, paragraph('CHAPTER_ONE_LAST_MARKER')] } },
  { id: 'chapter-two', title: '第二章 立体几何', kind: 'chapter', content: { type: 'doc', content: [{ type: 'bookQuestion', attrs: { questionId: 'q2' } }, { type: 'image', attrs: { src: png, alt: '合成像素图片', width: 20, align: 'right' } }, ...Array.from({ length: 25 }, (_, index) => paragraph(`${index + 1}. ${prose}`)), paragraph('BOOK_FINAL_MARKER')] } },
 ] };
book.questions.q2.stem += '\n\n' + Array.from({length:40},(_,i)=>`LONG_QUESTION_${i+1} ${prose}`).join('\n\n');
book.questions.q2.analysis += '\n\n' + Array.from({length:35},(_,i)=>`LONG_SOLUTION_${i+1} ${prose}`).join('\n\n');

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-book-pagination-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  fs.mkdirSync(output, { recursive: true });
  let app, report, stage = 'launch';
  const errors = [];
  const watchdog = setTimeout(() => { app?.process().kill(); console.error(`Book pagination timeout: ${stage}`); process.exit(1); }, 150000);
  try {
    app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'], env });
    await app.evaluate(({ BrowserWindow, session, ipcMain }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.setPosition(-16000, -16000); win.showInactive(); win.webContents.setBackgroundThrottling(false);
      globalThis.__bookRequests = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => { globalThis.__bookRequests++; done({ cancel: true }); });
      for (const name of ['model:recognize', 'model:generate', 'exam:analyze']) { ipcMain.removeHandler(name); ipcMain.handle(name, () => { globalThis.__bookRequests++; throw Error('No model calls permitted'); }); }
    });
    const mainPage = await app.firstWindow(); mainPage.on('pageerror', error => errors.push(error.message));
    await mainPage.waitForFunction(() => !!window.juanye);
    stage = 'actual local TikZ compilation';
    const compiled = await mainPage.evaluate(code => window.juanye.renderDrawing(code), drawing); assert.match(compiled.svg, /<svg/);
    stage = 'separate renderer';
    await app.evaluate(async ({ BrowserWindow }, input) => {
      const win = new BrowserWindow({ width: 1200, height: 900, show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
      globalThis.__bookQaRenderer = win; win.setPosition(-16000, -16000); win.showInactive(); win.webContents.setBackgroundThrottling(false);
      await win.loadFile(input.file);
      await win.webContents.executeJavaScript(`window.juanye={renderDrawing:async(code)=>{if(code!==${JSON.stringify(input.code)})throw Error('Unexpected fixture drawing');return ${JSON.stringify(input.compiled)}}};true`);
    }, { file: path.join(root, 'dist/book-renderer.html'), code: drawing, compiled });
    const page = app.windows().find(page => page.url().endsWith('book-renderer.html')); assert.ok(page); page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof window.renderJuanyeBook === 'function');
    stage = 'rich full-book pagination';
    const rendered = await page.evaluate(book => window.renderJuanyeBook(book), book);
    assert.ok(rendered.pages >= 6 && rendered.pages <= 30, JSON.stringify(rendered)); assert.deepEqual(rendered.errors, []);
    const content = await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.pagedjs_page')];
      for (const page of pages) page.style.contentVisibility = 'visible';
      return { pages: pages.length, text: pages.map(page => page.querySelector('.pagedjs_page_content')?.textContent || '').join('\n'), images: [...document.querySelectorAll('.pagedjs_page img')].map(image => ({ ready: image.complete && image.naturalWidth > 0, alt: image.alt })), tablePages: pages.filter(page => page.querySelector('.book-table')).length, tableHeaderCopies: document.querySelectorAll('.pagedjs_page .book-table thead').length, toc: [...document.querySelectorAll('.book-toc a')].map(a => { const target=document.querySelector(a.getAttribute('href'));return { href: a.getAttribute('href'), page: getComputedStyle(a, '::after').content, reset:getComputedStyle(a,'::after').counterReset, targetPage:pages.findIndex(page=>page.contains(target))+1 }; }), margins: pages.slice(0, 3).map(page => ({ header: page.querySelector('.pagedjs_margin-top-center')?.textContent, footer: page.querySelector('.pagedjs_margin-bottom-center')?.textContent })), missingLast: false };
    });
    fs.writeFileSync(path.join(output,'content.json'),JSON.stringify(content,null,2));
    fs.writeFileSync(path.join(output,'page-content.html'),await page.locator('#book-pages').innerHTML());
    assert.equal(content.pages, rendered.pages); assert.ok(content.tablePages >= 2); assert.ok(content.tableHeaderCopies >= 2);
    for (const marker of ['CHAPTER_ONE_START', 'CHAPTER_ONE_LAST_MARKER', 'BOOK_FINAL_MARKER', 'ANSWER_LAST_MARKER']) assert.ok(content.text.includes(marker), `Missing ${marker}`);
    for (let row = 1; row <= 80; row++) assert.ok(content.text.includes(`ROW_${String(row).padStart(3, '0')}`), `Missing table row ${row}`);
    for(let i=1;i<=40;i++)assert.ok(content.text.includes(`LONG_QUESTION_${i} `),`Missing long question segment ${i}`);
    for(let i=1;i<=35;i++)assert.ok(content.text.includes(`LONG_SOLUTION_${i} `),`Missing long solution segment ${i}`);
    assert.ok(await page.locator('.pagedjs_page [data-book-question=q2]').count()>=2,'Oversize questions must continue across real pages');
    assert.ok(content.images.length >= 2 && content.images.every(image => image.ready)); assert.equal(content.toc.length, 4);
    assert.ok(content.toc.every(entry => Number(entry.reset.match(/ (-?\d+)$/)?.[1])===entry.targetPage && entry.targetPage>0), JSON.stringify(content.toc));
    await page.screenshot({ path: path.join(output, 'rich-book-first-pages.png') });
    if(process.argv.includes('--pdf')) {
      const target=path.join(output,'rich-book.pdf');
      await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},target);
      const actual=await mainPage.evaluate(book=>window.juanye.bookExportPdf(book),book);
      assert.equal(actual.canceled,false);assert.equal(actual.pages,rendered.pages);assert.ok(fs.statSync(target).size>10000);
    }
    stage = 'chapter subset';
    const subset = await page.evaluate(book => window.renderJuanyeBook(book, 'chapter-two'), book); assert.deepEqual(subset.errors, []);
    const subsetText = await page.locator('#book-pages').textContent(); assert.ok(subsetText.includes('BOOK_FINAL_MARKER')); assert.ok(!subsetText.includes('CHAPTER_ONE_START')); assert.ok(!subsetText.includes('ANSWER_LAST_MARKER'));
    stage = 'fatal formula preflight';
    const invalid = structuredClone(book); invalid.chapters[2].content.content.push({ type: 'blockMath', attrs: { latex: '\\notARealCommand{a}' } });
    const invalidResult = await page.evaluate(book => window.renderJuanyeBook(book, 'chapter-two'), invalid); assert.ok(invalidResult.errors.some(value => value.includes('公式')));
    assert.equal(await app.evaluate(() => globalThis.__bookRequests), 0); assert.deepEqual(errors, []);
    report = { passed: true, pages: rendered.pages, tablePages: content.tablePages, repeatedTableHeaders: content.tableHeaderCopies, toc: content.toc, images: content.images, warnings: rendered.warnings, checks: ['Actual bundled Paged.js chapter/full flow', '80-row table continuity, repeated headers, last markers', 'Real local TikZ and image decode complete before publication', 'Generated TOC page counters, exact current chapter subset', 'Invalid formula produces fatal preflight errors'], modelCalls: 0, externalRequests: 0, errors };
  } catch (error) { report = { passed: false, stage, error: error.stack || String(error), errors }; process.exitCode = 1; }
  finally {
    clearTimeout(watchdog); await app?.close().catch(() => app.process().kill());
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    const resolved = fs.realpathSync(profile); if (path.dirname(resolved).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase() && path.basename(resolved).startsWith('juanye-book-pagination-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
