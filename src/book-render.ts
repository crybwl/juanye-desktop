import katex from 'katex';
import type { BookProject, BookNode } from './book-model';
import { bookQuestionNumbers } from './book-model';
import type { Question } from './types';
import { mathSegments, renderMathText } from './math';
import { drawingSegments, extractTikzBlocks, stripTikzBlocks } from './drawing';

export interface BookRenderDocument { html: string; css: string; warnings: string[]; errors: string[]; drawings: { id: string; code: string }[] }
export const BOOK_PAPER_MM = { A4: [210, 297], A5: [148, 210], B5: [176, 250] } as const;
const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const cssString = (value: string) => `"${value.replace(/[\\"\n\r\f]/g, value => value === '"' ? '\\"' : value === '\\' ? '\\\\' : ' ')}"`;
const fontList = (value: string) => value.split(',').map(item => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean).map(item => /^(?:serif|sans-serif|monospace)$/i.test(item) ? item : cssString(item)).join(',');
const finite = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const dataImage = (value: unknown): value is string => typeof value === 'string' && /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(value);
const idFor = (value: string) => `bk-${encodeURIComponent(value).replace(/%/g, '_')}`;
const formulaValidation = new Map<string, boolean>();
function validFormula(latex: string) {
  const hit = formulaValidation.get(latex); if (hit !== undefined) return hit;
  let valid = true; try { katex.renderToString(latex, { throwOnError: true, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 }); } catch { valid = false; }
  formulaValidation.set(latex, valid); if (formulaValidation.size > 1024) formulaValidation.delete(formulaValidation.keys().next().value!);
  return valid;
}

/** One safe, semantic HTML projection is shared by chapter preview and full PDF.
 * No imported HTML, remote media, raw CSS, or model-generated script is run. */
export function buildBookDocument(book: BookProject, chapterId?: string): BookRenderDocument {
  const warnings: string[] = [], errors: string[] = [], drawings: BookRenderDocument['drawings'] = [];
  const numbers = bookQuestionNumbers(book);
  const headingIds = new Map<BookNode, string>();
  const headings = new Map<string, { id: string; title: string; level: number }[]>();
  const headingText = (node: BookNode): string => node.type === 'text' ? node.text || '' : node.type === 'inlineMath' ? String(node.attrs?.latex || '') : (node.content || []).map(headingText).join('');
  for (const chapter of book.chapters) {
    const items: { id: string; title: string; level: number }[] = [];
    const visit = (node: BookNode) => {
      if (node.type === 'heading') { const id = `${idFor(chapter.id)}-heading-${items.length + 1}`; headingIds.set(node, id); items.push({ id, title: headingText(node), level: finite(node.attrs?.level, 1, 6, 2) }); }
      node.content?.forEach(visit);
    };
    visit(chapter.content); headings.set(chapter.id, items);
  }
  const s = book.settings;
  const chapters = chapterId ? book.chapters.filter(chapter => chapter.id === chapterId) : book.chapters;
  const addWarning = (value: string) => { if (!warnings.includes(value)) warnings.push(value); };
  const addError = (value: string) => { if (!errors.includes(value)) errors.push(value); };
  const text = (value: string) => drawingSegments(value).map(segment => {
    if (segment.kind === 'text') {
      const html = renderMathText(segment.text);
      if (html.includes('katex-error') || mathSegments(segment.text).some(part => part.math && !validFormula(part.text))) addError('存在无法渲染的公式，请核对后导出。');
      return html;
    }
    const id = `drawing-${drawings.length}`; drawings.push({ id, code: segment.code });
    return `<figure class="book-drawing" data-book-drawing="${id}"></figure>`;
  }).join('');
  const formula = (latex: string, display: boolean) => {
    if (!validFormula(latex)) { addError(`公式待校对：${latex.slice(0, 50)}`); return `<span class="book-media-error">${esc(latex)}</span>`; }
    const html = katex.renderToString(latex, { displayMode: display, throwOnError: false, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 });
    if (html.includes('katex-error')) addError(`公式待校对：${latex.slice(0, 50)}`);
    return html;
  };
  const blockStyle = (attrs: BookNode['attrs'], extra: string[] = []) => {
    attrs ??= {};
    const styles: string[] = [...extra];
    if (typeof attrs.spaceBefore === 'number') styles.push(`margin-top:${finite(attrs.spaceBefore, 0, 80, 0)}pt`);
    if (typeof attrs.spaceAfter === 'number') styles.push(`margin-bottom:${finite(attrs.spaceAfter, 0, 80, 0)}pt`);
    if (attrs.keepTogether === true) styles.push('break-inside:avoid');
    if (attrs.keepTogether === false) styles.push('break-inside:auto');
    if (attrs.pageBreakBefore === true) styles.push('break-before:page');
    if (['left', 'center', 'right', 'justify'].includes(String(attrs.textAlign))) styles.push(`text-align:${attrs.textAlign}`);
    return styles.length ? ` style="${styles.join(';')}"` : '';
  };
  const media = (src: unknown, caption: string, width = 100, align = 'center') => {
    if (!dataImage(src)) { addError(`图片缺失或不是内置图片${caption ? `：${caption}` : ''}`); return '<span class="book-media-error">[图片缺失]</span>'; }
    const placement = align === 'right' ? 'float:right;margin-left:4mm' : align === 'left' ? 'float:left;margin-right:4mm' : 'margin-left:auto;margin-right:auto';
    return `<figure class="book-image" style="width:${finite(width, 15, 100, 100)}%;${placement}"><img src="${esc(src)}" alt="${esc(caption)}"/>${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`;
  };
  const solution = (qid: string, question: Question) => `<section class="book-solution" data-book-solution="${esc(qid)}"><b>${esc(numbers.get(qid)?.label ?? '?')}.</b> <strong>答案：</strong>${text(question.answer.join('；') || '待补充')}${question.analysis.trim() ? `<div class="book-analysis"><strong>解析：</strong>${text(question.analysis)}</div>` : ''}</section>`;
  const questionHtml = (qid: string, attrs: BookNode['attrs']) => {
    const q = book.questions[qid];
    if (!q) { addError(`缺少题目 ${qid}`); return '<p class="book-media-error">[题目缺失]</p>'; }
    const label = numbers.get(qid)?.label ?? '?';
    const prefix = /^\s*(?:(?:\*\*|__)?\s*(?:第\s*\d{1,3}\s*题\s*[.．、:：]?|\d{1,3}\s*[.．、](?!\d))\s*(?:\*\*|__)?)\s*/;
    const figures = q.figures?.length ? q.figures : q.figure ? [{ src: q.figure, caption: '', width: 35, layout: 'right' }] : [];
    const rightWidth = Math.max(15, ...figures.filter(figure => figure.layout === 'right').map(figure => finite(figure.width, 15, 100, 35)), ...(q.drawing || q.image || extractTikzBlocks(q.stem).length ? [35] : []));
    const codes = [...extractTikzBlocks(q.stem), ...(q.drawing?.trim() ? [q.drawing] : [])];
    const right = figures.filter(figure => figure.layout === 'right').map(figure => media(figure.src, figure.caption || '', 100));
    const below = figures.filter(figure => figure.layout !== 'right').map(figure => media(figure.src, figure.caption || '', finite(figure.width, 15, 100, figure.layout === 'half' ? 48 : 100)));
    for (const code of codes) { const id = `drawing-${drawings.length}`; drawings.push({ id, code }); right.push(`<figure class="book-drawing" data-book-drawing="${id}"></figure>`); }
    if (q.image === 'plot') right.push(plotSvg());
    const body = `<article class="book-question" id="${idFor(qid)}" data-book-question="${esc(qid)}"${blockStyle(attrs)}>${right.length ? `<div class="book-question-figures" style="width:${rightWidth}%">${right.join('')}</div>` : ''}<div class="book-stem"><b class="book-question-number">${esc(label)}.</b> ${text(stripTikzBlocks(q.stem).replace(prefix, ''))}</div>${q.options.length ? `<div class="book-options">${q.options.map((option, i) => `<div><b>${String.fromCharCode(65 + i)}.</b> ${text(option)}</div>`).join('')}</div>` : ''}${below.length ? `<div class="book-question-below">${below.join('')}</div>` : ''}</article>`;
    return body + (s.answers === 'inline' ? solution(qid, q) : '');
  };
  const renderNode = (node: BookNode): string => {
    const attrs = node.attrs || {}, children = () => (node.content || []).map(renderNode).join('');
    switch (node.type) {
      case 'doc': return children();
      case 'text': {
        let html = text(node.text || '');
        for (const mark of node.marks || []) {
          if (mark.type === 'bold') html = `<strong>${html}</strong>`;
          else if (mark.type === 'italic') html = `<em>${html}</em>`;
          else if (mark.type === 'underline') html = `<u>${html}</u>`;
          else if (mark.type === 'strike') html = `<s>${html}</s>`;
          else if (mark.type === 'code') html = `<code>${html}</code>`;
          else if (mark.type === 'subscript') html = `<sub>${html}</sub>`;
          else if (mark.type === 'superscript') html = `<sup>${html}</sup>`;
          else if (mark.type === 'textStyle') {
            const style: string[] = [];
            if (typeof mark.attrs?.fontFamily === 'string') style.push(`font-family:${fontList(mark.attrs.fontFamily)}`);
            if (typeof mark.attrs?.fontSize === 'string' || typeof mark.attrs?.fontSize === 'number') { const size = Number.parseFloat(String(mark.attrs.fontSize)); if (Number.isFinite(size)) style.push(`font-size:${finite(size, 6, 60, 11)}pt`); }
            if (typeof mark.attrs?.color === 'string' && /^#[a-f\d]{3,8}$/i.test(mark.attrs.color)) style.push(`color:${mark.attrs.color}`);
            if (style.length) html = `<span style="${esc(style.join(';'))}">${html}</span>`;
          }
        }
        return html;
      }
      case 'paragraph': return `<p${blockStyle(attrs)}>${children() || '<br/>'}</p>`;
      case 'heading': { const level = finite(attrs.level, 1, 6, 2); return `<h${level} id="${headingIds.get(node) || ''}"${blockStyle(attrs)}>${children()}</h${level}>`; }
      case 'hardBreak': return '<br/>';
      case 'horizontalRule': return '<hr/>';
      case 'bulletList': return `<ul>${children()}</ul>`;
      case 'orderedList': return `<ol start="${finite(attrs.start, 1, 99999, 1)}">${children()}</ol>`;
      case 'listItem': return `<li>${children()}</li>`;
      case 'blockquote': return `<blockquote${blockStyle(attrs)}>${children()}</blockquote>`;
      case 'table': return `<table class="book-table"${blockStyle(attrs)}>${children()}</table>`;
      case 'tableRow': { const content = children(); return node.content?.every(child => child.type === 'tableHeader') ? `<thead><tr>${content}</tr></thead>` : `<tr>${content}</tr>`; }
      case 'tableCell': case 'tableHeader': { const tag = node.type === 'tableHeader' ? 'th' : 'td'; return `<${tag} colspan="${finite(attrs.colspan, 1, 100, 1)}" rowspan="${finite(attrs.rowspan, 1, 100, 1)}">${children()}</${tag}>`; }
      case 'image': { const align=String(attrs.align||'center'),floating=['left','right'].includes(align),width=finite(attrs.width,15,100,100); return `<div class="book-image-block"${blockStyle(attrs,floating?[`float:${align}`,`width:${width}%`,align==='right'?'margin-left:4mm':'margin-right:4mm']:[])}>${media(attrs.src,String(attrs.alt||attrs.title||''),floating?100:width,'center')}</div>`; }
      case 'inlineMath': return formula(String(attrs.latex || ''), false);
      case 'blockMath': return `<div class="book-display-math"${blockStyle(attrs)}>${formula(String(attrs.latex || ''), true)}</div>`;
      case 'bookQuestion': return questionHtml(String(attrs.questionId || ''), attrs);
      case 'pageBreak': return '<div class="book-page-break"></div>';
      case 'callout': { const kinds: Record<string, string> = { lesson: '知识讲解', example: '例题', practice: '练习', hint: '提示' }; const kind = String(attrs.kind || 'lesson'); return `<aside class="book-callout book-callout-${kinds[kind] ? kind : 'lesson'}"${blockStyle(attrs)}><div class="book-callout-title">${kinds[kind] || kinds.lesson}</div>${children()}</aside>`; }
      default: addError(`不支持的内容块：${node.type}`); return children() || esc(node.text || '');
    }
  };
  const answersFor = (chapter: BookProject['chapters'][number]) => [...numbers].filter(([, item]) => item.chapterId === chapter.id).map(([qid]) => solution(qid, book.questions[qid])).join('');
  const toc = !chapterId && s.toc ? `<section class="book-toc"><h1>目录</h1><ol>${book.chapters.filter(chapter => chapter.kind !== 'cover').map(chapter => `<li><a href="#${idFor(chapter.id)}">${esc(chapter.title)}</a></li>${(headings.get(chapter.id) || []).map(item => `<li class="book-toc-subheading" style="padding-left:${Math.min(3, item.level) * 3}mm"><a href="#${item.id}">${esc(item.title)}</a></li>`).join('')}`).join('')}${s.answers === 'book' && numbers.size ? '<li><a href="#book-answers">参考答案与解析</a></li>' : ''}</ol></section>` : '';
  let tocPlaced = false;
  const html = chapters.map(chapter => {
    const preceding = !tocPlaced && chapter.kind !== 'cover' ? toc : ''; if (chapter.kind !== 'cover') tocPlaced = true;
    const title = chapter.kind === 'cover' ? `<div class="book-cover-title">${esc(book.title)}</div>${book.author ? `<div class="book-cover-author">${esc(book.author)}</div>` : ''}` : `<h1 class="book-chapter-title" id="${idFor(chapter.id)}">${esc(chapter.title)}</h1>`;
    const chapterAnswers = s.answers === 'chapter' && chapter.kind === 'chapter' ? answersFor(chapter) : '';
    return `${preceding}<section class="book-chapter${chapter.kind === 'cover' ? ' book-cover' : ''}" data-book-chapter="${esc(chapter.id)}">${title}${renderNode(chapter.content)}${chapterAnswers ? `<section class="book-chapter-answers"><h2>本章参考答案与解析</h2>${chapterAnswers}</section>` : ''}</section>`;
  }).join('') + (!tocPlaced ? toc : '') + (s.answers === 'book' && !chapterId && numbers.size ? `<section class="book-answers" id="book-answers"><h1>参考答案与解析</h1>${chapters.filter(chapter => [...numbers.values()].some(item => item.chapterId === chapter.id)).map(chapter => `<h2>${esc(chapter.title)}</h2>${answersFor(chapter)}`).join('')}</section>` : '');
  if (!html.trim()) addWarning('书稿中没有可排版内容。');
  if (s.answers !== 'none' && [...numbers.keys()].some(id => !book.questions[id]?.answer.some(value => value.trim()))) addWarning('部分题目尚未填写答案。');
  const [width, height] = BOOK_PAPER_MM[s.paper] || BOOK_PAPER_MM.A4;
  const header = s.header ? cssString(s.header.replaceAll('{title}', book.title)) : 'string(bookChapter)';
  const footer = s.footer ? cssString(s.footer.replaceAll('{title}', book.title)) + (s.pageNumbers ? ' " · " counter(page)' : '') : s.pageNumbers ? 'counter(page)' : 'none';
  const css = `@page { size:${width}mm ${height}mm; margin:${s.marginTop}mm ${s.marginOuter}mm ${s.marginBottom}mm ${s.marginInner}mm; @top-center{content:${header};font-size:8pt;color:#666} @bottom-center{content:${footer};font-size:9pt;color:#555} }
@page :left { margin-left:${s.marginOuter}mm;margin-right:${s.marginInner}mm } @page :right{margin-left:${s.marginInner}mm;margin-right:${s.marginOuter}mm}
@page cover { @top-center{content:none} @bottom-center{content:none} }
.book-content{font-family:${fontList(s.fontFamily)},"Microsoft YaHei","SimSun",serif;font-size:${s.fontSize}pt;line-height:${s.lineHeight};color:#161616;overflow-wrap:anywhere}
.book-content *{box-sizing:border-box}.book-content p{margin:0 0 ${s.paragraphGap}mm;orphans:2;widows:2}.book-content h1,.book-content h2,.book-content h3,.book-content h4,.book-content h5,.book-content h6{line-height:1.35;break-after:avoid;page-break-after:avoid}.book-content h1{font-size:1.75em;margin:0 0 7mm}.book-content h2{font-size:1.35em;margin:6mm 0 3mm}.book-content h3{font-size:1.13em;margin:4mm 0 2mm}
.book-chapter{${s.chapterNewPage ? 'break-before:page;' : ''}}.book-chapter:first-child{break-before:auto}.book-chapter-title,.book-toc>h1,.book-answers>h1{string-set:bookChapter content(text)}.book-cover{page:cover;break-after:page;text-align:center;padding-top:42mm}.book-cover-title{font-size:2.6em;line-height:1.5;font-weight:700;margin-bottom:14mm}.book-cover-author{font-size:1.25em;margin-bottom:20mm}
.book-toc,.book-answers{break-before:page}.book-toc{break-after:page}.book-toc ol{padding:0;list-style:none}.book-toc li{padding:2mm 0;border-bottom:.2mm dotted #bbb}.book-toc-subheading{font-size:.9em}.book-toc a{color:inherit;text-decoration:none}.book-toc a::after{content:target-counter(attr(href),page);float:right}
.book-question{display:flow-root;margin:0 0 ${s.questionGap}mm;break-inside:avoid}.book-question-number{padding-right:1.5mm}.book-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.5mm 4mm;margin:2mm 0 0}.book-options>div{min-width:0}.book-question-figures{float:right;width:35%;margin:0 0 2mm 4mm}.book-question-below{clear:both;display:flex;flex-wrap:wrap;gap:3mm}.book-image{break-inside:avoid;margin-top:2mm;margin-bottom:3mm;max-width:100%}.book-image img,.book-drawing img{display:block;max-width:100%;height:auto}.book-image figcaption{font-size:.83em;text-align:center;color:#555;padding-top:1mm}.book-image-block{display:flow-root}.book-drawing{break-inside:avoid;margin:2mm 0}.book-plot{width:100%;height:auto}.book-media-error{color:#a00;border:1px solid #c88;padding:2mm}
.book-callout{padding:3mm 4mm;margin:3mm 0 5mm;border-left:1mm solid #64748b;background:#f4f6f8}.book-callout-title{font-size:.9em;font-weight:700;color:#465063;margin-bottom:2mm;break-after:avoid}.book-callout-example{border-color:#6b7f69}.book-callout-practice{border-color:#96836c}.book-callout-hint{border-color:#8d829f}.book-callout p:last-child{margin-bottom:0}.book-solution{margin:0 0 4mm;break-inside:avoid}.book-analysis{margin-top:1mm}.book-chapter-answers{break-before:page}.book-page-break{break-before:page;height:0}.book-display-math{margin:2mm 0;break-inside:avoid}
.book-table,.book-content .math-table{border-collapse:collapse;width:100%;table-layout:fixed;margin:2mm 0 4mm;font-size:.93em}.book-table td,.book-table th,.book-content .math-table td,.book-content .math-table th{border:.2mm solid #777;padding:1.5mm 2mm;vertical-align:top;overflow-wrap:anywhere}.book-table th,.math-table th{background:#f1f2f4}.book-table thead,.math-table thead{display:table-header-group}.book-table tr,.math-table tr{break-inside:avoid}.book-content .katex{font-size:1.03em}.book-content .katex-display{margin:.3em 0;overflow:visible}.book-content blockquote{border-left:.7mm solid #ccc;padding-left:4mm;margin:3mm 0}.book-content ul,.book-content ol{padding-left:6mm}
`;
  return { html: `<main class="book-content">${html}</main>`, css, warnings, errors, drawings };
}

function plotSvg() {
  const sx = (x: number) => 22 + x / 1.7 * 196, sy = (y: number) => 128 - y / 4 * 120;
  const points: string[] = []; for (let x = 0; x <= Math.atan(4); x += .02) points.push(`${sx(x).toFixed(1)},${sy(Math.tan(x)).toFixed(1)}`);
  return `<svg class="book-plot" viewBox="0 0 230 150" fill="none" aria-label="函数图像"><path d="M22 128H224M22 134V8" stroke="#222"/><polyline points="${points.join(' ')}" stroke="#222" stroke-width="1.4"/><path d="M22 128L218 46.4" stroke="#444" stroke-width="1.4"/><g fill="#222" font-size="10"><text x="10" y="141">O</text><text x="218" y="142">x</text><text x="28" y="14">y</text><text x="155" y="24">y=tan x</text><text x="177" y="68">y=ax</text></g></svg>`;
}
