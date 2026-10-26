const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const { createCanvas } = require('@napi-rs/canvas');
const { buildDocx, latexToOmml, mathSegments } = require('./docx-export.cjs');

const layout = { paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, pageNumber: true, showScore: true, answerMode: 'full', quickAnswers: true };
const question = { id: 'q', type: 'single', score: 5, stem: '已知 $x^2=4$，则（　）。', options: ['$2$', '$-2$', '$\\pm2$', '$0$'], answer: ['C'], analysis: '由 $x^2=4$，得 $x=\\pm2$。' };
const exam = { title: '数学试卷', subtitle: '高三数学', duration: 120, notice: ['认真答题。'], sections: [{ id: 's', title: '单项选择题', type: 'single', note: '', questions: [question] }] };

test('editable Word math uses native OMML for fractions, roots, scripts, sums, integrals and matrices', () => {
  const fixtures = [
    [String.raw`\frac{a+b}{c}`, '<m:f>'], [String.raw`\sqrt{x}+\sqrt[3]{y}`, '<m:rad>'],
    [String.raw`x_i^2`, '<m:sSubSup>'], [String.raw`\sum_{i=1}^{n} i^2`, '<m:nary>'],
    [String.raw`\int_0^1 x\,dx`, '<m:nary>'], [String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`, '<m:m>'],
    [String.raw`\overline{AB}`, '<m:bar>'], [String.raw`\vec{a}`, '<m:acc>'],
    [String.raw`\underbrace{a+b}_{n}`, '<m:groupChr>'],
    [String.raw`\left(\frac{a}{b}\right)`, '<m:d>'], [String.raw`P(A\mid B)=\frac{P(AB)}{P(B)}`, '<m:f>'],
  ];
  for (const [source, expected] of fixtures) {
    const output = latexToOmml(source); assert.ok(output.includes(expected), source); assert.ok(!output.includes('annotation')); assert.ok(!output.includes('<w:drawing'));
    const errors = []; new DOMParser({ onError: (level, message) => { if (level !== 'warning') errors.push(message); } }).parseFromString(output, 'text/xml'); assert.deepEqual(errors, []);
  }
  assert.throws(() => latexToOmml(String.raw`\notSupportedCommand{x}`), /Word 公式无法转换/);
});

test('Word delimiter handling protects math pipes and escaped currency', () => {
  const parts = mathSegments(String.raw`价格\$5；$P(A\mid B)$；\(x_1\)；\[x^2\]`);
  assert.deepEqual(parts.filter(part => part.math).map(part => part.text), [String.raw`P(A\mid B)`, 'x_1', 'x^2']);
});

test('DOCX exports editable stem/options/answers/analysis and true tables with safe XML', async () => {
  const input = JSON.parse(JSON.stringify(exam));
  input.sections[0].questions[0].stem += '\n\n| 类别 | 数值 |\n| --- | --- |\n| 概率 | $P(A\\mid B)$ |\n\n<script>evil & copy</script>';
  const before = JSON.stringify(input);
  const zip = await JSZip.loadAsync(await buildDocx(input, layout));
  const document = await zip.file('word/document.xml').async('string');
  assert.ok(document.includes('<w:tbl>')); assert.ok(document.includes('<m:oMath')); assert.ok(document.includes('参考答案与解析'));
  assert.ok(document.includes('答案：')); assert.ok(document.includes('解析：')); assert.ok(document.includes('&lt;script&gt;evil &amp; copy&lt;/script&gt;'));
  assert.ok(!document.includes('<script>')); assert.ok(!document.includes('altChunk')); assert.equal(JSON.stringify(input), before);
  for (const [name, file] of Object.entries(zip.files)) {
    if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue;
    const errors = []; new DOMParser({ onError: (level, message) => { if (level !== 'warning') errors.push(message); } }).parseFromString(await file.async('string'), 'text/xml'); assert.deepEqual(errors, [], name);
  }
});

test('A3/8K Word uses two native columns and independent left seal rail', async () => {
  for (const [paper, width, height] of [['A3', 420, 297], ['8K', 390, 270]]) {
    const zip = await JSZip.loadAsync(await buildDocx(exam, { ...layout, paper, orientation: 'landscape', columns: 2, columnGap: 8, sealLine: true, sealWidth: 18 }));
    const document = await zip.file('word/document.xml').async('string');
    assert.ok(document.includes(`w:w="${Math.round(width * 1440 / 25.4)}" w:h="${Math.round(height * 1440 / 25.4)}"`));
    assert.ok(document.includes('<w:cols w:num="2"')); assert.ok(document.includes(`w:left="${Math.round(29 * 1440 / 25.4)}"`));
    const header = await zip.file('word/header1.xml').async('string'); for (const text of ['学校', '班级', '姓名', '考号', '<wp:anchor', 'relativeFrom="paragraph"', 'relativeFrom="column"']) assert.ok(header.includes(text));
    assert.ok(!header.includes('w:textDirection')); assert.ok(!header.includes('<w:pict'));
    assert.ok(zip.file('word/media/seal.png')); assert.ok(zip.file('word/_rels/header1.xml.rels'));
    assert.ok(!document.includes('学校：____________'), 'The seal already contains identity fields; do not duplicate them in the body');
  }
});

test('vertical operators remain literal upright OMML glyphs in Word-compatible importers', () => {
  for (const formula of [String.raw`|z|`, String.raw`P(A\mid B)`, String.raw`AB\parallel CD`, String.raw`\left.\frac{x^3}{3}\right|_0^1`]) {
    const output = latexToOmml(formula);
    assert.ok(output.includes('<m:nor/>')); assert.ok(output.includes('<w:i w:val="0"/>'));
    assert.ok(output.includes('Segoe UI Symbol')); assert.ok(output.includes('<m:oMath'));
    assert.ok(!output.includes('<w:drawing'));
  }
});

test('pictures persist as embedded PNG and external images fail without requesting anything', async () => {
  const canvas = createCanvas(40, 30), context = canvas.getContext('2d'); context.fillStyle = '#222'; context.fillRect(4, 5, 25, 15);
  const source = canvas.toDataURL('image/png');
  const input = JSON.parse(JSON.stringify(exam)); input.sections[0].questions[0].figures = [{ id: 'f', src: source, layout: 'right' }, { id: 'f2', src: source, layout: 'right', caption: '第二张题图' }];
  const zip = await JSZip.loadAsync(await buildDocx(input, layout));
  assert.ok(zip.file('word/media/image1.png')); assert.ok((await zip.file('word/document.xml').async('string')).includes('<wp:anchor'));
  const doc = await zip.file('word/document.xml').async('string');
  assert.equal((doc.match(/<wp:anchor /g) || []).length, 1, 'Multiple right figures must not anchor at the same paragraph position');
  assert.equal((doc.match(/<wp:inline /g) || []).length, 1); assert.ok(doc.includes('第二张题图'));
  input.sections[0].questions[0].figures[0].src = 'https://example.com/photo.png';
  await assert.rejects(buildDocx(input, layout), /不能引用外部/);
});

test('TikZ uses local renderer and safe PNG fallback, never silently drops drawing code', async () => {
  const input = JSON.parse(JSON.stringify(exam)); input.sections[0].questions[0].drawing = String.raw`\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}`;
  await assert.rejects(buildDocx(input, layout), /离线绘图服务不可用/);
  const zip = await JSZip.loadAsync(await buildDocx(input, layout, { renderDrawing: async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="M5 95L95 5" stroke="black"/></svg>' }) }));
  assert.ok(zip.file('word/media/image1.png'));
  await assert.rejects(buildDocx(input, layout, { renderDrawing: async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image href="https://example.com/a"/></svg>' }) }), /外部或可执行/);
});

test('answerMode none does not accidentally leak reference answers into student paper', async () => {
  const zip = await JSZip.loadAsync(await buildDocx(exam, { ...layout, answerMode: 'none' }));
  const document = await zip.file('word/document.xml').async('string');
  assert.ok(!document.includes('参考答案与解析')); assert.ok(!document.includes('解析：'));
});

test('actual bundled TikZ geometry remains visible as an embedded Word picture', { timeout: 45000 }, async () => {
  const { createDiagramService } = require('./diagram.cjs');
  const service = createDiagramService({ timeoutMs: 30000 });
  const input = JSON.parse(JSON.stringify(exam));
  input.sections[0].questions[0].drawing = String.raw`\begin{tikzpicture}[scale=1.5]
\coordinate (A) at (0,0); \coordinate (B) at (1,0);
\coordinate (C) at (1,1); \coordinate (D) at (0,1);
\coordinate (E) at (0.4,0.4); \coordinate (F) at (1.4,0.4);
\coordinate (G) at (1.4,1.4); \coordinate (H) at (0.4,1.4);
\draw[dashed] (A)--(E)--(F) (E)--(H);
\draw (A)--(B)--(C)--(D)--cycle;
\draw (B)--(F)--(G)--(H)--(D); \draw (C)--(G);
\node[below] at (A) {$A$};
\end{tikzpicture}`;
  try {
    const zip = await JSZip.loadAsync(await buildDocx(input, layout, { renderDrawing: source => service.render(source) }));
    const png = await zip.file('word/media/image1.png').async('nodebuffer');
    assert.ok(png.length > 500, 'Geometry PNG must contain the actual drawing, not a blank pixel');
    const image = await require('@napi-rs/canvas').loadImage(png);
    assert.ok(image.width > 30 && image.height > 30);
    const canvas = createCanvas(image.width, image.height); canvas.getContext('2d').drawImage(image, 0, 0);
    const pixels = canvas.getContext('2d').getImageData(0, 0, image.width, image.height).data;
    let ink = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 50 && pixels[i] < 150 && pixels[i + 1] < 150 && pixels[i + 2] < 150) ink++;
    assert.ok(ink > 30, 'Geometry outlines and labels must survive rasterization');
  } finally { service.dispose(); }
});
