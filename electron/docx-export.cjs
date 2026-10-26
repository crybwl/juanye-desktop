/* Offline editable Word export. MathML/OMML object mapping follows
 * https://learn.microsoft.com/en-us/office/math/mathml . No equation images,
 * HTML altChunk, external files, browser globals or remote fonts are used. */
const JSZip = require('jszip');
const katex = require('katex');
const MarkdownIt = require('markdown-it');
const { DOMParser } = require('@xmldom/xmldom');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const IMAGE_REL = `${REL_NS}/image`;
const xml = value => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const el = (tag, inner = '', attrs = '') => `<${tag}${attrs ? ` ${attrs}` : ''}>${inner}</${tag}>`;
const children = node => Array.from(node.childNodes || []).filter(child => child.nodeType === 1);
const local = node => node.localName || node.nodeName;
const mathRun = (text, props = '') => text ? `<m:r>${props ? `<m:rPr>${props}</m:rPr>` : ''}<m:t xml:space="preserve">${xml(text)}</m:t></m:r>` : '';
const upright = '<m:sty m:val="p"/>';
const naryChars = new Set(['∑', '∏', '∐', '∫', '∬', '∭', '∮', '⋂', '⋃', '⋀', '⋁', '⨁', '⨂', '⨀']);
const relChars = new Set(['=', '≠', '<', '>', '≤', '≥', '≈', '∼', '≡', '⇒', '⇔', ',', ';']);
function naryInfo(node) {
  const tag = local(node), items = children(node);
  if (tag === 'mo' && naryChars.has(node.textContent)) return { char: node.textContent, sub: '', sup: '', side: true };
  if (!['msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover'].includes(tag) || !items[0] || !naryChars.has(items[0].textContent) || local(items[0]) !== 'mo') return;
  return { char: items[0].textContent, sub: ['msub', 'msubsup', 'munder', 'munderover'].includes(tag) ? convertMathNode(items[1]) : '', sup: ['msup', 'mover'].includes(tag) ? convertMathNode(items[1]) : ['msubsup', 'munderover'].includes(tag) ? convertMathNode(items[2]) : '', side: tag.startsWith('ms') };
}
function nary(info, body) {
  return `<m:nary><m:naryPr><m:chr m:val="${xml(info.char)}"/><m:limLoc m:val="${info.side ? 'subSup' : 'undOvr'}"/><m:subHide m:val="${info.sub ? '0' : '1'}"/><m:supHide m:val="${info.sup ? '0' : '1'}"/></m:naryPr><m:sub>${info.sub}</m:sub><m:sup>${info.sup}</m:sup><m:e>${body}</m:e></m:nary>`;
}
function convertRow(nodes) {
  let output = '';
  for (let i = 0; i < nodes.length; i++) {
    const info = naryInfo(nodes[i]);
    if (info) {
      let end = i + 1;
      while (end < nodes.length && !(local(nodes[end]) === 'mo' && relChars.has(nodes[end].textContent))) end++;
      output += nary(info, convertRow(nodes.slice(i + 1, end)));
      i = end - 1;
    } else output += convertMathNode(nodes[i]);
  }
  return output;
}
function convertMathNode(node) {
  if (!node) return '';
  const tag = local(node), items = children(node), c = index => convertMathNode(items[index]);
  if (['math', 'mstyle', 'mpadded', 'mrow', 'mtd'].includes(tag)) {
    if (tag === 'mrow' && items.length >= 2 && local(items[0]) === 'mo' && local(items.at(-1)) === 'mo' && items[0].getAttribute('fence') === 'true' && items.at(-1).getAttribute('fence') === 'true') {
      return `<m:d><m:dPr><m:begChr m:val="${xml(items[0].textContent)}"/><m:endChr m:val="${xml(items.at(-1).textContent)}"/><m:grow m:val="1"/></m:dPr><m:e>${convertRow(items.slice(1, -1))}</m:e></m:d>`;
    }
    return convertRow(items);
  }
  if (tag === 'semantics') return c(0);
  if (['annotation', 'annotation-xml'].includes(tag)) return '';
  if (['mi', 'mn', 'mo', 'mtext', 'ms'].includes(tag)) {
    let props = tag !== 'mi' || node.getAttribute('mathvariant') === 'normal' ? upright : '';
    const variant = node.getAttribute('mathvariant');
    const scripts = { 'double-struck': 'double-struck', 'script': 'script', 'fraktur': 'fraktur', 'sans-serif': 'sans-serif', 'monospace': 'monospace' };
    if (scripts[variant]) props += `<m:scr m:val="${scripts[variant]}"/>`;
    if (variant === 'bold') props += '<m:sty m:val="b"/>';
    if (variant === 'bold-italic') props += '<m:sty m:val="bi"/>';
    return mathRun(node.textContent, props);
  }
  if (tag === 'mspace') return mathRun('\u2009', upright);
  if (tag === 'mfrac') return `<m:f>${node.getAttribute('linethickness') === '0px' || node.getAttribute('linethickness') === '0' ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ''}<m:num>${c(0)}</m:num><m:den>${c(1)}</m:den></m:f>`;
  if (tag === 'msqrt' || tag === 'mroot') return `<m:rad><m:radPr><m:degHide m:val="${tag === 'msqrt' ? '1' : '0'}"/></m:radPr><m:deg>${tag === 'mroot' ? c(1) : ''}</m:deg><m:e>${tag === 'mroot' ? c(0) : convertRow(items)}</m:e></m:rad>`;
  if (tag === 'msub') return `<m:sSub><m:e>${c(0)}</m:e><m:sub>${c(1)}</m:sub></m:sSub>`;
  if (tag === 'msup') return `<m:sSup><m:e>${c(0)}</m:e><m:sup>${c(1)}</m:sup></m:sSup>`;
  if (tag === 'msubsup') return `<m:sSubSup><m:e>${c(0)}</m:e><m:sub>${c(1)}</m:sub><m:sup>${c(2)}</m:sup></m:sSubSup>`;
  if (tag === 'munder' || tag === 'mover') {
    const over = tag === 'mover', mark = items[1]?.textContent || '';
    if (['¯', '‾', '―', '̅', '_', '▁'].includes(mark)) return `<m:bar><m:barPr><m:pos m:val="${over ? 'top' : 'bot'}"/></m:barPr><m:e>${c(0)}</m:e></m:bar>`;
    if (['⏞', '⏟', '⎴', '⎵'].includes(mark)) return `<m:groupChr><m:groupChrPr><m:chr m:val="${xml(mark)}"/><m:pos m:val="${over ? 'top' : 'bot'}"/><m:vertJc m:val="${over ? 'bot' : 'top'}"/></m:groupChrPr><m:e>${c(0)}</m:e></m:groupChr>`;
    const accents = { '^': '\u0302', 'ˆ': '\u0302', '~': '\u0303', '˜': '\u0303', '→': '\u20d7', '˙': '\u0307', '¨': '\u0308', '`': '\u0300', '´': '\u0301', 'ˇ': '\u030c', '˘': '\u0306' };
    if (over && node.getAttribute('accent') === 'true') return `<m:acc><m:accPr><m:chr m:val="${xml(accents[mark] || mark)}"/></m:accPr><m:e>${c(0)}</m:e></m:acc>`;
    return `<m:${over ? 'limUpp' : 'limLow'}><m:e>${c(0)}</m:e><m:lim>${c(1)}</m:lim></m:${over ? 'limUpp' : 'limLow'}>`;
  }
  if (tag === 'munderover') return `<m:limUpp><m:e><m:limLow><m:e>${c(0)}</m:e><m:lim>${c(1)}</m:lim></m:limLow></m:e><m:lim>${c(2)}</m:lim></m:limUpp>`;
  if (tag === 'mtable') {
    const rows = items.filter(row => local(row) === 'mtr');
    const count = Math.max(1, ...rows.map(row => children(row).length));
    return `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${count}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs></m:mPr>${rows.map(row => `<m:mr>${Array.from({ length: count }, (_, index) => `<m:e>${convertMathNode(children(row)[index])}</m:e>`).join('')}</m:mr>`).join('')}</m:m>`;
  }
  if (tag === 'mfenced') return `<m:d><m:dPr><m:begChr m:val="${xml(node.getAttribute('open') || '(')}"/><m:endChr m:val="${xml(node.getAttribute('close') || ')')}"/></m:dPr>${items.map(item => `<m:e>${convertMathNode(item)}</m:e>`).join('')}</m:d>`;
  if (tag === 'mphantom') return `<m:phant><m:phantPr><m:show m:val="0"/></m:phantPr><m:e>${convertRow(items)}</m:e></m:phant>`;
  if (tag === 'menclose' && ['box', 'roundedbox', ''].includes(node.getAttribute('notation'))) return `<m:borderBox><m:e>${convertRow(items)}</m:e></m:borderBox>`;
  if (tag === 'mmultiscripts') {
    const split = items.findIndex(child => local(child) === 'mprescripts');
    let base = c(0);
    if (split > 0) base = `<m:sPre><m:sub>${convertMathNode(items[split + 1])}</m:sub><m:sup>${convertMathNode(items[split + 2])}</m:sup><m:e>${base}</m:e></m:sPre>`;
    if (split === -1 ? items.length > 1 : split > 1) base = `<m:sSubSup><m:e>${base}</m:e><m:sub>${c(1)}</m:sub><m:sup>${c(2)}</m:sup></m:sSubSup>`;
    return base;
  }
  if (tag === 'none' || tag === 'mprescripts') return '';
  throw Error(`Word 公式转换不支持 MathML 元素 ${tag}，请先修改该公式后再导出`);
}
function latexToOmml(source, display = false) {
  if (typeof source !== 'string' || source.length > 200000) throw Error('Word 公式过长');
  let mathml;
  try { mathml = katex.renderToString(source, { output: 'mathml', displayMode: display, throwOnError: true, strict: 'ignore', trust: false, maxExpand: 1000, maxSize: 20 }); }
  catch (error) { throw Error(`Word 公式无法转换：${source.slice(0, 100)}（${error.message}）`); }
  const document = new DOMParser().parseFromString(mathml, 'text/xml');
  const root = document.getElementsByTagName('math')[0];
  if (!root) throw Error(`Word 公式无法转换：${source.slice(0, 100)}`);
  try { return `<m:oMath xmlns:m="${MATH_NS}">${convertMathNode(root)}</m:oMath>`; }
  catch (error) { throw Error(`${error.message}：${source.slice(0, 100)}`); }
}

