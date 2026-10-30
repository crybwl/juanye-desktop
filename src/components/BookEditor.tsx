import { Extension, InputRule, Node, mergeAttributes, nodePasteRule, type Editor as TiptapEditor, type JSONContent } from "@tiptap/core";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import Color from "@tiptap/extension-color";
import { Fragment, Slice, type Node as ProseNode } from "@tiptap/pm/model";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight, Bold, Braces, ImagePlus, Italic, List, ListOrdered, Pilcrow, Plus, SeparatorHorizontal, Sigma, Table2, Underline, GripVertical, Trash2, ChevronDown, Undo2, Redo2 } from "lucide-react";
import { bookQuestionIds, isBookImage, type BookChapter, type BookNode } from "../book-model";
import { BookQuestionStore as QuestionStore } from "../book-editor-store";
import type { Question } from "../types";
import { MathText } from "../math";
import { TYPE_META } from "../data";
import { Button, Modal, inputCls } from "../ui";
import { Select } from "./Select";
import { FigureEditor } from "./FigureEditor";
import { DrawingEditor } from "./DrawingEditor";
import { questionFigures, hasOptions } from "../figures";
import { fillQuestionOptions } from "../question-options";
import "./book-editor.css";

export interface BookEditorHandle { focus(): void; flush(): void; insertQuestions(ids: string[]): void }
export interface BookEditorProps {
  chapter: BookChapter; questions: Record<string, Question>; numbers: Record<string, string>;
  onChange(content: BookNode): void; onQuestionChange(id: string, patch: Partial<Question>): void;
  onInsertQuestions?(): void; onCloneQuestion?(id: string): string | undefined; active?: boolean;
}

function QuestionView({ node, editor, getPos, selected, extension, deleteNode }: NodeViewProps) {
  const store = (extension.options as { store: QuestionStore }).store, id = String(node.attrs.questionId || '');
  const subscribe = useCallback((notify: () => void) => store.subscribe(id, notify), [store, id]);
  const snapshot = useCallback(() => store.get(id), [store, id]);
  const value = useSyncExternalStore(subscribe, snapshot, snapshot), question = value?.question;
  const select = () => { const pos = getPos(); if (typeof pos === 'number') editor.chain().focus().setNodeSelection(pos).run(); };
  const patch = (value: Partial<Question>) => store.onChange(id, value);
  const commitStem = (stem: string) => { const current = store.get(id)?.question; if (!current) return; const filled = fillQuestionOptions({ ...current, stem }); patch({ stem: filled.stem, options: filled.options, type: filled.type }); };
  const [figuresOpen, setFiguresOpen] = useState(false);
  if (!question) return <NodeViewWrapper className="book-question-missing" contentEditable={false}>题目快照不存在<Button size="sm" onClick={deleteNode}>移除引用</Button></NodeViewWrapper>;
  const figures = questionFigures(question);
  return <NodeViewWrapper as="section" contentEditable={false} className={`book-question-node${selected ? ' is-selected' : ''}`} data-book-question={id} data-selected={selected || undefined} style={{ marginTop: node.attrs.spaceBefore == null ? undefined : `${Number(node.attrs.spaceBefore)}pt`, marginBottom: node.attrs.spaceAfter == null ? undefined : `${Number(node.attrs.spaceAfter)}pt` }}>
    <div className="book-question-meta"><span className="book-question-number">{value?.number || '·'}</span><span>{TYPE_META[question.type].label}</span><span>{question.score} 分</span><div className="book-question-actions"><span data-drag-handle="" className="book-question-grip" title="拖动题目" aria-label="拖动题目"><GripVertical size={14}/></span><button type="button" title="删除题目块" aria-label={`删除题目 ${value?.number || ''}`} onClick={deleteNode}><Trash2 size={13}/></button></div></div>
    {!selected ? <div className="book-question-reading" onClick={select} role="button" tabIndex={0} aria-label={`编辑教辅题目 ${value?.number || ''}`} onKeyDown={event => { if (event.key === 'Enter') select(); }}>
      {figures.filter(figure => figure.layout === 'right').map(figure => <img key={figure.id} src={figure.src} alt={figure.caption || '题图'} className="book-question-figure-right" style={{ width: `${figure.width || 35}%`, maxHeight: figure.maxHeight || 220 }}/>) }
      <MathText text={question.stem || '点击编辑题目'}/>
      {hasOptions(question.type) && <div className="book-question-options">{question.options.map((option, index) => <div key={index}><b>{String.fromCharCode(65 + index)}.</b><MathText text={option}/></div>)}</div>}
      {figures.filter(figure => figure.layout !== 'right').map(figure => <figure key={figure.id} style={{ width: `${figure.width || (figure.layout === 'half' ? 48 : 75)}%` }}><img src={figure.src} alt={figure.caption || '题图'} style={{ maxHeight: figure.maxHeight || 220 }}/>{figure.caption && <figcaption>{figure.caption}</figcaption>}</figure>)}
      {question.drawing && <MathText text={question.drawing}/>}<div className="book-question-clear"/>
    </div> : <div className="book-question-fields">
      <label>题干<textarea aria-label={`教辅题干 ${value?.number || ''}`} value={question.stem} onChange={event => patch({ stem: event.target.value })} onBlur={event => commitStem(event.currentTarget.value)} onPaste={event => { const text = event.clipboardData.getData('text/plain'); if (!text) return; event.preventDefault(); const input = event.currentTarget, start = input.selectionStart, end = input.selectionEnd; commitStem(input.value.slice(0, start) + text + input.value.slice(end)); }} rows={Math.max(2, Math.min(12, question.stem.split('\n').length + 1))}/></label>
      {hasOptions(question.type) && <div className="book-question-option-fields">{question.options.map((option, index) => <label key={index}><span>{String.fromCharCode(65 + index)}</span><textarea aria-label={`教辅选项 ${String.fromCharCode(65 + index)}`} value={option} rows={1} onChange={event => patch({ options: question.options.map((item, i) => i === index ? event.target.value : item) })}/></label>)}<Button size="sm" variant="ghost" onClick={() => patch({ options: [...question.options, ''] })} disabled={question.options.length >= 26}>添加选项</Button></div>}
      <details><summary>答案与解析<ChevronDown size={13}/></summary><label>参考答案<textarea aria-label="教辅参考答案" rows={2} value={question.answer.join('\n')} onChange={event => patch({ answer: event.target.value.split('\n').filter(value => value.trim()) })}/></label><label>解析<textarea aria-label="教辅解析" rows={3} value={question.analysis} onChange={event => patch({ analysis: event.target.value })}/></label></details>
      <details open={figuresOpen} onToggle={event => setFiguresOpen(event.currentTarget.open)}><summary>题图与绘图<ChevronDown size={13}/></summary>{figuresOpen && <><FigureEditor question={question} onChange={patch}/><DrawingEditor value={question.drawing || ''} onChange={drawing => patch({ drawing })}/></>}</details>
      <div className="book-question-attributes"><label>分值<input aria-label="教辅题目分值" type="number" min={0} max={1000} step={0.5} value={question.score} onChange={event => patch({ score: Math.max(0, Math.min(1000, Number(event.target.value) || 0)) })}/></label><label>来源<input aria-label="教辅题目来源" value={question.source || ''} onChange={event => patch({ source: event.target.value })}/></label></div>
      <div className="book-question-live-preview"><MathText text={question.stem}/></div>
    </div>}
  </NodeViewWrapper>;
}

