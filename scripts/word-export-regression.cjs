/* Run after a current build. Isolated application profile; no network, model or
 * user documents. --keep retains QA DOCX files for a real Word/LibreOffice
 * renderer; this structural regression does NOT claim visual Word layout QA. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const { createCanvas } = require('@napi-rs/canvas');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');

function fixture() {
  const canvas = createCanvas(240, 150), context = canvas.getContext('2d');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, 240, 150); context.strokeStyle = '#222222'; context.lineWidth = 2;
  const points = [[35, 115], [150, 115], [195, 65], [80, 65], [35, 45], [150, 45], [195, 10], [80, 10]];
  for (const [a, b] of [[0,1], [1,2], [2,3], [3,0], [0,4], [1,5], [2,6], [3,7], [4,5], [5,6], [6,7], [7,4]]) { context.beginPath(); context.moveTo(...points[a]); context.lineTo(...points[b]); context.stroke(); }
  context.fillStyle = '#222222'; context.font = '14px serif'; for (const [index, point] of points.entries()) context.fillText('ABCDEFGH'[index], point[0] - 12, point[1] + 4);
  return { title: '高三数学模拟试卷', subtitle: '数学', duration: 120, notice: ['请在密封线内填写学校、班级、姓名和考号。'], sections: [
    { id: 's1', title: '选择题', type: 'single', note: '每小题 5 分，每题仅有一个选项符合题意。', questions: [
      { id: 'q1', type: 'single', score: 5, stem: String.raw`已知 $z=1+2i$，则 $|z|=$（　　）。`, options: ['$1$', '$2$', '$\\sqrt{5}$', '$5$'], answer: ['C'], analysis: String.raw`由复数模长定义，$|z|=\sqrt{1^2+2^2}=\sqrt{5}$。` },
      { id: 'q2', type: 'single', score: 5, stem: String.raw`已知 $a_n=\frac{n+1}{n}$，则 $\sum_{n=1}^{3}a_n=$（　　）。`, options: ['$3$', '$\\frac{29}{6}$', '$5$', '$6$'], answer: ['B'], analysis: String.raw`所求为 $2+\frac{3}{2}+\frac{4}{3}=\frac{29}{6}$。` },
    ] },
    { id: 's2', title: '填空题', type: 'blank', note: '将答案填写在横线上。', questions: [
      { id: 'q3', type: 'blank', score: 5, stem: String.raw`计算 $\int_0^1 x^2\,dx=$______。`, options: [], answer: [String.raw`$\frac{1}{3}$`], analysis: String.raw`由牛顿莱布尼茨公式得 $\left.\frac{x^3}{3}\right|_0^1=\frac{1}{3}$。` },
    ] },
    { id: 's3', title: '解答题', type: 'essay', note: '写出必要的计算过程。', questions: [
      { id: 'q4', type: 'essay', score: 15, stem: '某校调查学生睡眠与注意力情况，得到下表。\n\n| 类别 | 注意力集中 | 注意力不集中 | 合计 |\n| --- | --- | --- | --- |\n| 睡眠充足 | $75$ | $25$ | $100$ |\n| 睡眠不足 | $50$ | $50$ | $100$ |\n| 合计 | $125$ | $75$ | $200$ |\n\n（1）计算样本中注意力集中的频率；\n（2）求睡眠充足条件下注意力集中的概率。', options: [], answer: [String.raw`$\frac{5}{8}$；$\frac{3}{4}$`], analysis: String.raw`（1）频率为 $\frac{125}{200}=\frac{5}{8}$。` + '\n' + String.raw`（2）条件概率为 $P(\text{集中}\mid\text{充足})=\frac{75}{100}=\frac{3}{4}$。` },
      { id: 'q5', type: 'essay', score: 15, stem: '如图，在长方体 $ABCD-EFGH$ 中，求证平面 $ABFE$ 与平面 $CDHG$ 平行。', figures: [{ id: 'fig', src: canvas.toDataURL('image/png'), layout: 'right', width: 35, caption: '长方体示意图' }], options: [], answer: ['平面 $ABFE$ 与平面 $CDHG$ 平行。'], analysis: '因为 $AB\\parallel CD$，$AE\\parallel DH$，且 $AB\\cap AE=A$，故两平面平行。' },
      { id: 'q6', type: 'essay', score: 15, stem: String.raw`已知矩阵 $A=\begin{pmatrix}1&2\\0&1\end{pmatrix}$，写出 $A$ 的转置矩阵，并计算向量 $\vec{a}=(1,2)$ 的模。`, options: [], answer: [String.raw`$A^T=\begin{pmatrix}1&0\\2&1\end{pmatrix}$；$|\vec{a}|=\sqrt{5}$`], analysis: String.raw`矩阵转置交换行列。向量模长为 $\sqrt{1^2+2^2}=\sqrt{5}$。` },
    ] },
  ] };
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-word-qa-'));
  const retain = process.argv.includes('--keep'), packaged = process.argv.includes('--packaged');
  const target = retain ? path.join(root, 'artifacts/qa-word-export') : path.join(profile, 'exports'); fs.mkdirSync(target, { recursive: true });
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const exam = fixture();
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 10.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'full', quickAnswers: true };
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  let app; const errors = [], outputs = [];
  const timer = setTimeout(() => { app?.process().kill(); process.exitCode = 1; }, 60000);
  try {
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? [] : [root], env });
    await app.evaluate(({ BrowserWindow, dialog, ipcMain, session }) => {
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
      globalThis.__wordCalls = 0; globalThis.__wordRequests = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => { globalThis.__wordRequests++; cb({ cancel: true }); });
      ipcMain.removeHandler('model:recognize'); ipcMain.handle('model:recognize', () => { globalThis.__wordCalls++; throw Error('No real OCR in Word QA'); });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.__wordTarget });
    });
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForSelector('[data-editor-workbench]');
    for (const paper of ['A4', 'A3', '8K']) {
      const file = path.join(target, `数学试卷-${paper}.docx`);
      await app.evaluate((_, file) => { globalThis.__wordTarget = file; }, file);
      const result = await page.evaluate(({ exam, layout, paper }) => window.juanye.exportDocx({ name: `数学试卷-${paper}`, exam, layout: { ...layout, paper, orientation: paper === 'A4' ? 'portrait' : 'landscape', columns: paper === 'A4' ? 1 : 2, sealLine: paper !== 'A4', columnGap: 8, sealWidth: 18 } }), { exam, layout, paper });
      assert.equal(result.canceled, false); assert.ok(fs.statSync(file).size > 5000);
      const zip = await JSZip.loadAsync(fs.readFileSync(file)); const document = await zip.file('word/document.xml').async('string');
      for (const tag of ['<m:f>', '<m:rad>', '<m:nary>', '<m:m>', '<m:acc>', '<w:tbl>', '<wp:anchor']) assert.ok(document.includes(tag), `${paper}: missing native content ${tag}`);
      for (const text of ['参考答案与解析', '选择填空速对', '注意力集中', '长方体示意图']) assert.ok(document.includes(text), `${paper}: lost editable text ${text}`);
      assert.ok(!document.includes('altChunk')); assert.ok(zip.file('word/media/image1.png'));
      if (paper !== 'A4') { assert.ok(document.includes('<w:cols w:num="2"')); assert.ok(zip.file('word/header1.xml')); }
      for (const [name, entry] of Object.entries(zip.files)) {
        if (!/\.(?:xml|rels)$/.test(name)) continue;
        const issues = []; new DOMParser({ onError: (level, message) => { if (level !== 'warning') issues.push(message); } }).parseFromString(await entry.async('string'), 'text/xml'); assert.deepEqual(issues, [], `${paper}/${name}`);
      }
      outputs.push({ paper, path: retain ? file : undefined, bytes: fs.statSync(file).size, equations: (document.match(/<m:oMath[ >]/g) || []).length });
    }
    const calls = await app.evaluate(() => ({ modelCalls: globalThis.__wordCalls, cloudRequests: globalThis.__wordRequests }));
    assert.deepEqual(calls, { modelCalls: 0, cloudRequests: 0 }); assert.deepEqual(errors, []);
    const report = { passed: true, packaged, verification: 'Actual desktop IPC plus DOCX package and native editable content structure; visual Word rendering is a separate required gate.', outputs, errors, ...calls };
    if (retain) fs.writeFileSync(path.join(target, `results-${packaged ? 'packaged' : 'source'}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally {
    clearTimeout(timer); if (app) await app.close().catch(() => app.process().kill());
    const absolute = fs.realpathSync(profile);
    if (path.dirname(absolute).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase() && path.basename(absolute).startsWith('juanye-word-qa-')) fs.rmSync(absolute, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixture };
