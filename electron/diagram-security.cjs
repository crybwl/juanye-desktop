const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const fs = require('node:fs');
const path = require('node:path');

const MAX_SOURCE = 32 * 1024;
const MAX_SVG = 3 * 1024 * 1024;
const libraries = 'arrows.meta,calc,intersections,angles,quotes,positioning,decorations.pathreplacing,patterns,shapes.geometric,3d';

/** TeX itself runs against the package's in-memory files, never a host TeX installation. */
function checkedTikz(source) {
  if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > MAX_SOURCE) throw new Error('绘图代码为空或超过 32 KB');
  const code = source.replace(/\r\n?/g, '\n').replace(/(?<!\\)%[^\n]*/g, '');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(code) || code.includes('^^')) throw new Error('绘图代码含不支持的控制字符');
  const commands = [...code.matchAll(/\\([A-Za-z@]+|.)/g)].map(match => match[1]);
  const forbidden = /^(?:input|include|includegraphics|openin|openout|read|readline|write|immediate|special|pdfliteral|pdfobj|pdfxform|pdfrefxform|pdfcatalog|pdfannot|pdfextension|pdfsuppresswarningpagegroup|directlua|latelua|luadirect|shellescape|write18|catcode|mathcode|lccode|uccode|escapechar|endlinechar|newlinechar|csname|endcsname|scantokens|everyjob|everyeof|dump|shipout|usepackage|documentclass|RequirePackage|LoadClass|endinput|filecontents|jobname|expandafter|futurelet)$/;
  if (commands.some(command => forbidden.test(command))) throw new Error('绘图代码不允许读写文件、外部资源、命令或动态控制序列');
  if (/\\(?:begin|end)\s*\{\s*(?:document|filecontents\*?|luacode\*?)\s*\}/.test(code)) throw new Error('这里只填写 tikzpicture 绘图代码');
  const begins = [...code.matchAll(/\\begin\s*\{tikzpicture\}/g)];
  const ends = [...code.matchAll(/\\end\s*\{tikzpicture\}/g)];
  if (begins.length !== 1 || ends.length !== 1 || ends[0].index < begins[0].index) throw new Error('绘图需要一组成对的 \\begin{tikzpicture} 和 \\end{tikzpicture}');
  // Packages/libraries are selected by the app. A pasted \usetikzlibrary may only name bundled libraries.
  const allowed = new Set(libraries.split(','));
  let safe = code.replace(/\\usetikzlibrary\s*\{([^{}]+)\}/g, (_match, names) => {
    if (!names.split(',').every(name => allowed.has(name.trim()))) throw new Error('该 TikZ 库尚未内置，请使用常用几何绘图库');
    return '';
  }).trim();
  if (/\\usetikzlibrary\b/.test(safe)) throw new Error('TikZ 库声明格式无效');
  const first = safe.indexOf('\\begin');
  const end = safe.lastIndexOf('\\end{tikzpicture}');
  if (first !== 0 || end < 0 || safe.slice(end + '\\end{tikzpicture}'.length).trim()) throw new Error('请只填写一个完整的 tikzpicture 绘图块');
  return safe;
}

