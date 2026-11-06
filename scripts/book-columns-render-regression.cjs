/* Actual isolated Electron/Paged.js integration. --no-pdf runs geometry only.
 * No ordinary app windows, stores, model IPC, network, or real user profiles. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'artifacts/qa-book-columns');
const p = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
function fixture() {
  const questions = {};
  const nodes = [];
  for (let i = 1; i <= 36; i++) {
    const id = `choice-${i}`;
    questions[id] = { id, type: 'single', score: 5, stem: `COLUMN_Q_${i} 已知函数 $f(x)=x^2-2x$，求 $f(1)$。${'根据条件分析函数的性质，并选择正确结果。'.repeat(4)}`, options: ['$-1$', '$0$', '$1$', '$2$'], answer: ['A'], analysis: `SOLUTION_${i} 代入得到 $f(1)=-1$。` };
    nodes.push({ type: 'bookQuestion', attrs: { questionId: id } });
  }
  const table = { type: 'table', content: Array.from({ length: 55 }, (_, i) => ({ type: 'tableRow', content: ['表格序号', `ROW_${i}`].map(text => ({ type: i ? 'tableCell' : 'tableHeader', content: [p(text)] })) })) };
  return { version: 2, kind: 'juanye-book', id: 'columns-qa', title: '分栏题册排版验收', author: '合成测试', questions,
    settings: { paper: 'B5', marginTop: 17, marginBottom: 17, marginInner: 20, marginOuter: 16, fontFamily: 'SimSun,serif', fontSize: 10.5, lineHeight: 1.65, paragraphGap: 2, questionGap: 3, numbering: 'book', answers: 'book', toc: false, pageNumbers: true, header: '分栏验收', footer: '', chapterNewPage: true, optionColumns: 'auto' },
    chapters: [{ id: 'one', kind: 'chapter', title: '第一章 混合版式', content: { type: 'doc', content: [
      p('FULL_BEFORE 本段讲解保持通栏，下面练习切换双栏。'),
      { type: 'columnSet', attrs: { count: 2, gap: 6, rule: true }, content: nodes },
      p('FULL_AFTER 双栏练习结束，恢复通栏。'),
      { type: 'columnSet', attrs: { count: 2, gap: 6, rule: false }, content: [p('BREAK_LEFT'), { type: 'columnBreak' }, p('BREAK_RIGHT'), { type: 'columnBreak' }, p('BREAK_NEXT_LEFT'), { type: 'pageBreak' }, p('BREAK_PAGE_LEFT')] },
      { type: 'columnSet', attrs: { count: 3, gap: 2, rule: true }, content: [p('THREE_TIGHT_A'), { type: 'columnBreak' }, p('THREE_TIGHT_B'), { type: 'columnBreak' }, p('THREE_TIGHT_C')] },
      { type: 'columnSet', attrs: { count: 3, gap: 20, rule: true }, content: [p('THREE_WIDE_A'), { type: 'columnBreak' }, p('THREE_WIDE_B'), { type: 'columnBreak' }, p('THREE_WIDE_C')] },
      { type: 'columnSet', attrs: { count: 2, gap: 6, rule: false }, content: [table, p('LONG_START ' + '重复段落测试中文续栏的完整性。'.repeat(180) + ' LONG_END'), { type: 'heading', attrs: { level: 2, columnSpan: 'all' }, content: [{ type: 'text', text: 'SPAN_TITLE 跨栏标题' }] }, p('AFTER_SPAN 后续双栏内容。')] },
    ] } }],
  };
}
function areasFixture() {
  const book = fixture(); book.questions = {}; book.id = 'areas-qa'; book.title = '作答区与块样式验收';
  book.settings.answers = 'none';
  book.styles = [{ id: 'custom-example', name: '自定义例题', title: '典型例题', background: '#f8f4ea', borderColor: '#886633', borderWidth: .3, titleBackground: '#e9dfc7', icon: 'pen', counter: { format: '例{章}.{n}', reset: 'chapter', start: 1 } }];
  const area = (kind, unit, size) => ({ type: 'answerArea', attrs: { kind, unit, size, lineHeight: 7, gridSize: 5 } });
  const callout = value => ({ type: 'callout', attrs: { styleId: 'custom-example' }, content: [p(value)] });
  book.chapters = [{ id: 'area-one', kind: 'chapter', title: '第一章 作答空间', content: { type: 'doc', content: [callout('CUSTOM_FIRST 自定义标题条、图标、底色及编号。'), p('空白区：20 毫米'), area('blank', 'mm', 20), p('横线区：5 行，每行 7 毫米'), area('lines', 'lines', 5),
    { type: 'columnSet', attrs: { count: 2, gap: 6, rule: true }, content: [p('方格区：30 毫米'), area('grid', 'mm', 30), { type: 'columnBreak' }, p('坐标区：40 毫米'), area('coordinate', 'mm', 40)] }, callout('CUSTOM_SECOND 同章继续编号。')] } },
    { id: 'area-two', kind: 'chapter', title: '第二章 编号重置', content: { type: 'doc', content: [callout('CUSTOM_RESET 新章从 1 重置。')] } }];
  return book;
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-columns-qa-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [path.join(__dirname, 'book-columns-host.cjs'), path.join(root, 'dist/book-renderer.html')], env });
  let report;
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => typeof window.renderJuanyeBook === 'function', undefined, { timeout: 15000 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    if (process.argv.includes('--capacity')) {
      const rows = [];
      const chapterCount = process.argv.includes('--capacity-small') ? 4 : 40;
      for (const count of [1, 2]) {
        const book = fixture(); book.questions = {}; book.chapters = []; book.settings.answers = 'none';
        for (let chapter = 1; chapter <= chapterCount; chapter++) {
          const content = [];
          for (let local = 1; local <= 25; local++) {
            const number = (chapter - 1) * 25 + local, id = `capacity-${number}`;
            book.questions[id] = { id, type: 'single', score: 5,
              stem: `CAPACITY_${number} 已知函数 $f(x)=x^2-2x$，求 $f(1)$。${'根据条件分析函数的性质，并选择正确结果。'.repeat(2)}`,
              options: ['$-1$', '$0$', '$1$', '$2$'], answer: ['A'], analysis: '代入得到 $f(1)=-1$。' };
            content.push({ type: 'bookQuestion', attrs: { questionId: id } });
          }
          book.chapters.push({ id: `capacity-chapter-${chapter}`, kind: 'chapter', title: `第${chapter}章 练习`, content: { type: 'doc', content: [p('CAPACITY_PREFACE 通栏讲解后接练习，检查完整编号与跨页续排。'),
            ...(count === 1 ? content : [{ type: 'columnSet', attrs: { count: 2, gap: 6, rule: true }, content }])] } });
        }
        const started = Date.now();
        const timeout = setTimeout(() => app.process().kill(), 165000);
        try {
          const result = await page.evaluate(book => window.renderJuanyeBook(book), book);
          const elapsedMs = Date.now() - started;
          assert.deepEqual(result.errors, [], JSON.stringify(result));
          const data = await page.evaluate(() => ({ questions: [...document.querySelectorAll('.pagedjs_page_content [data-book-question]')].map(el => el.dataset.bookQuestion),
            columns: document.querySelectorAll('.pagedjs_page_content .book-column-row').length,
            passes: Number(document.body.dataset.bookColumnPasses || 0), timings: JSON.parse(document.body.dataset.bookColumnTimings || '[]') }));
          assert.deepEqual(data.questions, Array.from({ length: chapterCount * 25 }, (_, i) => `capacity-${i + 1}`));
          rows.push({ columns: count, elapsedMs, pages: result.pages, questionCount: data.questions.length, columnRows: data.columns, passes: data.passes, timings: data.timings, errors: result.errors });
          console.log(JSON.stringify({ capacity: rows.at(-1) }));
        } finally { clearTimeout(timeout); }
      }
      assert.deepEqual(errors, []);
      report = { passed: true, fixture: `${chapterCount * 25} questions / ${chapterCount} chapters / 25 per chapter; identical text; B5; no answers; sequential same-process runs, one per layout`, measurements: rows, caveat: 'Wall-clock native Electron render/pagination time, not UI FPS, no warmup/repetition confidence interval or speedup guarantee.' };
      fs.writeFileSync(path.join(output, chapterCount === 4 ? 'capacity-small.json' : 'capacity.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report)); return;
    }
    const book = fixture();
    const result = await page.evaluate(book => window.renderJuanyeBook(book), book);
    assert.deepEqual(result.errors, [], JSON.stringify(result));
    const geometry = await page.evaluate(() => {
      const content = [...document.querySelectorAll('.pagedjs_page_content')];
      const locate = token => {
        const node = [...document.querySelectorAll('.pagedjs_page_content [data-book-text-run]')].find(el => el.textContent.includes(token));
        return node ? { page: content.indexOf(node.closest('.pagedjs_page_content')), column: node.closest('.book-column-cell')?.dataset.columnIndex, width: node.getBoundingClientRect().width } : null;
      };
      return { questionPages: [...new Set([...document.querySelectorAll('[data-book-question]')].map(el => content.indexOf(el.closest('.pagedjs_page_content'))))],
        markers: Object.fromEntries(['FULL_BEFORE', 'COLUMN_Q_1 ', 'FULL_AFTER', 'BREAK_LEFT', 'BREAK_RIGHT', 'BREAK_NEXT_LEFT', 'BREAK_PAGE_LEFT', 'THREE_TIGHT_A', 'THREE_TIGHT_B', 'THREE_TIGHT_C', 'THREE_WIDE_A', 'THREE_WIDE_C', 'SPAN_TITLE', 'AFTER_SPAN', 'LONG_END'].map(token => [token, locate(token)])),
        questions: [...document.querySelectorAll('.pagedjs_page_content [data-book-question]')].map(el => el.dataset.bookQuestion),
        rows: document.querySelectorAll('.book-column-row').length, repeatedHeaders: document.querySelectorAll('[data-book-repeated-header]').length,
        overflow: [...document.querySelectorAll('.book-column-cell')].filter(el => { const p = el.closest('.pagedjs_page_content')?.getBoundingClientRect(); const r = el.getBoundingClientRect(); return p && (r.right > p.right + 2 || r.bottom > p.bottom + 2); }).length };
    });
    assert.equal(geometry.overflow, 0, JSON.stringify(geometry));
    assert.equal(geometry.questions.length, 36); assert.deepEqual(geometry.questions, Array.from({ length: 36 }, (_, i) => `choice-${i + 1}`));
    assert.ok(geometry.questionPages.length >= 3);
    const m = geometry.markers;
    for (const value of Object.values(m)) assert.ok(value, JSON.stringify(m));
    assert.equal(m.BREAK_LEFT.column, '1'); assert.equal(m.BREAK_RIGHT.column, '2');
    assert.equal(m.BREAK_NEXT_LEFT.column, '1'); assert.ok(m.BREAK_NEXT_LEFT.page > m.BREAK_RIGHT.page);
    assert.equal(m.BREAK_PAGE_LEFT.column, '1'); assert.ok(m.BREAK_PAGE_LEFT.page > m.BREAK_NEXT_LEFT.page);
    assert.deepEqual([m.THREE_TIGHT_A.column, m.THREE_TIGHT_B.column, m.THREE_TIGHT_C.column], ['1', '2', '3']);
    assert.equal(m['COLUMN_Q_1 '].page, m.FULL_BEFORE.page, 'First double-column row should reclaim space below full-width explanation');
    assert.ok(geometry.repeatedHeaders >= 1);
    if (!process.argv.includes('--no-pdf')) {
      const pdf = await app.evaluate(({ BrowserWindow }, setting) => BrowserWindow.getAllWindows()[0].webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: { width: 176 / 25.4, height: 250 / 25.4 }, margins: { top: 0, bottom: 0, left: 0, right: 0 } }), book.settings);
      fs.writeFileSync(path.join(output, 'columns.pdf'), Buffer.from(pdf));
    }
    const areas = await page.evaluate(book => window.renderJuanyeBook(book), areasFixture());
    assert.deepEqual(areas.errors, []);
    const areaGeometry = await page.evaluate(() => ({
      areas: [...document.querySelectorAll('.pagedjs_page_content .book-answer-area')].map(el => ({ kind: el.dataset.answerKind, mm: Number(el.dataset.answerHeightMm), actualMm: el.getBoundingClientRect().height / (96 / 25.4) / Number(getComputedStyle(document.querySelector('.pagedjs_pages')).zoom || 1) })),
      labels: [...document.querySelectorAll('.pagedjs_page_content .book-callout-title')].map(el => el.textContent),
    }));
    assert.deepEqual(areaGeometry.areas.map(value => value.kind), ['blank', 'lines', 'grid', 'coordinate']);
    assert.deepEqual(areaGeometry.areas.map(value => value.mm), [20, 35, 30, 40]);
    for (const area of areaGeometry.areas) assert.ok(Math.abs(area.mm - area.actualMm) < 1, JSON.stringify(area));
    assert.ok(areaGeometry.labels[0].includes('例1.1')); assert.ok(areaGeometry.labels[1].includes('例1.2')); assert.ok(areaGeometry.labels[2].includes('例2.1'));
    if (!process.argv.includes('--no-pdf')) {
      const pdf = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: { width: 176 / 25.4, height: 250 / 25.4 }, margins: { top: 0, bottom: 0, left: 0, right: 0 } }));
      fs.writeFileSync(path.join(output, 'styles-areas.pdf'), Buffer.from(pdf));
    }
    const narrow = areasFixture();
    Object.assign(narrow.settings, { paper: 'A5', marginInner: 45, marginOuter: 45 });
    narrow.chapters = [{ id: 'narrow', kind: 'chapter', title: '窄栏预检', content: { type: 'doc', content: [
      { type: 'columnSet', attrs: { count: 3, gap: 20, rule: true }, content: [p('不应打印到过窄的栏内。')] },
    ] } }];
    await assert.rejects(page.evaluate(value => window.renderJuanyeBook(value), narrow), /不足20毫米/);
    assert.deepEqual(errors, []);
    report = { passed: true, result, geometry, areas, areaGeometry, narrowColumnsRejected: true, errors }; console.log(JSON.stringify(report));
  } catch (error) { report = { passed: false, error: error.stack }; console.error(error); process.exitCode = 1; }
  finally { fs.writeFileSync(path.join(output, process.argv.includes('--capacity') ? process.argv.includes('--capacity-small') ? 'capacity-small.json' : 'capacity.json' : 'report.json'), JSON.stringify(report, null, 2)); await app.close(); const resolved = fs.realpathSync(profile); assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); assert.ok(path.basename(resolved).startsWith('juanye-columns-qa-')); fs.rmSync(resolved, { recursive: true, force: true }); }
}
module.exports = { fixture };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
