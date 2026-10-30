import type { Exam, Question, QType } from './types';

export interface BookNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: BookNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}
export interface BookChapter { id: string; title: string; kind: 'cover' | 'preface' | 'chapter'; content: BookNode }
export interface BookSettings {
  paper: 'A4' | 'A5' | 'B5'; marginTop: number; marginBottom: number; marginInner: number; marginOuter: number;
  fontFamily: string; fontSize: number; lineHeight: number; paragraphGap: number; questionGap: number;
  numbering: 'chapter' | 'book'; answers: 'book' | 'chapter' | 'inline' | 'none';
  toc: boolean; pageNumbers: boolean; header: string; footer: string; chapterNewPage: boolean;
}
export interface BookProject {
  version: 1; kind: 'juanye-book'; id: string; title: string; author: string;
  chapters: BookChapter[]; questions: Record<string, Question>; settings: BookSettings;
}
export const DEFAULT_BOOK_SETTINGS: Readonly<BookSettings> = Object.freeze({
  paper: 'B5', marginTop: 17, marginBottom: 17, marginInner: 20, marginOuter: 16,
  fontFamily: 'Noto Serif SC, SimSun, serif', fontSize: 10.5, lineHeight: 1.65, paragraphGap: 2, questionGap: 3,
  numbering: 'chapter', answers: 'book', toc: true, pageNumbers: true, header: '', footer: '', chapterNewPage: true,
});
export const BOOK_PAPER_MM = { A4: [210, 297], A5: [148, 210], B5: [176, 250] } as const;
export const newBookId = () => crypto.randomUUID();
export const blankBookContent = (): BookNode => ({ type: 'doc', content: [{ type: 'paragraph' }] });
export function createBlankBook(): BookProject {
  return { version: 1, kind: 'juanye-book', id: newBookId(), title: '未命名教辅', author: '', settings: { ...DEFAULT_BOOK_SETTINGS }, questions: {}, chapters: [
    { id: newBookId(), title: '封面', kind: 'cover', content: blankBookContent() },
    { id: newBookId(), title: '第一章', kind: 'chapter', content: blankBookContent() },
  ] };
}
export function bookQuestionIds(node: BookNode): string[] {
  return [...(node.type === 'bookQuestion' && typeof node.attrs?.questionId === 'string' ? [node.attrs.questionId] : []), ...(node.content ?? []).flatMap(bookQuestionIds)];
}
export function bookQuestionNumbers(book: BookProject): Map<string, { number: number; label: string; chapterId: string }> {
  const result = new Map<string, { number: number; label: string; chapterId: string }>();
  let global = 0, chapterNumber = 0, frontMatterNumber = 0;
  for (const chapter of book.chapters) {
    if (chapter.kind === 'chapter') chapterNumber++; else frontMatterNumber++;
    let local = 0;
    for (const id of bookQuestionIds(chapter.content)) {
      global++; local++;
      const number = book.settings.numbering === 'book' ? global : local;
      const prefix = chapter.kind === 'chapter' ? String(chapterNumber) : `前置${frontMatterNumber}`;
      result.set(id, { number, label: book.settings.numbering === 'book' ? String(global) : `${prefix}.${local}`, chapterId: chapter.id });
    }
  }
  return result;
}
export function insertBookQuestions(book: BookProject, chapterId: string, questions: Question[]): BookProject {
  if (!questions.length) return book;
  if (!book.chapters.some(chapter => chapter.id === chapterId)) throw Error('目标章节不存在');
  if (Object.keys(book.questions).length + questions.length > 10000) throw Error('单册最多支持10000道题，请分册编排');
  const copied = questions.map(question => ({ ...structuredClone(question), id: newBookId() }));
  return { ...book, questions: { ...book.questions, ...Object.fromEntries(copied.map(question => [question.id, question])) }, chapters: book.chapters.map(chapter => chapter.id === chapterId ? { ...chapter, content: { ...chapter.content, content: [...(chapter.content.content ?? []), ...copied.map(question => ({ type: 'bookQuestion', attrs: { questionId: question.id } }))] } } : chapter) };
}
export function copyExamIntoBook(exam: Exam): BookProject {
  let book = createBlankBook();
  book = { ...book, title: `${exam.title} · 教辅`, chapters: [book.chapters[0], ...exam.sections.map(section => ({ id: newBookId(), title: section.title, kind: 'chapter' as const, content: blankBookContent() }))] };
  for (let i = 0; i < exam.sections.length; i++) book = insertBookQuestions(book, book.chapters[i + 1].id, exam.sections[i].questions);
  return book;
}

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label}格式无效`);
  return value as Record<string, unknown>;
};
const text = (value: unknown, label: string, max = 200000): string => { if (typeof value !== 'string' || value.length > max) throw Error(`${label}内容无效或过长`); return value; };
const id = (value: unknown, label: string) => { const result = text(value, label, 200); if (!result || ['__proto__','prototype','constructor'].includes(result)) throw Error(`${label}为空或无效`); return result; };
const numeric = (value: unknown, label: string, min: number, max: number): number => { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw Error(`${label}必须在${min}至${max}之间`); return value; };
function choice<T extends string>(value: unknown, values: readonly T[], label: string): T { if (!values.includes(value as T)) throw Error(`${label}无效`); return value as T; }
const bool = (value: unknown, label: string): boolean => { if (typeof value !== 'boolean') throw Error(`${label}必须为开关值`); return value; };
export function isBookImage(value: unknown): value is string { return typeof value === 'string' && value.length <= 40 * 1024 * 1024 && /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(value); }
function picture(value: unknown) { if (!isBookImage(value)) throw Error('图片必须是项目内嵌的PNG、JPEG、GIF或WebP，不可引用外部文件'); return value; }
function stringList(value: unknown, label: string, limit: number, max = 200000): string[] {
  if (!Array.isArray(value) || value.length > limit) throw Error(`${label}列表无效`);
  return value.map(item => text(item, label, max));
}
function checkedQuestion(raw: unknown, key: string): Question {
  const q = record(raw, '题目');
  if (id(q.id, '题目ID') !== key) throw Error('题目ID与索引不一致');
  const result: Question = { id: key, type: choice<QType>(q.type, ['single','multi','judge','blank','essay','material','custom'], '题型'), score: numeric(q.score, '分值', 0, 1000), stem: text(q.stem, '题干'), options: stringList(q.options, '选项', 26), answer: stringList(q.answer, '答案', 200), analysis: text(q.analysis, '解析') };
  for (const field of ['source','flag','drawing'] as const) if (q[field] !== undefined) result[field] = text(q[field], field, field === 'drawing' ? 32768 : 2000);
  if (q.knowledge !== undefined) result.knowledge = stringList(q.knowledge, '知识点', 100, 200);
  if (q.difficulty !== undefined) result.difficulty = choice(q.difficulty, ['easy','medium','hard'] as const, '难度');
  if (q.image !== undefined) result.image = choice(q.image, ['plot'] as const, '示意图');
  for (const field of ['sourceImage','figure'] as const) if (q[field] !== undefined) result[field] = picture(q[field]);
  if (q.pageBreakBefore !== undefined) result.pageBreakBefore = bool(q.pageBreakBefore, '题前分页');
  if (q.importNumber !== undefined) result.importNumber = numeric(q.importNumber, '原题号', 1, 100000);
  for (const field of ['answerSpace','paperAnswerSpace'] as const) if (q[field] !== undefined) result[field] = choice(q[field], ['auto','quarter','half','full'] as const, '作答区');
  if (q.bankOrigin !== undefined) { const origin = record(q.bankOrigin, '题库来源'); const version = numeric(origin.version, '版本', 1, 10000); if (!Number.isInteger(version)) throw Error('版本无效'); result.bankOrigin = { libraryId: id(origin.libraryId, '库题ID'), revisionId: id(origin.revisionId, '修订ID'), version }; }
  if (q.figures !== undefined) {
    if (!Array.isArray(q.figures) || q.figures.length > 8) throw Error('单题图片最多8张');
    const figureIds = new Set<string>();
    result.figures = q.figures.map(value => { const figure = record(value, '题图'), figureId = id(figure.id, '题图ID'); if (figureIds.has(figureId)) throw Error('题图ID重复'); figureIds.add(figureId); return { id: figureId, src: picture(figure.src), layout: choice(figure.layout, ['right','half','full'], '题图布局'), ...(figure.caption === undefined ? {} : { caption: text(figure.caption, '图注', 2000) }), ...(figure.width === undefined ? {} : { width: numeric(figure.width, '题图宽度', 15, 100) }), ...(figure.maxHeight === undefined ? {} : { maxHeight: numeric(figure.maxHeight, '题图高度', 50, 800) }) }; });
  }
  return result;
}

const NODE_TYPES = new Set(['doc','paragraph','text','heading','bulletList','orderedList','listItem','blockquote','hardBreak','horizontalRule','table','tableRow','tableCell','tableHeader','image','inlineMath','blockMath','bookQuestion','callout','pageBreak']);
const MARK_TYPES = new Set(['bold','italic','strike','underline','code','textStyle']);
const BLOCK_TYPES = new Set(['paragraph','heading','bulletList','orderedList','blockquote','horizontalRule','table','image','blockMath','bookQuestion','callout','pageBreak']);
const INLINE_TYPES = new Set(['text','inlineMath','hardBreak']);
/** Reject active HTML/style/resource payloads; renderer uses this structured
 * model only, never arbitrary imported HTML. */
export function validateBookProject(raw: unknown): BookProject {
  const input = record(raw, '书稿');
  if (input.version !== 1 || input.kind !== 'juanye-book') throw Error('不是受支持的卷页教辅项目');
  const settings = record(input.settings, '排版');
  const checkedSettings: BookSettings = {
    paper: choice(settings.paper, ['A4','A5','B5'], '纸张'),
    marginTop: numeric(settings.marginTop, '上边距', 5, 45), marginBottom: numeric(settings.marginBottom, '下边距', 5, 45), marginInner: numeric(settings.marginInner, '装订侧边距', 5, 45), marginOuter: numeric(settings.marginOuter, '外侧边距', 5, 45),
    fontFamily: text(settings.fontFamily, '字体', 200), fontSize: numeric(settings.fontSize, '字号', 7, 30), lineHeight: numeric(settings.lineHeight, '行距', 1, 3), paragraphGap: numeric(settings.paragraphGap, '段距', 0, 30), questionGap: numeric(settings.questionGap, '题距', 0, 30),
    numbering: choice(settings.numbering, ['chapter','book'], '编号'), answers: choice(settings.answers, ['book','chapter','inline','none'], '答案位置'), toc: bool(settings.toc, '目录'), pageNumbers: bool(settings.pageNumbers, '页码'), header: text(settings.header, '页眉', 500), footer: text(settings.footer, '页脚', 500), chapterNewPage: bool(settings.chapterNewPage, '章节另起页'),
  };
  if (!/^[\p{L}\p{N}\s,.'"_-]+$/u.test(checkedSettings.fontFamily)) throw Error('字体名称包含不支持的字符');
  const questionsRaw = record(input.questions, '题目表');
  if (Object.keys(questionsRaw).length > 10000) throw Error('单册最多10000道题');
  const questions = Object.fromEntries(Object.entries(questionsRaw).map(([key, value]) => [id(key, '题目ID'), checkedQuestion(value, key)]));
  if (!Array.isArray(input.chapters) || input.chapters.length < 1 || input.chapters.length > 1000) throw Error('书稿需要1至1000个章节');
  const chapterIds = new Set<string>(), references = new Set<string>(); let nodeCount = 0;
  const node = (rawNode: unknown, depth: number): BookNode => {
    if (depth > 40 || ++nodeCount > 300000) throw Error('书稿结构过深或内容过多');
    const source = record(rawNode, '内容块'), type = text(source.type, '块类型', 100);
    if (!NODE_TYPES.has(type)) throw Error(`不支持的内容块：${type}`);
    const result: BookNode = { type };
    if (source.text !== undefined) { if (type !== 'text') throw Error('文本节点格式无效'); result.text = text(source.text, '段落'); }
    if (source.attrs !== undefined) {
      const attrs = record(source.attrs, '内容属性'), out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null) { out[key] = null; continue; }
        if (key === 'questionId' && type === 'bookQuestion') { const qid = id(value, '引用题目'); if (!questions[qid] || references.has(qid)) throw Error('引用题目缺失或重复，请使用插入题目重新复制'); references.add(qid); out[key] = qid; }
        else if (key === 'latex' && ['inlineMath','blockMath'].includes(type)) out[key] = text(value, '公式', 32768);
        else if (key === 'src' && type === 'image') out[key] = picture(value);
        else if (['alt','title','caption'].includes(key) && type === 'image') out[key] = text(value, '图片说明', 2000);
        else if (key === 'align' && type === 'image') out[key] = choice(value, ['left','right','center'], '图片布局');
        else if (key === 'width' && type === 'image') out[key] = numeric(value, '图片宽度百分比', 15, 100);
        else if (key === 'height' && type === 'image') out[key] = numeric(value, '图片高度', 10, 2000);
        else if (key === 'kind' && type === 'callout') out[key] = choice(value, ['lesson','example','practice','hint'], '教辅块');
        else if (key === 'level' && type === 'heading') out[key] = numeric(value, '标题层级', 1, 6);
        else if (key === 'start' && type === 'orderedList') out[key] = numeric(value, '列表起始值', 1, 100000);
        else if (['spaceBefore','spaceAfter'].includes(key)) out[key] = numeric(value, '块间距', 0, 80);
        else if (['keepTogether','pageBreakBefore'].includes(key)) out[key] = bool(value, '分页约束');
        else if (key === 'textAlign') out[key] = choice(value, ['left','right','center','justify'], '文字对齐');
        else if (['colspan','rowspan'].includes(key) && ['tableCell','tableHeader'].includes(type)) out[key] = numeric(value, '表格合并', 1, 100);
        else if (key === 'colwidth' && ['tableCell','tableHeader'].includes(type) && Array.isArray(value) && value.length <= 100) out[key] = value.map(width => numeric(width, '列宽', 10, 2000));
        else throw Error(`不支持的内容属性：${key}`);
      }
      result.attrs = out;
    }
    if (type === 'bookQuestion' && typeof result.attrs?.questionId !== 'string') throw Error('题目引用缺少ID');
    if (type === 'image' && !isBookImage(result.attrs?.src)) throw Error('图片内容无效');
    if (['inlineMath','blockMath'].includes(type) && typeof result.attrs?.latex !== 'string') throw Error('公式缺少LaTeX');
    if (source.content !== undefined) { if (!Array.isArray(source.content)) throw Error('内容列表无效'); result.content = source.content.map(child => node(child, depth + 1)); }
    const children = result.content ?? [];
    if (['paragraph','heading'].includes(type) && children.some(child => !INLINE_TYPES.has(child.type))) throw Error('段落或标题只能包含文字与行内公式');
    if (['doc','blockquote','callout','tableCell','tableHeader','listItem'].includes(type) && children.some(child => !BLOCK_TYPES.has(child.type))) throw Error('正文块层级无效，请检查导入内容');
    if (['bulletList','orderedList'].includes(type) && (!children.length || children.some(child => child.type !== 'listItem'))) throw Error('列表必须包含列表项');
    if (type === 'listItem' && children[0]?.type !== 'paragraph') throw Error('列表项必须从段落开始');
    if (type === 'table' && (!children.length || children.some(child => child.type !== 'tableRow'))) throw Error('表格必须包含有效表格行');
    if (type === 'tableRow' && (!children.length || children.some(child => !['tableCell','tableHeader'].includes(child.type)))) throw Error('表格行必须包含单元格');
    if (['tableCell','tableHeader','callout','blockquote'].includes(type) && !children.length) throw Error('容器内容不能为空');
    if (['text','inlineMath','blockMath','hardBreak','horizontalRule','image','bookQuestion','pageBreak'].includes(type) && children.length) throw Error('独立内容节点不能包含子内容');
    if (type === 'text' && (typeof result.text !== 'string' || !result.text.length)) throw Error('文字节点缺少文本');
    for (const key of ['level','start','colspan','rowspan']) if (result.attrs?.[key] != null && !Number.isInteger(result.attrs[key])) throw Error('标题、列表与表格的序号必须是整数');
    if (source.marks !== undefined) {
      if (!Array.isArray(source.marks) || source.marks.length > 20) throw Error('文字样式过多');
      result.marks = source.marks.map(value => {
        const mark = record(value, '文字样式'), markType = text(mark.type, '样式类型', 100); if (!MARK_TYPES.has(markType)) throw Error('不支持的文字样式');
        const out: { type: string; attrs?: Record<string, unknown> } = { type: markType };
        if (mark.attrs !== undefined) { const attrs = record(mark.attrs, '文字样式属性'); out.attrs = {};
          for (const [key,value] of Object.entries(attrs)) {
            if (value === undefined || value === null) { out.attrs[key] = null; continue; }
            if (key === 'href' && markType === 'link') { const href = text(value, '链接', 2000); if (!/^(https?:\/\/|mailto:|#[A-Za-z0-9_-])/.test(href)) throw Error('链接协议不受支持'); out.attrs[key] = href; }
            else if (['target','rel'].includes(key) && markType === 'link') out.attrs[key] = key === 'target' ? '_blank' : 'noopener noreferrer';
            else if (key === 'color' && ['textStyle','highlight'].includes(markType) && /^#[0-9a-f]{3,8}$/i.test(String(value))) out.attrs[key] = value;
            else if (key === 'fontSize' && markType === 'textStyle' && /^\d{1,2}(?:\.\d)?(?:pt|px)$/.test(String(value))) out.attrs[key] = value;
            else if (key === 'fontFamily' && markType === 'textStyle' && /^[\p{L}\p{N}\s,.'"_-]{1,200}$/u.test(String(value))) out.attrs[key] = value;
            else throw Error(`不支持的文字样式属性：${key}`);
          }
        }
        return out;
      });
    }
    return result;
  };
  const chapters = input.chapters.map(value => {
    const chapter = record(value, '章节'), chapterId = id(chapter.id, '章节ID'); if (chapterIds.has(chapterId)) throw Error('章节ID重复'); chapterIds.add(chapterId);
    const content = node(chapter.content, 0); if (content.type !== 'doc') throw Error('章节内容必须是文档');
    return { id: chapterId, title: text(chapter.title, '章节标题', 1000), kind: choice(chapter.kind, ['cover','preface','chapter'], '章节类型'), content };
  });
  return { version: 1, kind: 'juanye-book', id: id(input.id, '书稿ID'), title: text(input.title, '书名', 1000), author: text(input.author, '作者', 1000), settings: checkedSettings, questions, chapters };
}