const tags = new Set(['svg', 'g', 'defs', 'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text', 'tspan', 'use', 'symbol', 'clipPath', 'linearGradient', 'radialGradient', 'stop', 'pattern', 'marker', 'title', 'desc']);
const attributes = new Set(['id', 'class', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'd', 'points', 'transform', 'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity', 'opacity', 'clip-path', 'clip-rule', 'clipPathUnits', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'dx', 'dy', 'rotate', 'gradientUnits', 'gradientTransform', 'offset', 'stop-color', 'stop-opacity', 'patternUnits', 'patternContentUnits', 'patternTransform', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits', 'marker-start', 'marker-mid', 'marker-end']);
const styles = new Set(['fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'clip-path']);
const safeValue = value => !/[<>\\\x00-\x1f]/.test(value) && !/(?:https?:|file:|data:|javascript:|@import|expression|\/\*)/i.test(value) && [...value.matchAll(/url\s*\(([^)]*)\)/gi)].every(match => /^\s*['"]?#[A-Za-z0-9_.:-]+['"]?\s*$/.test(match[1]));

function sanitizeSvg(svg, { fontRoot } = {}) {
  if (typeof svg !== 'string' || Buffer.byteLength(svg) > MAX_SVG || /<!DOCTYPE|<!ENTITY|<\?/i.test(svg)) throw new Error('绘图输出无效或过大');
  const errors = [];
  const document = new DOMParser({ onError: (_level, message) => errors.push(message) }).parseFromString(svg, 'image/svg+xml');
  if (errors.length || document.documentElement?.localName !== 'svg') throw new Error('绘图输出不是完整 SVG');
  const root = document.documentElement;
  const usedFonts = new Set();
  function scan(node) {
    if (node.nodeType === 1) {
      if (!tags.has(node.localName) || (node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/2000/svg')) throw new Error(`绘图含不允许的 SVG 元素：${node.localName}`);
      for (const attribute of Array.from(node.attributes)) {
        const name = attribute.name;
        const value = attribute.value;
        if (name === 'xmlns' || name === 'xmlns:xlink') {
          if (!['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink'].includes(value)) node.removeAttribute(name);
        } else if (name === 'href' || name === 'xlink:href') {
          if (!/^#[A-Za-z0-9_.:-]+$/.test(value)) throw new Error('绘图引用了外部资源');
        } else if (name === 'style') {
          const filtered = value.split(';').flatMap(rule => {
            const separator = rule.indexOf(':');
            const key = rule.slice(0, separator).trim().toLowerCase();
            const content = rule.slice(separator + 1).trim();
            if (separator < 0 || !styles.has(key) || !safeValue(content)) return [];
            if (key === 'font-family') usedFonts.add(content.replace(/['"]/g, '').trim());
            return [`${key}:${content}`];
          }).join(';');
          if (filtered) node.setAttribute('style', filtered); else node.removeAttribute(name);
        } else if (!attributes.has(name) || !safeValue(value)) node.removeAttribute(name);
        else if (name === 'font-family') usedFonts.add(value.replace(/['"]/g, '').trim());
      }
    } else if (![3, 9].includes(node.nodeType)) {
      node.parentNode?.removeChild(node);
      return;
    }
    for (const child of Array.from(node.childNodes)) scan(child);
  }
  scan(root);
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const viewBox = root.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
  if (viewBox.length !== 4 || viewBox.some(value => !Number.isFinite(value)) || viewBox[2] <= 0 || viewBox[3] <= 0 || viewBox[2] > 100000 || viewBox[3] > 100000) throw new Error('绘图尺寸无效');
  if (fontRoot && usedFonts.size) {
    const css = [];
    for (const font of usedFonts) {
      if (!/^[a-z][a-z0-9]{0,30}$/.test(font)) throw new Error('绘图字体无效');
      const file = path.join(fontRoot, `${font}.ttf`);
      if (!fs.existsSync(file)) throw new Error(`缺少内置绘图字体 ${font}`);
      const bytes = fs.readFileSync(file);
      if (bytes.length > 200 * 1024) throw new Error('绘图字体文件过大');
      css.push(`@font-face{font-family:${font};src:url(data:font/ttf;base64,${bytes.toString('base64')}) format('truetype');font-weight:normal;font-style:normal}`);
    }
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.appendChild(document.createTextNode(css.join('\n')));
    defs.appendChild(style);
    root.insertBefore(defs, root.firstChild);
  }
  const result = new XMLSerializer().serializeToString(root);
  if (Buffer.byteLength(result) > MAX_SVG) throw new Error('绘图结果超过 3 MB，请简化绘图');
  return { svg: result, width: viewBox[2], height: viewBox[3] };
}

module.exports = { checkedTikz, sanitizeSvg, libraries, MAX_SOURCE, MAX_SVG };