function MathView({ node, getPos, selected, extension }: NodeViewProps) {
  const block = node.type.name === 'blockMath', store = (extension.options as { store: QuestionStore }).store;
  const edit = () => { const position = getPos(); if (typeof position === 'number') store.editMath(String(node.attrs.latex || ''), position, block); };
  return <NodeViewWrapper as={block ? 'div' : 'span'} contentEditable={false} className={`book-math-node${selected ? ' is-selected' : ''}`} data-math-block={block || undefined} title="双击编辑公式" onDoubleClick={edit} onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Enter') edit(); }} tabIndex={0}><MathText text={block ? `\\[${node.attrs.latex}\\]` : `$${node.attrs.latex}$`}/></NodeViewWrapper>;
}
function mathNode(block: boolean, store: QuestionStore) {
  return Node.create({
    name: block ? 'blockMath' : 'inlineMath', group: block ? 'block' : 'inline', inline: !block, atom: true, selectable: true,
    addOptions() { return { store }; },
    addAttributes() { return { latex: { default: '', parseHTML: element => element.getAttribute('data-latex') || '' } }; },
    parseHTML() { return [{ tag: `${block ? 'div' : 'span'}[data-book-math]` }]; },
    renderHTML({ HTMLAttributes }) { return [block ? 'div' : 'span', mergeAttributes(HTMLAttributes, { 'data-book-math': block ? 'block' : 'inline', 'data-latex': HTMLAttributes.latex }), String(HTMLAttributes.latex || '')]; },
    addNodeView() { return ReactNodeViewRenderer(MathView); },
    addInputRules() { return block ? [] : [new InputRule({ find: /(?<![$\\])\$([^$\n]+)\$$/, handler: ({state,range,match}) => { state.tr.replaceWith(range.from,range.to,this.type.create({latex:match[1]})).scrollIntoView(); } })]; },
    addPasteRules() { return block ? [] : [nodePasteRule({ find: /(?<![$\\])\$([^$\n]+)\$(?!\$)/g, type: this.type, getAttributes: match => ({ latex: match[1] }) })]; },
  });
}
const Callout = Node.create({
  name: 'callout', group: 'block', content: 'block+', defining: true,
  addAttributes() { return { kind: { default: 'lesson', parseHTML: element => element.getAttribute('data-callout') || 'lesson' } }; },
  parseHTML() { return [{ tag: 'section[data-callout]' }]; },
  renderHTML({ HTMLAttributes }) { return ['section', mergeAttributes(HTMLAttributes, { 'data-callout': HTMLAttributes.kind }), 0]; },
});
const PageBreak = Node.create({ name: 'pageBreak', group: 'block', atom: true, selectable: true, parseHTML() { return [{ tag: 'div[data-book-page-break]' }]; }, renderHTML() { return ['div', { 'data-book-page-break': '', class: 'book-editor-page-break' }, '分页']; } });
const BookImage = Image.extend({
  parseHTML() { return [{ tag: 'img[src]', getAttrs: element => isBookImage((element as HTMLElement).getAttribute('src')) ? null : false }]; },
  addAttributes() { return { ...this.parent?.(), width: { default: 70, parseHTML: element => Number(element.getAttribute('data-width')) || 70, renderHTML: attrs => ({ 'data-width': attrs.width, style: `width:${Math.max(15, Math.min(100, Number(attrs.width) || 70))}%;` }) }, align: { default: 'center', parseHTML: element => element.getAttribute('data-align') || 'center', renderHTML: attrs => ({ 'data-align': attrs.align }) } }; },
});
const LayoutAttributes = Extension.create({
  name: 'bookLayout',
  addGlobalAttributes() { return [{ types: ['paragraph', 'heading', 'bookQuestion', 'callout', 'image', 'table', 'blockMath'], attributes: {
    spaceBefore: { default: null, parseHTML: element => element.hasAttribute('data-space-before') ? Math.max(0, Math.min(80, Number(element.getAttribute('data-space-before')) || 0)) : null, renderHTML: attrs => attrs.spaceBefore == null ? {} : ({ 'data-space-before': attrs.spaceBefore, style: `margin-top:${Math.max(0, Math.min(80, Number(attrs.spaceBefore) || 0))}pt` }) },
    spaceAfter: { default: null, parseHTML: element => element.hasAttribute('data-space-after') ? Math.max(0, Math.min(80, Number(element.getAttribute('data-space-after')) || 0)) : null, renderHTML: attrs => attrs.spaceAfter == null ? {} : ({ 'data-space-after': attrs.spaceAfter, style: `margin-bottom:${Math.max(0, Math.min(80, Number(attrs.spaceAfter) || 0))}pt` }) },
    keepTogether: { default: null, parseHTML: element => element.hasAttribute('data-keep-together') ? element.getAttribute('data-keep-together') === 'true' : null, renderHTML: attrs => attrs.keepTogether == null ? {} : ({ 'data-keep-together': String(!!attrs.keepTogether) }) },
    pageBreakBefore: { default: false, parseHTML: element => element.getAttribute('data-page-break-before') === 'true', renderHTML: attrs => ({ 'data-page-break-before': String(!!attrs.pageBreakBefore) }) },
  } }]; },
});

