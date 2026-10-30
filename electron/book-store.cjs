const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const MAX_BYTES = 250 * 1024 * 1024;
const VERSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const NODE_TYPES = new Set(['doc','paragraph','text','heading','bulletList','orderedList','listItem','blockquote','hardBreak','horizontalRule','table','tableRow','tableCell','tableHeader','image','inlineMath','blockMath','bookQuestion','callout','pageBreak']);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !['__proto__','constructor','prototype'].includes(value);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const image = value => typeof value === 'string' && value.length <= 40 * 1024 * 1024 && /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(value);
const boundedText = (value, limit) => typeof value === 'string' && value.length <= limit;

/** Main-process envelope validation protects disk writes. The editor and book
 * renderer additionally apply the stricter complete structured-model schema. */
function validateStoredBook(value) {
  if (!object(value) || value.version !== 1 || value.kind !== 'juanye-book' || !validId(value.id) || !boundedText(value.title, 1000) || !boundedText(value.author, 1000) || !Array.isArray(value.chapters) || value.chapters.length < 1 || value.chapters.length > 1000 || !object(value.questions) || Object.keys(value.questions).length > 10000 || !object(value.settings)) throw Error('教辅书稿格式无效');
  const serialized = JSON.stringify(value); if (Buffer.byteLength(serialized) > MAX_BYTES) throw Error('书稿超过250MB，请分册保存');
  const copy = JSON.parse(serialized), settings = copy.settings;
  if (!['A4','A5','B5'].includes(settings.paper) || !['chapter','book'].includes(settings.numbering) || !['book','chapter','inline','none'].includes(settings.answers) || !boundedText(settings.fontFamily, 200) || !/^[\p{L}\p{N}\s,.'"_-]+$/u.test(settings.fontFamily) || !boundedText(settings.header, 500) || !boundedText(settings.footer, 500)) throw Error('教辅排版参数无效');
  for (const [key, min, max] of [['marginTop',5,45],['marginBottom',5,45],['marginInner',5,45],['marginOuter',5,45],['fontSize',7,30],['lineHeight',1,3],['paragraphGap',0,30],['questionGap',0,30]]) if (!Number.isFinite(settings[key]) || settings[key] < min || settings[key] > max) throw Error('教辅排版参数超出范围');
  for (const key of ['toc','pageNumbers','chapterNewPage']) if (typeof settings[key] !== 'boolean') throw Error('教辅开关参数无效');
  for (const [key,q] of Object.entries(copy.questions)) {
    if (!validId(key) || !object(q) || q.id !== key || !['single','multi','judge','blank','essay','material','custom'].includes(q.type) || !Number.isFinite(q.score) || q.score < 0 || q.score > 1000 || !boundedText(q.stem,200000) || !boundedText(q.analysis,200000) || !Array.isArray(q.options) || q.options.length > 26 || !q.options.every(option=>boundedText(option,200000)) || !Array.isArray(q.answer) || q.answer.length > 200 || !q.answer.every(answer=>boundedText(answer,200000))) throw Error('教辅题目格式无效');
    for (const field of ['figure','sourceImage']) if (q[field] !== undefined && !image(q[field])) throw Error('教辅图片必须内嵌');
    if (q.figures !== undefined && (!Array.isArray(q.figures) || q.figures.length > 8 || !q.figures.every(figure=>object(figure)&&image(figure.src)))) throw Error('教辅题图格式无效');
  }
  let count = 0; const chapterIds = new Set(), refs = new Set();
  const visit = (node, depth) => {
    if (depth > 40 || ++count > 300000 || !object(node) || !NODE_TYPES.has(node.type)) throw Error('教辅内容结构无效或过大');
    if (node.text !== undefined && !boundedText(node.text, 200000)) throw Error('教辅正文过长');
    if (node.attrs !== undefined) {
      if (!object(node.attrs)) throw Error('教辅内容属性无效');
      for (const [key,value] of Object.entries(node.attrs)) if (/^on/i.test(key) || ['style','innerHTML','html','srcdoc'].includes(key) || key === 'src' && !image(value)) throw Error('教辅内容包含不安全属性');
    }
    if (node.type === 'image' && !image(node.attrs?.src)) throw Error('教辅图片必须内嵌');
    if (node.type === 'bookQuestion') { const ref = node.attrs?.questionId; if (!validId(ref) || !copy.questions[ref] || refs.has(ref)) throw Error('教辅题目引用缺失或重复'); refs.add(ref); }
    if (node.content !== undefined) { if (!Array.isArray(node.content)) throw Error('教辅内容列表无效'); for (const child of node.content) visit(child, depth + 1); }
  };
  for (const chapter of copy.chapters) {
    if (!object(chapter) || !validId(chapter.id) || chapterIds.has(chapter.id) || !boundedText(chapter.title,1000) || !['cover','preface','chapter'].includes(chapter.kind) || chapter.content?.type !== 'doc') throw Error('教辅章节格式无效');
    chapterIds.add(chapter.id); visit(chapter.content,0);
  }
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
