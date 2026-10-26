const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const SCHEMA = 'juanye-bank/1';
const TYPES = ['single', 'multi', 'judge', 'blank', 'essay', 'material', 'custom'];
const MAX_BYTES = 250 * 1024 * 1024;
const MAX_ENTRIES = 10000;
const IMAGE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-zA-Z0-9+/=\s]+$/;
const text = (value, label, max = 200000) => {
  if (typeof value !== 'string' || value.length > max) throw Error(`${label}无效或过长`);
  return value;
};
const strings = (value, label, max = 100) => {
  if (!Array.isArray(value) || value.length > max) throw Error(`${label}无效`);
  return value.map(item => text(item, label));
};
const image = (value, label) => {
  const src = text(value, label, 40 * 1024 * 1024);
  if (!IMAGE.test(src)) throw Error(`${label}必须为内嵌图片`);
  return src;
};
const finite = (value, min, max, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw Error(`${label}无效`);
  return value;
};
function checkedQuestion(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('题目无效');
  if (!TYPES.includes(raw.type)) throw Error('题型无效');
  const q = { id: text(raw.id, '题目 ID', 200), type: raw.type, score: finite(raw.score, 0, 1000, '分值'), stem: text(raw.stem, '题干'), options: strings(raw.options, '选项', 26), answer: strings(raw.answer, '答案'), analysis: text(raw.analysis, '解析') };
  if (!q.id) throw Error('题目 ID 不能为空');
  if (raw.image !== undefined) { if (raw.image !== 'plot') throw Error('题图类型无效'); q.image = raw.image; }
  for (const key of ['sourceImage', 'figure']) if (raw[key] !== undefined) q[key] = image(raw[key], '题图');
  for (const [key, max] of [['source', 2000], ['flag', 1000], ['drawing', 32768]]) if (raw[key] !== undefined) q[key] = text(raw[key], key, max);
  if (raw.knowledge !== undefined) q.knowledge = strings(raw.knowledge, '知识点');
  if (raw.difficulty !== undefined) { if (!['easy', 'medium', 'hard'].includes(raw.difficulty)) throw Error('难度无效'); q.difficulty = raw.difficulty; }
  if (raw.pageBreakBefore !== undefined) { if (typeof raw.pageBreakBefore !== 'boolean') throw Error('分页设置无效'); q.pageBreakBefore = raw.pageBreakBefore; }
  for (const key of ['answerSpace', 'paperAnswerSpace']) if (raw[key] !== undefined) { if (!['auto', 'quarter', 'half', 'full'].includes(raw[key])) throw Error('作答空间无效'); q[key] = raw[key]; }
  if (raw.importNumber !== undefined) { if (!Number.isSafeInteger(raw.importNumber)) throw Error('原题号无效'); q.importNumber = finite(raw.importNumber, 1, 100000, '原题号'); }
  if (raw.bankOrigin !== undefined) {
    const origin = raw.bankOrigin;
    if (!origin || typeof origin !== 'object' || Array.isArray(origin)) throw Error('题库来源无效');
    q.bankOrigin = { libraryId: identifier(origin.libraryId, '逻辑题目 ID'), revisionId: identifier(origin.revisionId, '题库修订 ID'), version: integer(origin.version, 1, MAX_ENTRIES, '来源版本') };
  }
  if (raw.figures !== undefined) {
    if (!Array.isArray(raw.figures) || raw.figures.length > 8) throw Error('题图列表无效');
    const ids = new Set();
    q.figures = raw.figures.map(rawFigure => {
      if (!rawFigure || typeof rawFigure !== 'object' || Array.isArray(rawFigure)) throw Error('题图无效');
      const figure = { id: text(rawFigure.id, '题图 ID', 200), src: image(rawFigure.src, '题图'), layout: rawFigure.layout };
      if (!figure.id || ids.has(figure.id)) throw Error('题图 ID 重复或为空');
      ids.add(figure.id);
      if (!['right', 'half', 'full'].includes(figure.layout)) throw Error('题图排列无效');
      if (rawFigure.caption !== undefined) figure.caption = text(rawFigure.caption, '图注', 2000);
      if (rawFigure.width !== undefined) figure.width = finite(rawFigure.width, 15, 100, '题图宽度');
      if (rawFigure.maxHeight !== undefined) figure.maxHeight = finite(rawFigure.maxHeight, 50, 800, '题图限高');
      return figure;
    });
  }
  return q;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined && key !== 'id' && key !== 'bankOrigin').map(key => [key, canonical(value[key])]));
  return value;
}
const contentKey = question => createHash('sha256').update(JSON.stringify(canonical(question))).digest('hex');
function identifier(value, label) { const result = text(value, label, 200); if (!result) throw Error(`${label}不能为空`); return result; }
function integer(value, min, max, label) { finite(value, min, max, label); if (!Number.isSafeInteger(value)) throw Error(`${label}无效`); return value; }
function timestamp(value, label) { const result = text(value, label, 100); if (!result || !Number.isFinite(Date.parse(result))) throw Error(`${label}无效`); return result; }
function checkedIds(value, label = '题目列表') {
  if (!Array.isArray(value) || !value.length || value.length > MAX_ENTRIES) throw Error(`${label}无效`);
  return [...new Set(value.map(id => identifier(id, label)))];
}
function checkedCollection(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('题集无效');
  const collection = { id: identifier(raw.id, '题集 ID'), name: text(raw.name, '题集名称', 200).trim() };
  if (!collection.name) throw Error('题集名称不能为空');
  if (raw.parentId !== undefined) collection.parentId = identifier(raw.parentId, '父题集 ID');
  return collection;
}
function checkedCollections(raw = []) {
  if (!Array.isArray(raw) || raw.length > MAX_ENTRIES) throw Error('题集列表无效');
  const collections = raw.map(checkedCollection), byId = new Map();
  for (const collection of collections) {
    if (byId.has(collection.id)) throw Error('题集 ID 重复');
    byId.set(collection.id, collection);
  }
  for (const collection of collections) {
    const seen = new Set([collection.id]);
    let parent = collection.parentId;
    while (parent !== undefined) {
      if (!byId.has(parent)) throw Error('父题集不存在');
      if (seen.has(parent)) throw Error('题集不能循环嵌套');
      seen.add(parent); parent = byId.get(parent).parentId;
    }
  }
  return collections;
}
const METADATA = ['favorite', 'collectionIds', 'usageCount', 'lastUsedAt', 'trashedAt'];
function checkedMetadata(entry, collections) {
  const result = {};
  if (entry.favorite !== undefined) { if (typeof entry.favorite !== 'boolean') throw Error('收藏状态无效'); result.favorite = entry.favorite; }
  if (entry.collectionIds !== undefined) {
    const ids = strings(entry.collectionIds, '所属题集', MAX_ENTRIES).map(id => identifier(id, '所属题集'));
    if (new Set(ids).size !== ids.length || ids.some(id => !collections.has(id))) throw Error('所属题集无效或不存在');
    result.collectionIds = ids;
  }
  if (entry.usageCount !== undefined) result.usageCount = integer(entry.usageCount, 0, Number.MAX_SAFE_INTEGER, '使用次数');
  for (const key of ['lastUsedAt', 'trashedAt']) if (entry[key] !== undefined) result[key] = timestamp(entry[key], key);
  return result;
}
function exact(value) {
  if (Array.isArray(value)) return value.map(exact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, exact(value[key])]));
  return value;
}
const equal = (a, b) => JSON.stringify(exact(a)) === JSON.stringify(exact(b));
function checkedBank(raw) {
  if (!raw || raw.schema !== SCHEMA || !Array.isArray(raw.entries) || raw.entries.length > MAX_ENTRIES || !Number.isSafeInteger(raw.revision) || raw.revision < 0) throw Error('题库格式不正确');
  const collections = checkedCollections(raw.collections), collectionIds = new Set(collections.map(item => item.id));
  const ids = new Set();
  const entries = raw.entries.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw Error('题库记录无效');
    const id = text(entry.id, '题库 ID', 200);
    if (!id || ids.has(id)) throw Error('题库 ID 重复或为空');
    ids.add(id);
    const question = checkedQuestion(entry.question);
    const origin = { examTitle: text(entry.origin?.examTitle ?? '', '来源试卷', 1000), questionId: text(entry.origin?.questionId ?? question.id, '来源 ID', 200) };
    if (entry.origin?.examId !== undefined) origin.examId = identifier(entry.origin.examId, '来源试卷 ID');
    const version = entry.version === undefined ? 1 : finite(entry.version, 1, MAX_ENTRIES, '题目版本');
    if (!Number.isSafeInteger(version)) throw Error('题目版本无效');
    return { id, question, origin, contentKey: contentKey(question), createdAt: text(entry.createdAt, '保存时间', 100), version, ...(entry.previousVersionId === undefined ? {} : { previousVersionId: identifier(entry.previousVersionId, '前一版本 ID') }), ...(entry.libraryId === undefined ? {} : { libraryId: identifier(entry.libraryId, '逻辑题目 ID') }), ...checkedMetadata(entry, collectionIds) };
  });
  const byId = new Map(entries.map(entry => [entry.id, entry])), resolved = new Set();
  function resolve(entry) {
    if (resolved.has(entry.id)) return entry.libraryId;
    const chain = [], seen = new Set(); let current = entry;
    while (current && !resolved.has(current.id)) {
      if (seen.has(current.id)) throw Error('题库版本链不能循环');
      seen.add(current.id); chain.push(current); current = byId.get(current.previousVersionId);
    }
    for (const item of chain.reverse()) {
      const previous = byId.get(item.previousVersionId);
      if (previous && (previous.version >= item.version || item.libraryId !== undefined && item.libraryId !== previous.libraryId)) throw Error('题库版本链无效');
      item.libraryId ??= previous?.libraryId ?? item.previousVersionId ?? item.id;
      resolved.add(item.id);
    }
    return entry.libraryId;
  }
  const groups = new Map();
  for (const entry of entries) { const libraryId = resolve(entry); if (!groups.has(libraryId)) groups.set(libraryId, []); groups.get(libraryId).push(entry); }
  for (const group of groups.values()) {
    const versions = new Set(), metadata = { favorite: false, collectionIds: [], usageCount: 0 };
    for (const key of METADATA) {
      const supplied = group.filter(entry => entry[key] !== undefined);
      if (supplied.some(entry => !equal(entry[key], supplied[0][key]))) throw Error('同一题目的元数据不一致');
      if (supplied.length) metadata[key] = supplied[0][key];
    }
    for (const entry of group) {
      if (versions.has(entry.version)) throw Error('同一题目的版本重复');
      versions.add(entry.version); Object.assign(entry, structuredClone(metadata));
    }
  }
  return { schema: SCHEMA, revision: raw.revision, entries, collections };
}

