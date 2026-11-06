const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const MAX_BYTES = 250 * 1024 * 1024;
const VERSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const NODE_TYPES = new Set(['doc','paragraph','text','heading','bulletList','orderedList','listItem','blockquote','hardBreak','horizontalRule','table','tableRow','tableCell','tableHeader','image','inlineMath','blockMath','bookQuestion','callout','pageBreak','columnSet','columnBreak','answerArea']);
const BLOCK_TYPES = new Set(['paragraph','heading','bulletList','orderedList','blockquote','horizontalRule','table','image','blockMath','bookQuestion','callout','pageBreak','answerArea']);
const INLINE_TYPES = new Set(['text','inlineMath','hardBreak']);
const optionColumns = value => ['auto',1,2,4].includes(value);
const finite = (value,min,max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const color = value => typeof value === 'string' && /^#(?:[a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/i.test(value);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !['__proto__','constructor','prototype'].includes(value);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const image = value => typeof value === 'string' && value.length <= 40 * 1024 * 1024 && /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(value);
const boundedText = (value, limit) => typeof value === 'string' && value.length <= limit;

/** Main-process envelope validation protects disk writes. The editor and book
 * renderer additionally apply the stricter complete structured-model schema. */
function validateStoredBook(value) {
  if (!object(value) || ![1,2].includes(value.version) || value.kind !== 'juanye-book' || !validId(value.id) || !boundedText(value.title, 1000) || !boundedText(value.author, 1000) || !Array.isArray(value.chapters) || value.chapters.length < 1 || value.chapters.length > 1000 || !object(value.questions) || Object.keys(value.questions).length > 10000 || !object(value.settings)) throw Error('教辅书稿格式无效');
  const serialized = JSON.stringify(value); if (Buffer.byteLength(serialized) > MAX_BYTES) throw Error('书稿超过250MB，请分册保存');
  const copy = JSON.parse(serialized), settings = copy.settings;
  if (!['A4','A5','B5'].includes(settings.paper) || !['chapter','book'].includes(settings.numbering) || !['book','chapter','inline','none'].includes(settings.answers) || !boundedText(settings.fontFamily, 200) || !/^[\p{L}\p{N}\s,.'"_-]+$/u.test(settings.fontFamily) || !boundedText(settings.header, 500) || !boundedText(settings.footer, 500)) throw Error('教辅排版参数无效');
  for (const [key, min, max] of [['marginTop',5,45],['marginBottom',5,45],['marginInner',5,45],['marginOuter',5,45],['fontSize',7,30],['lineHeight',1,3],['paragraphGap',0,30],['questionGap',0,30]]) if (!Number.isFinite(settings[key]) || settings[key] < min || settings[key] > max) throw Error('教辅排版参数超出范围');
  for (const key of ['toc','pageNumbers','chapterNewPage']) if (typeof settings[key] !== 'boolean') throw Error('教辅开关参数无效');
  if (settings.optionColumns !== undefined && !optionColumns(settings.optionColumns)) throw Error('选项排列无效');
  let layoutV2 = settings.optionColumns !== undefined && settings.optionColumns !== 'auto' || copy.styles !== undefined;
  const styleIds = new Set();
  if (copy.styles === undefined) ['lesson','example','practice','hint'].forEach(id => styleIds.add(id));
  else {
    if (!Array.isArray(copy.styles) || copy.styles.length > 100) throw Error('块样式表无效');
    for (const style of copy.styles) {
      if (!object(style) || Object.keys(style).some(key => !['id','name','title','background','borderColor','borderWidth','titleBackground','icon','counter'].includes(key)) || !validId(style.id) || styleIds.has(style.id) || !boundedText(style.name,100) || !style.name.trim() || !boundedText(style.title,200) || !color(style.background) || !color(style.borderColor) || !color(style.titleBackground) || !finite(style.borderWidth,0,3) || !['none','book','pen','check','alert','star','lightbulb','extension'].includes(style.icon)) throw Error('块样式无效');
      styleIds.add(style.id);
      if (style.counter !== undefined) {
        const counter = style.counter;
        if (!object(counter) || Object.keys(counter).some(key => !['format','reset','start'].includes(key)) || !boundedText(counter.format,100) || !counter.format.includes('{n}') || /[{}]/u.test(counter.format.replace(/\{(?:章|节|n)\}/gu,'')) || !['book','chapter','section'].includes(counter.reset) || !Number.isInteger(counter.start) || !finite(counter.start,1,100000)) throw Error('计数器无效');
      }
    }
  }
  for (const [key,q] of Object.entries(copy.questions)) {
    if (!validId(key) || !object(q) || q.id !== key || !['single','multi','judge','blank','essay','material','custom'].includes(q.type) || !Number.isFinite(q.score) || q.score < 0 || q.score > 1000 || !boundedText(q.stem,200000) || !boundedText(q.analysis,200000) || !Array.isArray(q.options) || q.options.length > 26 || !q.options.every(option=>boundedText(option,200000)) || !Array.isArray(q.answer) || q.answer.length > 200 || !q.answer.every(answer=>boundedText(answer,200000))) throw Error('教辅题目格式无效');
    for (const field of ['figure','sourceImage']) if (q[field] !== undefined && !image(q[field])) throw Error('教辅图片必须内嵌');
    if (q.figures !== undefined && (!Array.isArray(q.figures) || q.figures.length > 8 || !q.figures.every(figure=>object(figure)&&image(figure.src)))) throw Error('教辅题图格式无效');
  }
  let count = 0; const chapterIds = new Set(), refs = new Set();
  const visit = (node, depth, parent, inColumns = false) => {
    if (depth > 40 || ++count > 300000 || !object(node) || !NODE_TYPES.has(node.type)) throw Error('教辅内容结构无效或过大');
    if (node.text !== undefined && !boundedText(node.text, 200000)) throw Error('教辅正文过长');
    const type = node.type, attrs = node.attrs || {};
    if (type === 'doc' && depth !== 0 || type === 'columnSet' && (parent !== 'doc' || depth !== 1) || type === 'columnBreak' && parent !== 'columnSet') throw Error('分栏与文档层级无效');
    if (['columnSet','columnBreak','answerArea'].includes(type)) layoutV2 = true;
    if (node.attrs !== undefined) {
      if (!object(node.attrs)) throw Error('教辅内容属性无效');
      for (const [key,value] of Object.entries(node.attrs)) if (/^on/i.test(key) || ['style','innerHTML','html','srcdoc'].includes(key) || key === 'src' && !image(value)) throw Error('教辅内容包含不安全属性');
    }
    if (['columnSet','columnBreak','answerArea'].includes(type)) {
      const allowed = {columnSet:['count','gap','rule'],columnBreak:[],answerArea:['kind','unit','size','lineHeight','gridSize','spaceBefore','spaceAfter','keepTogether','pageBreakBefore']}[type];
      if (Object.entries(attrs).some(([key,value]) => !allowed.includes(key) || value == null && (type !== 'answerArea' || ['kind','unit','size','lineHeight','gridSize'].includes(key)))) throw Error('版式内容属性无效');
      if (type === 'columnSet' && (![2,3].includes(attrs.count) || !finite(attrs.gap,2,20) || typeof attrs.rule !== 'boolean')) throw Error('分栏区参数无效');
      if (type === 'answerArea' && (!['blank','lines','grid','coordinate'].includes(attrs.kind) || !['lines','mm'].includes(attrs.unit) || !finite(attrs.size,1,300) || !finite(attrs.lineHeight,3,15) || !finite(attrs.gridSize,2,15) || attrs.unit === 'lines' && (!Number.isInteger(attrs.size) || attrs.size > 40) || (attrs.unit === 'lines' ? attrs.size * attrs.lineHeight : attrs.size) > 300)) throw Error('作答区参数无效');
    }
    if (attrs.optionColumns != null) { if (type !== 'bookQuestion' || !optionColumns(attrs.optionColumns)) throw Error('单题选项排列无效'); layoutV2 = true; }
    if (attrs.styleId != null) { if (type !== 'callout' || !styleIds.has(attrs.styleId)) throw Error('块样式引用缺失'); layoutV2 = true; }
    if (attrs.columnSpan != null) { if (type !== 'heading' || !['none','all'].includes(attrs.columnSpan) || attrs.columnSpan === 'all' && parent !== 'columnSet') throw Error('跨栏标题无效'); if (attrs.columnSpan === 'all') layoutV2 = true; }
    for (const key of ['spaceBefore','spaceAfter']) if (attrs[key] != null && !finite(attrs[key],0,80)) throw Error('块间距无效');
    for (const key of ['keepTogether','pageBreakBefore']) if (attrs[key] != null && typeof attrs[key] !== 'boolean') throw Error('分页约束无效');
    if (node.type === 'image' && !image(node.attrs?.src)) throw Error('教辅图片必须内嵌');
    if (node.type === 'bookQuestion') { const ref = node.attrs?.questionId; if (!validId(ref) || !copy.questions[ref] || refs.has(ref)) throw Error('教辅题目引用缺失或重复'); refs.add(ref); }
    if (node.content !== undefined && !Array.isArray(node.content)) throw Error('教辅内容列表无效');
    const children = node.content || [];
    if (['paragraph','heading'].includes(type) && children.some(child=>!INLINE_TYPES.has(child.type))) throw Error('正文行内层级无效');
    if (type === 'doc' && children.some(child=>!BLOCK_TYPES.has(child.type)&&child.type!=='columnSet')) throw Error('正文块层级无效');
    if (type === 'columnSet' && (!children.length || children.some(child=>!BLOCK_TYPES.has(child.type)&&child.type!=='columnBreak'))) throw Error('分栏区正文无效');
    if (['blockquote','callout','tableCell','tableHeader','listItem'].includes(type) && children.some(child=>!BLOCK_TYPES.has(child.type))) throw Error('容器块层级无效');
    if (['bulletList','orderedList'].includes(type) && (!children.length||children.some(child=>child.type!=='listItem'))) throw Error('列表层级无效');
    if (type==='listItem'&&children[0]?.type!=='paragraph') throw Error('列表项须从段落开始');
    if (type==='table'&&(!children.length||children.some(child=>child.type!=='tableRow'))) throw Error('表格层级无效');
    if (type==='tableRow'&&(!children.length||children.some(child=>!['tableCell','tableHeader'].includes(child.type)))) throw Error('表格行无效');
    if (['tableCell','tableHeader','callout','blockquote'].includes(type)&&!children.length) throw Error('容器不能为空');
    if (['text','inlineMath','blockMath','hardBreak','horizontalRule','image','bookQuestion','pageBreak','columnBreak','answerArea'].includes(type)&&children.length) throw Error('独立节点不可包含子内容');
    if(type==='text'&&(!boundedText(node.text,200000)||!node.text.length))throw Error('文字内容为空');
    for (const child of children) visit(child, depth + 1, type, inColumns || type === 'columnSet');
  };
  for (const chapter of copy.chapters) {
    if (!object(chapter) || !validId(chapter.id) || chapterIds.has(chapter.id) || !boundedText(chapter.title,1000) || !['cover','preface','chapter'].includes(chapter.kind) || chapter.content?.type !== 'doc') throw Error('教辅章节格式无效');
    chapterIds.add(chapter.id); visit(chapter.content,0);
  }
  if (copy.version === 1 && layoutV2) throw Error('书稿使用v2版式，请另存为新版教辅项目');
  return copy;
}

function createBookStore({ directory }) {
  const draftPath = path.join(directory, 'book-draft.json'), backupPath = path.join(directory, 'book-draft.backup.json'), versionsPath = path.join(directory, 'book-versions');
  let queue = Promise.resolve();
  const serialize = callback => { const result = queue.then(callback); queue = result.catch(()=>{}); return result; };
  const read = async target => { try { const bytes = await fs.readFile(target); if (bytes.length > MAX_BYTES) throw Error('书稿超过250MB'); return validateStoredBook(JSON.parse(bytes.toString('utf8'))); } catch (error) { if (error.code === 'ENOENT') return null; throw Error('本地教辅书稿损坏，原文件已保留，请恢复备份或另存项目'); } };
  const write = async book => {
    await fs.mkdir(directory, { recursive: true });
    const previous = await read(draftPath);
    if (previous) await fs.copyFile(draftPath, backupPath);
    const temporary = `${draftPath}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, JSON.stringify(book), { encoding:'utf8', mode:0o600, flag:'wx' }); await fs.rename(temporary,draftPath); }
    catch (error) { await fs.unlink(temporary).catch(()=>{}); throw error; }
  };
  const versionList = async () => {
    let names; try { names = await fs.readdir(versionsPath); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const result = [];
    for (const name of names.filter(name=>VERSION_ID.test(name.replace(/\.json$/,'')) && name.endsWith('.json'))) {
      const target = path.join(versionsPath,name), book = await read(target); if (!book) continue;
      const stats = await fs.stat(target); result.push({ id:name.slice(0,-5), title:book.title, createdAt:stats.mtime.toISOString() });
    }
    return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  };
  return {
    flush: () => queue,
    load: () => serialize(()=>read(draftPath)),
    save: value => { const checked = validateStoredBook(value); return serialize(()=>write(checked)); },
    restore: () => serialize(async () => {
      const backup = await read(backupPath); if (!backup) throw Error('尚无可恢复的教辅备份');
      await fs.mkdir(directory,{recursive:true});
      try { await fs.copyFile(draftPath,path.join(directory,`book-draft.before-restore-${randomUUID()}.json`)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const temporary = `${draftPath}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temporary,JSON.stringify(backup),{encoding:'utf8',mode:0o600,flag:'wx'}); await fs.rename(temporary,draftPath); } catch(error) { await fs.unlink(temporary).catch(()=>{});throw error; }
      return backup;
    }),
    versions: () => serialize(versionList),
    checkpoint: value => { const checked = validateStoredBook(value); return serialize(async()=>{
      if ((await versionList()).length >= 20) throw Error('已保存20个手动版本，请先另存项目；不会自动删除旧版本');
      await fs.mkdir(versionsPath,{recursive:true});const id=randomUUID();await fs.writeFile(path.join(versionsPath,`${id}.json`),JSON.stringify(checked),{encoding:'utf8',mode:0o600,flag:'wx'});
      return {id,title:checked.title,createdAt:new Date().toISOString()};
    }); },
    version: id => { if (!VERSION_ID.test(id)) return Promise.reject(Error('教辅历史版本ID无效')); return serialize(async()=>{const book=await read(path.join(versionsPath,`${id}.json`));if(!book)throw Error('教辅历史版本不存在');return book;}); },
  };
}