function clonePastedNodes(fragment: Fragment, cloneQuestion: BookEditorProps['onCloneQuestion']): Fragment {
  const children: ProseNode[] = [];
  fragment.forEach(node => {
    if (node.type.name === 'bookQuestion') {
      const id = cloneQuestion?.(String(node.attrs.questionId));
      if (id) children.push(node.type.create({ ...node.attrs, questionId: id }));
    } else children.push(node.content.size ? node.copy(clonePastedNodes(node.content, cloneQuestion)) : node);
  });
  return Fragment.fromArray(children);
}
const readImage = (file: File) => new Promise<string>((resolve, reject) => {
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type) || file.size > 10 * 1024 * 1024) { reject(Error('请选择10MB以内的PNG、JPEG、WebP或GIF图片')); return; }
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(Error('图片读取失败')); reader.readAsDataURL(file);
});

function Tool({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick(): void; children: ReactNode }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={onClick} className="book-editor-tool">{children}</button>;
}
function FormattingBar({ editor, insertImage, insertMath, insertQuestions }: { editor: TiptapEditor; insertImage(): void; insertMath(block: boolean): void; insertQuestions?(): void }) {
  const state = useEditorState({ editor, selector: ({ editor }) => ({ bold: editor.isActive('bold'), italic: editor.isActive('italic'), underline: editor.isActive('underline'), bullet: editor.isActive('bulletList'), ordered: editor.isActive('orderedList'), heading: editor.isActive('heading') ? String(editor.getAttributes('heading').level) : 'body', align: editor.getAttributes('paragraph').textAlign || editor.getAttributes('heading').textAlign || 'left', table: editor.isActive('table'), image: editor.isActive('image'), math: editor.isActive('inlineMath') || editor.isActive('blockMath'), undo: editor.can().undo(), redo: editor.can().redo(), layout: JSON.stringify((() => { const selection = editor.state.selection, node = selection.$from.parent; return { type: 'node' in selection ? (selection as unknown as { node: ProseNode }).node.type.name : node.type.name, attrs: 'node' in selection ? (selection as unknown as { node: ProseNode }).node.attrs : node.attrs }; })()) }) });
  const [layoutOpen, setLayoutOpen] = useState(false);
  const current = JSON.parse(state.layout) as { type: string; attrs: Record<string, unknown> };
  const setLayout = (attrs: Record<string, unknown>) => editor.chain().focus().updateAttributes(current.type, attrs).run();
  const applyCallout = (kind: string) => { if (kind === 'plain') editor.chain().focus().lift('callout').run(); else if (editor.isActive('callout')) editor.chain().focus().updateAttributes('callout', { kind }).run(); else editor.chain().focus().wrapIn('callout', { kind }).run(); };
  return <div className="book-editor-toolbar" role="toolbar" aria-label="教辅正文编辑工具">
    <div className="book-editor-tools-row"><Tool label="撤销正文编辑" disabled={!state.undo} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={15}/></Tool><Tool label="重做正文编辑" disabled={!state.redo} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={15}/></Tool><span className="book-tool-divider"/>
      <Select aria-label="正文样式" value={state.heading} onValueChange={value => value === 'body' ? editor.chain().focus().setParagraph().run() : editor.chain().focus().setHeading({ level: Number(value) as 1 | 2 | 3 }).run()} options={[{ value: 'body', label: '正文' }, { value: '1', label: '一级标题' }, { value: '2', label: '二级标题' }, { value: '3', label: '三级标题' }]}/>
      <Tool label="粗体" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15}/></Tool><Tool label="斜体" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15}/></Tool><Tool label="下划线" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={15}/></Tool><span className="book-tool-divider"/>
      <Tool label="左对齐" active={state.align === 'left'} onClick={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft size={15}/></Tool><Tool label="居中" active={state.align === 'center'} onClick={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter size={15}/></Tool><Tool label="右对齐" active={state.align === 'right'} onClick={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight size={15}/></Tool><Tool label="无序列表" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15}/></Tool><Tool label="有序列表" active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15}/></Tool>
    </div>
    <div className="book-editor-tools-row"><Select aria-label="教辅内容块" value={editor.isActive('callout') ? String(editor.getAttributes('callout').kind) : 'plain'} onValueChange={applyCallout} options={[{ value: 'plain', label: '普通内容' }, { value: 'lesson', label: '知识讲解' }, { value: 'example', label: '例题' }, { value: 'practice', label: '练习' }, { value: 'hint', label: '提示' }]}/>
      <Tool label="插入题目" onClick={() => insertQuestions?.()} disabled={!insertQuestions}><Plus size={15}/></Tool><Tool label="插入图片" onClick={insertImage}><ImagePlus size={15}/></Tool><Tool label="插入行内公式" onClick={() => insertMath(false)}><Sigma size={15}/></Tool><Tool label="插入独立公式" onClick={() => insertMath(true)}><Braces size={15}/></Tool><Tool label="插入表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 size={15}/></Tool><Tool label="插入分页" onClick={() => editor.chain().focus().insertContent({ type: 'pageBreak' }).run()}><SeparatorHorizontal size={15}/></Tool><Tool label="当前块排版" active={layoutOpen} onClick={() => setLayoutOpen(value => !value)}><Pilcrow size={15}/></Tool>
      {state.math && <Button size="sm" variant="ghost" onClick={() => insertMath(editor.isActive('blockMath'))}>编辑公式</Button>}
      {state.table && <><Button size="sm" variant="ghost" onClick={() => editor.chain().focus().addRowAfter().run()}>加行</Button><Button size="sm" variant="ghost" onClick={() => editor.chain().focus().addColumnAfter().run()}>加列</Button><Button size="sm" variant="ghost" onClick={() => editor.chain().focus().deleteRow().run()}>删行</Button><Button size="sm" variant="ghost" onClick={() => editor.chain().focus().deleteColumn().run()}>删列</Button><Button size="sm" variant="ghost" onClick={() => editor.chain().focus().deleteTable().run()}>删表</Button></>}
      {state.image && <><label className="book-image-width">图片宽度<input aria-label="正文图片宽度" type="number" min={15} max={100} value={editor.getAttributes('image').width || 70} onChange={event => editor.chain().focus().updateAttributes('image', { width: Math.max(15, Math.min(100, Number(event.target.value) || 70)) }).run()}/>%</label><Select aria-label="正文图片排列" value={editor.getAttributes('image').align || 'center'} onValueChange={align => editor.chain().focus().updateAttributes('image', { align }).run()} options={[{ value: 'left', label: '居左' }, { value: 'center', label: '居中' }, { value: 'right', label: '右侧绕排' }]}/></>}
    </div>
    {layoutOpen && <div className="book-editor-layout-row"><label>块前间距<input aria-label="块前间距" type="number" min={0} max={80} value={Number(current.attrs.spaceBefore) || 0} onChange={event => setLayout({ spaceBefore: Math.max(0, Math.min(80, Number(event.target.value) || 0)) })}/>pt</label><label>块后间距<input aria-label="块后间距" type="number" min={0} max={80} value={Number(current.attrs.spaceAfter) || 0} onChange={event => setLayout({ spaceAfter: Math.max(0, Math.min(80, Number(event.target.value) || 0)) })}/>pt</label><label><input type="checkbox" checked={current.attrs.keepTogether == null ? current.type==='bookQuestion' : !!current.attrs.keepTogether} onChange={event => setLayout({ keepTogether: event.target.checked })}/>尽量不拆页</label><label><input type="checkbox" checked={!!current.attrs.pageBreakBefore} onChange={event => setLayout({ pageBreakBefore: event.target.checked })}/>块前分页</label></div>}
  </div>;
}