// Use the same delimiter semantics as the on-screen renderer, including escaped
// dollar signs and legacy $$ only as an import compatibility case.
function mathSegments(source) {
  const escaped = at => { let n = 0; for (let i = at - 1; i >= 0 && source[i] === '\\'; i--) n++; return n % 2 === 1; };
  const out = []; let start = 0;
  for (let i = 0; i < source.length; i++) {
    if (escaped(i)) continue;
    const open = source.startsWith('$$', i) ? '$$' : source.startsWith('\\[', i) ? '\\[' : source.startsWith('\\(', i) ? '\\(' : source[i] === '$' ? '$' : '';
    if (!open) continue;
    const close = open === '\\[' ? '\\]' : open === '\\(' ? '\\)' : open;
    let end = i + open.length;
    while ((end = source.indexOf(close, end)) !== -1) {
      if (!escaped(end) && !(open === '$' && (source[end - 1] === '$' || source[end + 1] === '$'))) break;
      end += close.length;
    }
    if (end === -1) { if (open === '$$') i++; continue; }
    if (i > start) out.push({ text: source.slice(start, i), math: false });
    out.push({ text: source.slice(i + open.length, end), math: true, display: open === '$$' || open === '\\[' });
    i = end + close.length - 1; start = i + 1;
  }
  if (start < source.length) out.push({ text: source.slice(start), math: false });
  return out;
}

