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
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined && key !== 'id').map(key => [key, canonical(value[key])]));
  return value;
}
const contentKey = question => createHash('sha256').update(JSON.stringify(canonical(question))).digest('hex');
function checkedBank(raw) {
  if (!raw || raw.schema !== SCHEMA || !Array.isArray(raw.entries) || raw.entries.length > MAX_ENTRIES || !Number.isSafeInteger(raw.revision) || raw.revision < 0) throw Error('题库格式不正确');
  const ids = new Set();
  const entries = raw.entries.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw Error('题库记录无效');
    const id = text(entry.id, '题库 ID', 200);
    if (!id || ids.has(id)) throw Error('题库 ID 重复或为空');
    ids.add(id);
    const question = checkedQuestion(entry.question);
    const origin = { examTitle: text(entry.origin?.examTitle ?? '', '来源试卷', 1000), questionId: text(entry.origin?.questionId ?? question.id, '来源 ID', 200) };
    const version = entry.version === undefined ? 1 : finite(entry.version, 1, MAX_ENTRIES, '题目版本');
    if (!Number.isSafeInteger(version)) throw Error('题目版本无效');
    return { id, question, origin, contentKey: contentKey(question), createdAt: text(entry.createdAt, '保存时间', 100), version, ...(entry.previousVersionId === undefined ? {} : { previousVersionId: text(entry.previousVersionId, '前一版本 ID', 200) }) };
  });
  return { schema: SCHEMA, revision: raw.revision, entries };
}

function createQuestionBankStore({ directory }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw Error('题库路径无效');
  const target = path.join(directory, 'question-bank.json');
  const backup = path.join(directory, 'question-bank.backup.json');
  let queue = Promise.resolve();
  const enqueue = task => { const next = queue.then(task); queue = next.catch(() => {}); return next; };
  async function read(file = target, empty = true) {
    try {
      const stat = await fs.stat(file);
      if (stat.size > MAX_BYTES) throw Error('题库超过 250 MB');
      return checkedBank(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (error) {
      if (empty && error.code === 'ENOENT') return { schema: SCHEMA, revision: 0, entries: [] };
      throw Error(`本地题库无法读取；原文件已保留，可恢复上次备份。${error.message}`);
    }
  }
  async function write(bank, keepBackup = true) {
    const content = JSON.stringify(checkedBank(bank));
    if (Buffer.byteLength(content) > MAX_BYTES) throw Error('本地题库超过 250 MB，请先移除不需要的图片题目');
    await fs.mkdir(directory, { recursive: true });
    const temporary = `${target}.tmp-${randomUUID()}`;
    try {
      await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
      if (keepBackup) {
        try { await fs.copyFile(target, backup); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await fs.writeFile(backup, JSON.stringify({ schema: SCHEMA, revision: 0, entries: [] }), { encoding: 'utf8', mode: 0o600 });
        }
      }
      await fs.rename(temporary, target);
    } finally { await fs.unlink(temporary).catch(() => {}); }
    return bank;
  }
  return {
    load: () => enqueue(() => read()),
    save: input => enqueue(async () => {
      if (!input || !Array.isArray(input.questions) || !input.questions.length || input.questions.length > 2000) throw Error('请选择 1–2000 道题保存');
      const questions = input.questions.map(checkedQuestion);
      const examTitle = text(input.origin?.examTitle ?? '', '来源试卷', 1000);
      const bank = await read();
      const contentKeys = new Set(bank.entries.map(entry => entry.contentKey));
      const sourceVersions = new Map();
      for (const entry of bank.entries) {
        if (!entry.origin.examTitle) continue;
        const sourceKey = `${entry.origin.examTitle}\u0000${entry.origin.questionId}`;
        if ((sourceVersions.get(sourceKey)?.version ?? 0) < entry.version) sourceVersions.set(sourceKey, entry);
      }
      let added = 0, duplicates = 0;
      for (const question of questions) {
        const key = contentKey(question), sourceKey = `${examTitle}\u0000${question.id}`;
        if (contentKeys.has(key)) { duplicates++; continue; }
        const previous = examTitle ? sourceVersions.get(sourceKey) : undefined;
        const entry = { id: randomUUID(), question, origin: { examTitle, questionId: question.id }, contentKey: key, createdAt: new Date().toISOString(), version: (previous?.version ?? 0) + 1, ...(previous ? { previousVersionId: previous.id } : {}) };
        bank.entries.push(entry);
        contentKeys.add(key); if (examTitle) sourceVersions.set(sourceKey, entry); added++;
      }
      if (bank.entries.length > MAX_ENTRIES) throw Error('本地题库最多保存 10000 道题');
      if (added) { bank.revision++; await write(bank); }
      return { bank, added, duplicates };
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