function createQuestionBankStore({ directory }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw Error('题库路径无效');
  const target = path.join(directory, 'question-bank.json');
  const backup = path.join(directory, 'question-bank.backup.json');
  const originalBackup = path.join(directory, 'question-bank.pre-workspace.json');
  let originalBackupChecked = false;
  let queue = Promise.resolve();
  const enqueue = task => { const next = queue.then(task); queue = next.catch(() => {}); return next; };
  async function read(file = target, empty = true) {
    try {
      const stat = await fs.stat(file);
      if (stat.size > MAX_BYTES) throw Error('题库超过 250 MB');
      return checkedBank(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (error) {
      if (empty && error.code === 'ENOENT') return { schema: SCHEMA, revision: 0, entries: [], collections: [] };
      throw Error(`本地题库无法读取；原文件已保留，可恢复上次备份。${error.message}`);
    }
  }
  async function write(bank, keepBackup = true) {
    const validated = checkedBank(bank), content = JSON.stringify(validated);
    if (Buffer.byteLength(content) > MAX_BYTES) throw Error('本地题库超过 250 MB，请先移除不需要的图片题目');
    await fs.mkdir(directory, { recursive: true });
    const temporary = `${target}.tmp-${randomUUID()}`;
    try {
      await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
      if (!originalBackupChecked) {
        // This is independent of the rotating undo backup and is never overwritten.
        try { await fs.copyFile(target, originalBackup, fs.constants.COPYFILE_EXCL); }
        catch (error) { if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error; }
        originalBackupChecked = true;
      }
      if (keepBackup) {
        try { await fs.copyFile(target, backup); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await fs.writeFile(backup, JSON.stringify({ schema: SCHEMA, revision: 0, entries: [], collections: [] }), { encoding: 'utf8', mode: 0o600 });
        }
      }
      await fs.rename(temporary, target);
    } finally { await fs.unlink(temporary).catch(() => {}); }
    return validated;
  }
  const latestOf = (bank, libraryId) => bank.entries.filter(entry => entry.libraryId === libraryId).reduce((latest, entry) => !latest || entry.version > latest.version ? entry : latest, undefined);
  const sourceKey = (origin, questionId) => origin.examId ? `id:${origin.examId}\u0000${questionId}` : origin.examTitle ? `title:${origin.examTitle}\u0000${questionId}` : undefined;
  const inherited = previous => previous ? Object.fromEntries(METADATA.filter(key => previous[key] !== undefined).map(key => [key, structuredClone(previous[key])])) : { favorite: false, collectionIds: [], usageCount: 0 };
  function newRevision(question, previous, origin) {
    const id = randomUUID();
    return { id, libraryId: previous?.libraryId ?? id, question, origin, contentKey: contentKey(question), createdAt: new Date().toISOString(), version: (previous?.version ?? 0) + 1, ...(previous ? { previousVersionId: previous.id } : {}), ...inherited(previous) };
  }
  async function commit(bank, before) {
    if (equal(bank, before)) return before;
    bank.revision = before.revision + 1;
    return write(bank);
  }
  function selectedLibraries(bank, ids) {
    const selected = checkedIds(ids), entries = new Map(bank.entries.map(entry => [entry.id, entry]));
    if (selected.some(id => !entries.has(id))) throw Error('题库记录已变化，请刷新后重试');
    return new Set(selected.map(id => entries.get(id).libraryId));
  }
  return {
    load: () => enqueue(() => read()),
    save: input => enqueue(async () => {
      if (!input || !Array.isArray(input.questions) || !input.questions.length || input.questions.length > 2000) throw Error('请选择 1–2000 道题保存');
      const questions = input.questions.map(checkedQuestion);
      const examTitle = text(input.origin?.examTitle ?? '', '来源试卷', 1000);
      const examId = input.origin?.examId === undefined ? undefined : identifier(input.origin.examId, '来源试卷 ID');
      const bank = await read();
      const contentKeys = new Set(bank.entries.map(entry => entry.contentKey));
      const sourceVersions = new Map();
      for (const entry of bank.entries) {
        const key = sourceKey(entry.origin, entry.origin.questionId);
        if (key && (sourceVersions.get(key)?.version ?? 0) < entry.version) sourceVersions.set(key, entry);
      }
      let added = 0, duplicates = 0;
      for (const question of questions) {
        const key = contentKey(question), origin = { examTitle, questionId: question.id, ...(examId ? { examId } : {}) }, source = sourceKey(origin, question.id);
        let previous;
        if (question.bankOrigin) {
          const linked = bank.entries.find(entry => entry.id === question.bankOrigin.revisionId);
          const knownLibrary = latestOf(bank, question.bankOrigin.libraryId);
          if (linked && (linked.libraryId !== question.bankOrigin.libraryId || linked.version !== question.bankOrigin.version) || knownLibrary && !linked) throw Error('题库来源版本不匹配，请刷新题库后重试');
          if (linked) previous = latestOf(bank, linked.libraryId);
          if (previous && bank.entries.some(entry => entry.libraryId === previous.libraryId && entry.contentKey === key)) { duplicates++; continue; }
        } else {
          if (contentKeys.has(key)) { duplicates++; continue; }
          previous = source ? sourceVersions.get(source) : undefined;
          // A legacy source can acquire a stable exam ID on its first save.
          if (!previous && examId && examTitle) previous = sourceVersions.get(sourceKey({ examTitle }, question.id));
          if (previous) previous = latestOf(bank, previous.libraryId);
        }
        const entry = newRevision(question, previous, origin);
        bank.entries.push(entry);
        contentKeys.add(key); if (source) sourceVersions.set(source, entry); added++;
      }
      if (bank.entries.length > MAX_ENTRIES) throw Error('本地题库最多保存 10000 道题');
      if (added) { bank.revision++; await write(bank); }
      return { bank, added, duplicates };
    }),
    manage: input => enqueue(async () => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('题库管理操作无效');
      const before = await read(), bank = structuredClone(before);
      if (['metadata', 'trash', 'restore-items'].includes(input.action)) {
        const libraries = selectedLibraries(bank, input.ids);
        let patch;
        if (input.action === 'metadata') {
          if (input.favorite === undefined && input.collectionIds === undefined && input.appendCollectionId === undefined) throw Error('请选择要修改的题库属性');
          if (input.appendCollectionId !== undefined && !bank.collections.some(item => item.id === identifier(input.appendCollectionId, '所属题集'))) throw Error('所属题集不存在');
          patch = checkedMetadata({ favorite: input.favorite, collectionIds: input.collectionIds }, new Set(bank.collections.map(item => item.id)));
        } else patch = input.action === 'trash' ? { trashedAt: new Date().toISOString() } : {};
        for (const entry of bank.entries) if (libraries.has(entry.libraryId)) {
          if (input.action === 'restore-items') delete entry.trashedAt;
          else if (input.action !== 'trash' || !entry.trashedAt) Object.assign(entry, structuredClone(patch));
          if (input.action === 'metadata' && input.appendCollectionId !== undefined) entry.collectionIds = [...new Set([...entry.collectionIds, input.appendCollectionId])];
        }
      } else if (input.action === 'collection-save') {
        const collection = checkedCollection(input.collection), index = bank.collections.findIndex(item => item.id === collection.id);
        if (index < 0) bank.collections.push(collection); else bank.collections[index] = collection;
        bank.collections = checkedCollections(bank.collections);
      } else if (input.action === 'collection-delete') {
        const id = identifier(input.id, '题集 ID');
        bank.collections = bank.collections.filter(item => item.id !== id).map(item => { if (item.parentId !== id) return item; const { parentId: _parentId, ...rest } = item; return rest; });
        for (const entry of bank.entries) entry.collectionIds = entry.collectionIds.filter(item => item !== id);
      } else throw Error('题库管理操作无效');
      return commit(bank, before);
    }),
    revise: input => enqueue(async () => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('题库修订无效');
      const id = identifier(input.id, '题库 ID'), expected = identifier(input.expectedContentKey, '原题内容标识'), question = checkedQuestion(input.question), bank = await read();
      const original = bank.entries.find(entry => entry.id === id), previous = original && latestOf(bank, original.libraryId);
      if (!original || original.id !== previous.id || expected !== original.contentKey) throw Error('题目已有更新，请刷新后重新编辑');
      if (contentKey(question) === original.contentKey) return { bank, entry: original };
      const entry = newRevision(question, previous, structuredClone(previous.origin));
      if (bank.entries.length >= MAX_ENTRIES) throw Error('本地题库最多保存 10000 道题');
      bank.entries.push(entry); bank.revision++;
      return { bank: await write(bank), entry };
    }),
    reviseBatch: inputs => enqueue(async () => {
      if (!Array.isArray(inputs) || !inputs.length || inputs.length > 2000) throw Error('请选择 1–2000 道题批量修改');
      const bank = await read(), pending = [], libraries = new Set();
      for (const input of inputs) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('批量修订无效');
        const id = identifier(input.id, '题库 ID'), expected = identifier(input.expectedContentKey, '原题内容标识');
        const question = checkedQuestion(input.question), original = bank.entries.find(entry => entry.id === id);
        const latest = original && latestOf(bank, original.libraryId);
        if (!original || latest.id !== id || original.contentKey !== expected) throw Error('部分题目已有更新，整批未保存，请刷新后重新编辑');
        if (libraries.has(original.libraryId)) throw Error('批量修订包含重复题目');
        libraries.add(original.libraryId);
        if (contentKey(question) !== original.contentKey) pending.push(newRevision(question, original, structuredClone(original.origin)));
      }
      if (bank.entries.length + pending.length > MAX_ENTRIES) throw Error('本地题库最多保存 10000 道题');
      if (pending.length) { bank.entries.push(...pending); bank.revision++; return write(bank); }
      return bank;
    }),
    importBank: raw => enqueue(async () => {
      if (typeof raw === 'string') {
        if (Buffer.byteLength(raw) > MAX_BYTES) throw Error('导入题库超过 250 MB');
        try { raw = JSON.parse(raw); } catch { throw Error('导入题库不是有效 JSON'); }
      }
      const imported = checkedBank(raw), before = await read(), bank = structuredClone(before);
      const collections = new Map(bank.collections.map(item => [item.id, item]));
      for (const collection of imported.collections) {
        if (collections.has(collection.id) && !equal(collections.get(collection.id), collection)) throw Error('导入题集 ID 冲突，原题库未修改');
        if (!collections.has(collection.id)) { collections.set(collection.id, collection); bank.collections.push(collection); }
      }
      const entries = new Map(bank.entries.map(entry => [entry.id, entry]));
      let added = 0, duplicates = 0;
      for (const entry of imported.entries) {
        if (entries.has(entry.id)) {
          if (!equal(entries.get(entry.id), entry)) throw Error('导入题目 ID 冲突，原题库未修改');
          duplicates++;
        } else { entries.set(entry.id, entry); bank.entries.push(entry); added++; }
      }
      // Validate the combined graph before the first write: collisions cannot partially import.
      const merged = checkedBank(bank);
      return { bank: await commit(merged, before), added, duplicates };
    }),
    markUsed: ids => enqueue(async () => {
      const before = await read(), bank = structuredClone(before), libraries = selectedLibraries(bank, ids), now = new Date().toISOString();
      for (const entry of bank.entries) if (libraries.has(entry.libraryId)) {
        if (entry.usageCount >= Number.MAX_SAFE_INTEGER) throw Error('使用次数超过上限');
        entry.usageCount++; entry.lastUsedAt = now;
      }
      return commit(bank, before);
    }),
    remove: ids => enqueue(async () => {
      if (!Array.isArray(ids) || !ids.length || ids.length > MAX_ENTRIES || ids.some(id => typeof id !== 'string' || !id || id.length > 200)) throw Error('删除题目列表无效');
      const selected = new Set(ids), bank = await read();
      const entries = bank.entries.filter(entry => !selected.has(entry.id));
      if (entries.length === bank.entries.length) return bank;
      return write({ ...bank, revision: bank.revision + 1, entries });
    }),
    restore: () => enqueue(async () => {
      const saved = await read(backup, false);
      let revision = saved.revision + 1;
      try { revision = Math.max(revision, (await read()).revision + 1); } catch { /* A validated backup may recover a damaged file. */ }
      // Keep even a corrupt current file, rather than silently discarding evidence.
      try { await fs.copyFile(target, `${target}.before-restore-${Date.now()}-${randomUUID()}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return write({ ...saved, revision }, false);
    }),
  };
}

module.exports = { SCHEMA, createQuestionBankStore, checkedBank, checkedQuestion, contentKey };