const markdown = new MarkdownIt('zero', { html: false, breaks: true, linkify: false }).enable(['table', 'emphasis', 'newline', 'escape', 'entity']);
const mm = value => Math.round(value * 1440 / 25.4);
const emu = value => Math.round(value * 914400 / 25.4);
const textRun = (text, { bold = false, italic = false, underline = false } = {}) => `<w:r><w:rPr>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${underline ? '<w:u w:val="single"/>' : ''}<w:color w:val="000000"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
const para = (content = '', { style, center, before = 0, after = 60, keep = false, pageBreak = false, line = 300 } = {}) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${center ? '<w:jc w:val="center"/>' : ''}${keep ? '<w:keepNext/>' : ''}${pageBreak ? '<w:pageBreakBefore/>' : ''}<w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="auto"/><w:widowControl/></w:pPr>${content}</w:p>`;
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const cn = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const sizes = { A4: [210, 297], A5: [148, 210], B5: [176, 250], Letter: [215.9, 279.4], A3: [297, 420], '8K': [270, 390] };
const hasOptions = q => ['single', 'multi', 'judge'].includes(q.type);
const validTypes = ['single', 'multi', 'judge', 'blank', 'essay', 'material', 'custom'];
function validateExport(exam, layout) {
  if (!exam || typeof exam !== 'object' || !Array.isArray(exam.sections) || exam.sections.length > 200 || !layout || typeof layout !== 'object') throw Error('Word 导出数据格式不正确');
  if (Buffer.byteLength(JSON.stringify({ exam, layout })) > 100 * 1024 * 1024) throw Error('Word 导出内容超过 100 MB');
  for (const value of [exam.title, exam.subtitle ?? '', ...(exam.notice ?? [])]) if (typeof value !== 'string' || value.length > 200000) throw Error('Word 导出文本不正确');
  if (!sizes[layout.paper] || !['portrait', 'landscape'].includes(layout.orientation)) throw Error('Word 导出纸张不受支持');
  for (const [key, min, max] of [['margin', 5, 45], ['fontSize', 6, 30], ['lineHeight', 1, 3]]) if (!Number.isFinite(layout[key]) || layout[key] < min || layout[key] > max) throw Error(`Word 导出 ${key} 不正确`);
  let count = 0;
  for (const section of exam.sections) {
    if (!section || typeof section.title !== 'string' || typeof section.note !== 'string' || !Array.isArray(section.questions)) throw Error('Word 导出大题格式不正确');
    for (const q of section.questions) {
      if (++count > 5000 || !validTypes.includes(q.type) || typeof q.stem !== 'string' || typeof q.analysis !== 'string' || !Array.isArray(q.options) || !Array.isArray(q.answer) || [...q.options, ...q.answer].some(value => typeof value !== 'string') || !Number.isFinite(q.score)) throw Error('Word 导出题目格式不正确');
    }
  }
}
function plotSvg() {
  const points = []; for (let x = 0; x <= Math.atan(4); x += .02) points.push(`${22 + x / 1.7 * 196},${128 - Math.tan(x) / 4 * 120}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="300" viewBox="0 0 230 150"><rect width="230" height="150" fill="white"/><g fill="none" stroke="#222"><path d="M22 128H224M22 134V8M220 125L224 128L220 131M19 12L22 8L25 12"/><polyline points="${points.join(' ')}"/><path d="M22 128L218 46"/></g><g font-family="serif" font-size="10"><text x="10" y="141">O</text><text x="214" y="141">x</text><text x="27" y="14">y</text><text x="160" y="20">y=tan x</text><text x="170" y="67">y=ax</text></g></svg>`;
}

async function buildDocx(exam, layout, options = {}) {
  validateExport(exam, layout);
  const zip = new JSZip();
  const [baseW, baseH] = sizes[layout.paper];
  const width = layout.orientation === 'landscape' ? Math.max(baseW, baseH) : Math.min(baseW, baseH);
  const height = layout.orientation === 'landscape' ? Math.min(baseW, baseH) : Math.max(baseW, baseH);
  const margin = layout.margin, seal = layout.sealLine ? Math.max(12, Math.min(30, layout.sealWidth ?? 18)) : 0;
  const columns = layout.columns === 2 ? 2 : 1, columnGap = Math.max(3, Math.min(25, layout.columnGap ?? 8));
  const columnWidth = (width - 2 * margin - seal - (columns - 1) * columnGap) / columns;
  if (columnWidth < 35) throw Error('Word 栏宽过窄，请增大纸张或减小页边距');
  const relationships = [ { id: 'rStyles', type: `${REL_NS}/styles`, target: 'styles.xml' }, { id: 'rSettings', type: `${REL_NS}/settings`, target: 'settings.xml' } ];
  const media = new Map(); let pictureCount = 0;
  const line = Math.round(layout.lineHeight * 240);
  const p = (value, attrs) => para(value, { line, ...attrs });
  async function imageRun(source, maximumMm = Math.min(60, columnWidth), maxHeightMm = 65, alt = '题图', right = false) {
    if (typeof source !== 'string' || source.length > 40 * 1024 * 1024 || !/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/.test(source)) throw Error('Word 题图必须是嵌入的图片，不能引用外部文件');
    // SVG input is produced exclusively by the validated local TikZ service or
    // built-in plot, never accepted from question.figures.
    const svg = source.startsWith('data:image/svg+xml;');
    const decoded = Buffer.from(source.split(',')[1], 'base64');
    if (svg && /(?:href\s*=\s*["'](?!#|data:)|<script|<foreignObject|<!ENTITY|<!DOCTYPE)/i.test(decoded.toString())) throw Error('Word 题图包含外部或可执行资源');
    let item = media.get(source);
    if (!item) {
      let image;
      try { image = await loadImage(decoded); } catch { throw Error('Word 题图无法解码，请重新导入图片'); }
      if (!image.width || !image.height || image.width * image.height > 40000000) throw Error('Word 题图尺寸过大');
      const canvas = createCanvas(image.width, image.height); canvas.getContext('2d').drawImage(image, 0, 0);
      item = { id: `rImage${media.size + 1}`, name: `image${media.size + 1}.png`, width: image.width, height: image.height, buffer: canvas.toBuffer('image/png') };
      media.set(source, item); zip.file(`word/media/${item.name}`, item.buffer);
      relationships.push({ id: item.id, type: IMAGE_REL, target: `media/${item.name}` });
    }
    const imageWidth = Math.max(5, Math.min(maximumMm, maxHeightMm * item.width / item.height));
    const imageHeight = imageWidth * item.height / item.width;
    const cx = emu(imageWidth), cy = emu(imageHeight), docId = ++pictureCount;
    const drawing = `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${docId}" name="题图 ${docId}" descr="${xml(alt)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${docId}" name="${item.name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${item.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
    const outer = right ? `<wp:anchor distT="0" distB="${emu(2)}" distL="${emu(3)}" distR="0" simplePos="0" relativeHeight="0" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="0"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:align>right</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>${drawing.replace('<wp:docPr', '<wp:wrapSquare wrapText="left"/><wp:docPr')}</wp:anchor>` : `<wp:inline distT="0" distB="0" distL="0" distR="0">${drawing}</wp:inline>`;
    return `<w:r><w:drawing>${outer}</w:drawing></w:r>`;
  }
  const drawingCache = new Map();
  async function tikzRun(code) {
    if (!options.renderDrawing) throw Error('Word 导出包含绘图，但离线绘图服务不可用');
    if (!drawingCache.has(code)) drawingCache.set(code, Promise.resolve(options.renderDrawing(code)));
    const rendered = await drawingCache.get(code);
    if (!rendered?.svg) throw Error('Word 绘图无法生成');
    return imageRun(`data:image/svg+xml;base64,${Buffer.from(rendered.svg).toString('base64')}`, Math.min(70, columnWidth), 70, '几何绘图');
  }
  async function blocks(source, attrs = {}) {
    const protectedItems = []; let marker = '\ue100'; while (source.includes(marker)) marker += '\ue101';
    const protect = value => `${marker}${protectedItems.push(value) - 1}\ue102`;
    const parts = source.split(/(\\begin\s*\{tikzpicture\}[\s\S]*?\\end\s*\{tikzpicture\})/g);
    let protectedSource = '';
    for (const part of parts) {
      if (/^\\begin\s*\{tikzpicture\}/.test(part)) protectedSource += protect(await tikzRun(part));
      else protectedSource += mathSegments(part).map(segment => segment.math ? protect(latexToOmml(segment.text, segment.display)) : segment.text.replace(/<br\s*\/?\s*>/gi, '\n')).join('');
    }
    const inline = tokens => {
      let result = '', bold = false, italic = false;
      for (const token of tokens || []) {
        if (token.type === 'strong_open') { bold = true; continue; } if (token.type === 'strong_close') { bold = false; continue; }
        if (token.type === 'em_open') { italic = true; continue; } if (token.type === 'em_close') { italic = false; continue; }
        if (['softbreak', 'hardbreak'].includes(token.type)) { result += '<w:r><w:br/></w:r>'; continue; }
        const text = token.content || '';
        const re = new RegExp(`${marker}(\\d+)\ue102`, 'g'); let previous = 0;
        for (const match of text.matchAll(re)) {
          result += textRun(text.slice(previous, match.index), { bold, italic }) + protectedItems[Number(match[1])]; previous = match.index + match[0].length;
        }
        result += textRun(text.slice(previous), { bold, italic });
      }
      return result;
    };
    const tokens = markdown.parse(protectedSource, {}); let output = '', i = 0, first = true;
    while (i < tokens.length) {
      const token = tokens[i];
      if (token.type === 'table_open') {
        if (first && attrs.prefix) output += p(attrs.prefix, { ...attrs, keep: true });
        const rows = []; let row, header = false;
        for (i++; i < tokens.length && tokens[i].type !== 'table_close'; i++) {
          if (tokens[i].type === 'tr_open') { row = []; header = false; }
          if (tokens[i].type === 'th_open') header = true;
          if (tokens[i].type === 'inline') row.push(inline(tokens[i].children));
          if (tokens[i].type === 'tr_close') rows.push({ cells: row, header });
        }
        const count = Math.max(1, ...rows.map(row => row.cells.length)), cellWidth = Math.floor(mm(columnWidth) / count);
        output += `<w:tbl><w:tblPr><w:tblW w:w="${mm(columnWidth)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => `<w:${side} w:val="single" w:sz="4" w:color="B0B0B0"/>`).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="65" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="65" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array(count).fill(`<w:gridCol w:w="${cellWidth}"/>`).join('')}</w:tblGrid>${rows.map(row => `<w:tr>${row.header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${row.cells.map(cell => `<w:tc><w:tcPr><w:tcW w:w="${cellWidth}" w:type="dxa"/><w:vAlign w:val="center"/>${row.header ? '<w:shd w:fill="F0F0F0"/>' : ''}</w:tcPr>${p(cell, { after: 0, center: true })}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
        first = false;
      } else if (token.type === 'inline') {
        output += p((first ? attrs.prefix || '' : '') + inline(token.children), { ...attrs, pageBreak: first && attrs.pageBreak, keep: first && attrs.keep }); first = false;
      }
      i++;
    }
    if (!output) output = p(attrs.prefix || '', attrs);
    return output;
  }
  const allQuestions = exam.sections.flatMap(section => section.questions);
  const score = allQuestions.reduce((sum, q) => sum + q.score, 0);
  let body = p(textRun(exam.title, { bold: true }), { style: 'Title', center: true, after: 100, keep: true });
  if (exam.subtitle) body += p(textRun(exam.subtitle), { center: true, after: 100, keep: true });
  body += p(textRun(`考试时间 ${exam.duration || 0} 分钟　满分 ${score} 分　共 ${allQuestions.length} 题`), { center: true, after: 120, keep: true });
  body += p(textRun('学校：____________　班级：________　姓名：________　考号：____________'), { center: true, after: 140 });
  for (const notice of exam.notice || []) body += await blocks(notice, { after: 70 });
  let number = 0;
  for (const [index, section] of exam.sections.entries()) {
    if (!section.questions.length) continue;
    body += p(textRun(`${cn[index] || index + 1}、${section.title}`, { bold: true }), { style: 'Heading1', before: 120, after: 90, keep: true, pageBreak: Boolean(section.pageBreakBefore) });
    if (section.note) body += await blocks(section.note, { after: 100, keep: true });
    for (const q of section.questions) {
      number++;
      let figures = q.figures || [];
      if (q.figure && !figures.some(figure => figure.src === q.figure)) figures = [{ src: q.figure, layout: 'right' }, ...figures];
      let rightImages = '';
      const rightFigure = figures.find(figure => figure.layout === 'right');
      for (const figure of rightFigure ? [rightFigure] : []) {
        if (/^data:image\/svg/.test(figure.src)) throw Error('Word 题图不接受外部 SVG，请先导入 PNG');
        rightImages += await imageRun(figure.src, columnWidth * (Math.max(15, Math.min(100, figure.width ?? 35)) / 100), (figure.maxHeight ?? 220) * 25.4 / 96, figure.caption || '题图', true);
      }
      const prefix = textRun(`${number}. `, { bold: true }) + (layout.showScore ? textRun(`（${q.score} 分）`) : '') + rightImages;
      const cleanStem = q.stem.replace(/^\s*(?:(?:\*\*|__)?(?:第\s*\d{1,3}\s*题\s*[.．、:：]?|\d{1,3}\s*[.．、])(?!\d)(?:\*\*|__)?\s*)/, '').replace(/^\s*[（(]\s*\d+(?:\.\d+)?\s*分\s*[）)]\s*/, '');
      body += await blocks(cleanStem, { prefix, pageBreak: Boolean(q.pageBreakBefore), keep: layout.keepTogether });
      if (q.image === 'plot') body += p(await imageRun(`data:image/svg+xml;base64,${Buffer.from(plotSvg()).toString('base64')}`, Math.min(60, columnWidth), 45, '函数图像'));
      if (hasOptions(q)) {
        for (const [index, option] of q.options.entries()) body += await blocks(option, { prefix: textRun(`${letters[index] || index + 1}. `), after: 40 });
      }
      for (const figure of figures.filter(figure => figure !== rightFigure)) {
        if (/^data:image\/svg/.test(figure.src)) throw Error('Word 题图不接受外部 SVG，请先导入 PNG');
        body += p(await imageRun(figure.src, columnWidth * (Math.max(15, Math.min(100, figure.width ?? (figure.layout === 'half' ? 48 : 75))) / 100), (figure.maxHeight ?? 220) * 25.4 / 96, figure.caption || '题图'), { center: true });
        if (figure.caption) body += await blocks(figure.caption, { center: true, after: 60 });
      }
      if (q.drawing) body += p(await tikzRun(q.drawing), { center: true });
      if (rightFigure?.caption) body += await blocks(rightFigure.caption, { after: 60 });
      if (layout.paperMode === 'integrated' && ['essay', 'material', 'custom'].includes(q.type)) {
        const space = q.paperAnswerSpace || q.answerSpace || (number >= 17 && number <= 19 ? 'full' : 'half');
        const lines = space === 'full' ? 20 : space === 'quarter' ? 5 : space === 'auto' ? 4 : 10;
        body += p(textRun('解：'), { after: 0 });
        for (let i = 0; i < lines; i++) body += p('', { after: 0, line: 400 });
      }
      body += p('', { after: Math.max(25, Math.round((layout.questionGap ?? 1.8) * 1440 / 25.4)), line: 60 });
    }
  }
  if (layout.answerMode && layout.answerMode !== 'none') {
    body += p(textRun('参考答案与解析', { bold: true }), { style: 'Heading1', pageBreak: true, after: 160, keep: true });
    if (layout.quickAnswers !== false) {
      const short = allQuestions.map((q, index) => ({ q, number: index + 1 })).filter(({ q }) => (hasOptions(q) || q.type === 'blank') && q.answer.join('；').length <= 90 && !q.answer.some(value => value.includes('\n')));
      if (short.length) {
        body += p(textRun('选择填空速对', { bold: true }), { keep: true });
        for (let i = 0; i < short.length; i += 4) body += p((await Promise.all(short.slice(i, i + 4).map(async entry => {
          const answer = entry.q.answer.join('；');
          return textRun(`${entry.number}. `, { bold: true }) + mathSegments(answer).map(part => part.math ? latexToOmml(part.text) : textRun(part.text)).join('') + textRun('　　');
        }))).join(''), { after: 100 });
      }
    }
    for (const [index, q] of allQuestions.entries()) {
      body += await blocks(q.answer.join('；') || '未填写', { prefix: textRun(`${index + 1}. 答案：`, { bold: true }), before: 80, keep: Boolean(layout.answerMode === 'full' && q.analysis) });
      if (layout.answerMode === 'full' && q.analysis) body += await blocks(q.analysis, { prefix: textRun('解析：', { bold: true }), after: 140 });
    }
  }
  const headerId = seal ? 'rHeader' : undefined, footerId = layout.pageNumber ? 'rFooter' : undefined;
  if (headerId) {
    relationships.push({ id: headerId, type: `${REL_NS}/header`, target: 'header1.xml' });
    const sealText = '学校：________________　班级：____________　姓名：____________　考号：________________';
    const rail = `<w:r><w:pict><v:shape id="JuanyeSeal" type="#_x0000_t202" style="position:absolute;margin-left:${mm(margin) / 20}pt;margin-top:${mm(margin) / 20}pt;width:${mm(seal - 2) / 20}pt;height:${mm(height - 2 * margin) / 20}pt;mso-position-horizontal-relative:page;mso-position-vertical-relative:page" stroked="f" filled="f"><v:textbox inset="0,0,0,0"><w:txbxContent><w:p><w:pPr><w:jc w:val="center"/><w:textDirection w:val="btLr"/></w:pPr>${textRun(sealText)}</w:p></w:txbxContent></v:textbox></v:shape><v:line style="position:absolute;mso-position-horizontal-relative:page;mso-position-vertical-relative:page" from="${mm(margin + seal - 1) / 20}pt,${mm(margin) / 20}pt" to="${mm(margin + seal - 1) / 20}pt,${mm(height - margin) / 20}pt" strokecolor="#666666"><v:stroke dashstyle="dash"/></v:line></w:pict></w:r>`;
    zip.file('word/header1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${W_NS}" xmlns:v="urn:schemas-microsoft-com:vml">${p(rail, { after: 0 })}</w:hdr>`);
  }
  if (footerId) {
    relationships.push({ id: footerId, type: `${REL_NS}/footer`, target: 'footer1.xml' });
    const field = code => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${textRun('1')}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    zip.file('word/footer1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W_NS}">${p(textRun('第 ') + field('PAGE') + textRun(' 页（共 ') + field('NUMPAGES') + textRun(' 页）'), { center: true, after: 0 })}</w:ftr>`);
  }
  const sect = `<w:sectPr>${headerId ? `<w:headerReference w:type="default" r:id="${headerId}"/>` : ''}${footerId ? `<w:footerReference w:type="default" r:id="${footerId}"/>` : ''}<w:pgSz w:w="${mm(width)}" w:h="${mm(height)}" w:orient="${layout.orientation}"/><w:pgMar w:top="${mm(margin)}" w:right="${mm(margin)}" w:bottom="${mm(margin)}" w:left="${mm(margin + seal)}" w:header="${mm(3)}" w:footer="${mm(4)}" w:gutter="0"/><w:cols w:num="${columns}" w:space="${mm(columnGap)}" w:sep="${columns === 2 ? '1' : '0'}"/><w:docGrid w:linePitch="312"/></w:sectPr>`;
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}" xmlns:r="${REL_NS}" xmlns:m="${MATH_NS}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}${sect}</w:body></w:document>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.map(rel => `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${rel.target}"/>`).join('')}</Relationships>`);
  const fontSize = Math.round(layout.fontSize * 2);
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun"/><w:color w:val="000000"/><w:sz w:val="${fontSize}"/><w:szCs w:val="${fontSize}"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="${Math.max(28, fontSize + 8)}"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="${fontSize + 2}"/></w:rPr></w:style></w:styles>`);
  zip.file('word/settings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${W_NS}" xmlns:m="${MATH_NS}"><w:compat/><w:updateFields w:val="true"/><m:mathPr><m:mathFont m:val="Cambria Math"/><m:dispDef/><m:smallFrac m:val="0"/></m:mathPr></w:settings>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rDocument" Type="${REL_NS}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>${headerId ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ''}${footerId ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ''}</Types>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

module.exports = { buildDocx, latexToOmml, mathSegments, validateExport };