function installBookHandlers({ handle, dialog, getWindow, directory }) {
  const store = createBookStore({ directory });
  handle('book:load',()=>store.load()); handle('book:save',value=>store.save(value)); handle('book:restore',()=>store.restore());
  handle('book:versions',()=>store.versions()); handle('book:checkpoint',value=>store.checkpoint(value)); handle('book:version',id=>store.version(id));
  handle('book:export',async options=>{
    if (!options || !boundedText(options.name,1000) || !(options.bytes instanceof Uint8Array || Array.isArray(options.bytes)) || options.bytes.length > MAX_BYTES) throw Error('教辅项目导出内容无效或超过250MB');
    if (Array.isArray(options.bytes) && !options.bytes.every(value=>Number.isInteger(value)&&value>=0&&value<=255)) throw Error('教辅项目字节无效');
    const bytes=Buffer.from(options.bytes);if(bytes.length<4||bytes[0]!==0x50||bytes[1]!==0x4b)throw Error('教辅项目必须为ZIP格式');
    const name=options.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,100).replace(/[. ]+$/,'')||'教辅书稿';
    const target=await dialog.showSaveDialog(getWindow(),{defaultPath:`${name}.juanye-book`,filters:[{name:'卷页教辅项目',extensions:['juanye-book']}]});
    if(target.canceled||!target.filePath)return{canceled:true};await fs.writeFile(target.filePath,bytes);return{canceled:false,path:target.filePath};
  });
  return store;
}
module.exports = { createBookStore, validateStoredBook, installBookHandlers };