export const BookEditor = forwardRef<BookEditorHandle, BookEditorProps>(function BookEditor(props, ref) {
  const latest = useRef(props); latest.current = props;
  const [store] = useState(() => new QuestionStore());
  const chapterQuestionIds = bookQuestionIds(props.chapter.content);
  store.prepare(props.questions, props.numbers, chapterQuestionIds); store.onChange = props.onQuestionChange;
  useLayoutEffect(() => store.update(props.questions, props.numbers, chapterQuestionIds), [store, props.questions, props.numbers, props.chapter.content]);
  const lastSent = useRef<BookNode>();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [math, setMath] = useState<{ latex: string; position?: number; block: boolean }>();
  store.editMath = (latex, position, block) => setMath({ latex, position, block });
  const appendImages = async (editor: TiptapEditor, files: File[]) => {
    const targetChapter = latest.current.chapter.id;
    try {
      const images = await Promise.all(files.map(async file => ({ type: 'image', attrs: { src: await readImage(file), alt: file.name, width: 70, align: 'center' } })));
      if (editor.isDestroyed || latest.current.chapter.id !== targetChapter) return;
      editor.chain().focus().insertContent(images).run(); setError('');
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
  };
  const editor = useEditor({
    extensions: [StarterKit.configure({ codeBlock: false, link: false }), TableKit.configure({ table: { resizable: false } }), BookImage.configure({ allowBase64: true }), TextAlign.configure({ types: ['paragraph', 'heading'] }), TextStyle, FontFamily, Color, LayoutAttributes, Callout, PageBreak, mathNode(false, store), mathNode(true, store), Node.create<{ store: QuestionStore }>({ name: 'bookQuestion', group: 'block', atom: true, draggable: true, selectable: true, addOptions() { return { store }; }, addAttributes() { return { questionId: { default: '', parseHTML: element => element.getAttribute('data-book-question') || '' } }; }, parseHTML() { return [{ tag: 'section[data-book-question]' }]; }, renderHTML({ HTMLAttributes }) { return ['section', { ...HTMLAttributes, 'data-book-question': HTMLAttributes.questionId }]; }, addNodeView() { return ReactNodeViewRenderer(QuestionView); } })],
    content: props.chapter.content as JSONContent,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'book-prose', 'aria-label': '教辅章节正文', spellcheck: 'false' },
      handlePaste(view, event, slice) {
        const imageFiles = [...event.clipboardData?.files || []].filter(file => file.type.startsWith('image/'));
        if (imageFiles.length) { event.preventDefault(); if (editor) void appendImages(editor, imageFiles); return true; }
        let hasQuestions = false; slice.content.descendants(node => { if (node.type.name === 'bookQuestion') hasQuestions = true; });
        if (hasQuestions) {
          const copied = clonePastedNodes(slice.content, latest.current.onCloneQuestion);
          view.dispatch(view.state.tr.replaceSelection(new Slice(copied, slice.openStart, slice.openEnd)).scrollIntoView());
          return true;
        }
        return false;
      },
      handleDrop(view, event, slice, moved) {
        const imageFiles = [...event.dataTransfer?.files || []].filter(file => file.type.startsWith('image/'));
        if (imageFiles.length) { event.preventDefault(); if (editor) void appendImages(editor, imageFiles); return true; }
        if (!moved) {
          let hasQuestions = false; slice.content.descendants(node => { if (node.type.name === 'bookQuestion') hasQuestions = true; });
          if (hasQuestions) {
            const copied = clonePastedNodes(slice.content, latest.current.onCloneQuestion), coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const position = coordinates?.pos ?? view.state.selection.to;
            view.dispatch(view.state.tr.replaceRange(position, position, new Slice(copied, slice.openStart, slice.openEnd)).scrollIntoView()); return true;
          }
        }
        return false;
      },
    },
    onUpdate({ editor }) { const content = editor.getJSON() as BookNode; lastSent.current = content; latest.current.onChange(content); },
  });
  useEffect(() => {
    if (!editor || props.chapter.content === lastSent.current) return;
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(props.chapter.content)) editor.commands.setContent(props.chapter.content as JSONContent, { emitUpdate: false });
  }, [editor, props.chapter.id, props.chapter.content]);
  useEffect(() => { editor?.setEditable(props.active !== false); }, [editor, props.active]);
  useImperativeHandle(ref, () => ({
    focus: () => { editor?.commands.focus(); },
    flush: () => { if (editor && !editor.isDestroyed) { const content = editor.getJSON() as BookNode; lastSent.current = content; latest.current.onChange(content); } },
    insertQuestions: ids => { editor?.chain().focus().insertContent([...ids.map(questionId => ({ type: 'bookQuestion', attrs: { questionId } })), { type: 'paragraph' }]).run(); },
  }), [editor]);
  if (!editor) return <div className="book-editor-loading">正在打开章节…</div>;
  const openMath = (block: boolean) => {
    const selected = editor.state.selection as unknown as { node?: ProseNode; from: number };
    if (selected.node && ['inlineMath', 'blockMath'].includes(selected.node.type.name)) setMath({ latex: String(selected.node.attrs.latex || ''), position: selected.from, block: selected.node.type.name === 'blockMath' });
    else setMath({ latex: '', block });
  };
  const commitMath = () => {
    if (!math?.latex.trim()) return;
    const latex = math.latex.trim().replace(/^\$|\$$/g, '');
    if (typeof math.position === 'number') editor.chain().focus().setNodeSelection(math.position).updateAttributes(math.block ? 'blockMath' : 'inlineMath', { latex }).run();
    else editor.chain().focus().insertContent({ type: math.block ? 'blockMath' : 'inlineMath', attrs: { latex } }).run();
    setMath(undefined);
  };
  return <div className="book-chapter-editor" data-testid="book-editor" data-book-chapter={props.chapter.id}>
    <FormattingBar editor={editor} insertImage={() => fileInput.current?.click()} insertMath={openMath} insertQuestions={props.onInsertQuestions}/>
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={event => { const files = [...event.target.files || []]; event.target.value = ''; if (files.length) void appendImages(editor, files); }}/>
    {error && <div className="book-editor-error" role="alert">{error}</div>}
    <div className="book-editor-scroll"><EditorContent editor={editor}/></div>
    <Modal open={!!math} onClose={() => setMath(undefined)} className="book-math-dialog"><div className="book-math-dialog-header"><h3>{math?.block ? '独立公式' : '行内公式'}</h3><button type="button" aria-label="关闭教辅公式" onClick={() => setMath(undefined)}>×</button></div><textarea aria-label="教辅公式 LaTeX" autoFocus rows={4} className={inputCls} value={math?.latex || ''} onChange={event => setMath(value => value ? { ...value, latex: event.target.value } : value)} placeholder="\\frac{a}{b}"/><div className="book-math-preview"><MathText text={math?.latex ? `\\[${math.latex}\\]` : ''}/></div><div className="book-math-actions"><Button variant="ghost" onClick={() => setMath(undefined)}>取消</Button><Button variant="primary" onClick={commitMath} disabled={!math?.latex.trim()}>应用公式</Button></div></Modal>
  </div>;
});
