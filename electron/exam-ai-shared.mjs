// Browser-safe: this exact serializer and digest are used on both sides of IPC.
// Layout, answer-space and source-image pixels are never part of the AI text payload.
export const PROMPT_VERSION = 'exam-review-v1';
export const DEFAULT_EXAM_AI_CONFIG = Object.freeze({ grade: '', scope: '', purpose: '组卷质量核查', mode: 'quick', maxRequests: 4, maxOutputTokens: 4096, includeImages: false, imageBudget: 2 });

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item ?? null)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

// Synchronous SHA-256 avoids an asynchronous race in the metadata-apply guard.
export function contentHash(value) {
  const bytes = new TextEncoder().encode(value);
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(length); data.set(bytes); data[bytes.length] = 128;
  const view = new DataView(data.buffer);
  view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000)); view.setUint32(length - 4, bytes.length << 3);
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const w = new Uint32Array(64), rotate = (n, bits) => (n >>> bits) | (n << (32 - bits));
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i-15], b = w[i-2]; w[i] = (w[i-16] + (rotate(a,7)^rotate(a,18)^(a>>>3)) + w[i-7] + (rotate(b,17)^rotate(b,19)^(b>>>10))) >>> 0; }
    let [a,b,c,d,e,f,g,j] = h;
    for (let i = 0; i < 64; i++) { const t1 = (j + (rotate(e,6)^rotate(e,11)^rotate(e,25)) + ((e&f)^(~e&g)) + k[i] + w[i]) >>> 0; const t2 = ((rotate(a,2)^rotate(a,13)^rotate(a,22)) + ((a&b)^(a&c)^(b&c))) >>> 0; j=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0; }
    [a,b,c,d,e,f,g,j].forEach((n, i) => { h[i] = (h[i] + n) >>> 0; });
  }
  return h.map(n => n.toString(16).padStart(8,'0')).join('');
}

function text(value, limit = 200000) { if (typeof value !== 'string' || value.length > limit) throw new Error('试卷文字格式无效或内容过长'); return value; }
const mediaHashCache = new WeakMap();
function questionMediaHashes(question, media) {
  const cached = mediaHashCache.get(question);
  if (cached && cached.media.length === media.length && cached.media.every((value,index)=>value===media[index])) return cached.hashes;
  const hashes=media.map(value=>contentHash(text(value,80000000)));
  mediaHashCache.set(question,{media,hashes});
  return hashes;
}
export function normalizeExamAiConfig(input = {}) {
  const result = { ...DEFAULT_EXAM_AI_CONFIG, ...input };
  for (const key of ['grade', 'scope', 'purpose']) result[key] = text(result[key], 2000).trim();
  if (!['quick','deep'].includes(result.mode)) throw new Error('分析模式无效');
  for (const [key, min, max] of [['maxRequests',1,16],['maxOutputTokens',256,8192],['imageBudget',0,8]]) if (!Number.isInteger(result[key]) || result[key] < min || result[key] > max) throw new Error('请求次数、输出或图片预算超出允许范围');
  if (typeof result.includeImages !== 'boolean') throw new Error('图片授权无效');
  // Drop any unknown fields, including attempted credential overrides.
  return Object.fromEntries(Object.keys(DEFAULT_EXAM_AI_CONFIG).map(key => [key, result[key]]));
}

export function snapshotExam(exam) {
  if (!exam || !Array.isArray(exam.sections) || exam.sections.length > 2000) throw new Error('试卷格式无效');
  const ids = new Set(); let number = 0;
  const sections = exam.sections.map(section => {
    if (!Array.isArray(section.questions)) throw new Error('题目格式无效');
    return { id: text(section.id,200), title: text(section.title,10000), type: text(section.type,40), note: text(section.note,10000), questions: section.questions.map(question => {
      if (++number > 2000) throw new Error('一次最多分析 2000 道题');
      const id = text(question.id,200); if (!id || ids.has(id)) throw new Error('题目 ID 缺失或重复'); ids.add(id);
      if (!Number.isFinite(question.score) || question.score < 0 || question.score > 100000) throw new Error('题目分值无效');
      if (!['single','multi','judge','blank','essay','material','custom'].includes(question.type)) throw new Error('题型无效');
      if (!Array.isArray(question.options) || question.options.length > 26 || !Array.isArray(question.answer) || question.answer.length > 200) throw new Error('选项或答案格式无效');
      if (question.difficulty !== undefined && !['easy','medium','hard'].includes(question.difficulty)) throw new Error('难度标注无效');
      if (question.knowledge !== undefined && (!Array.isArray(question.knowledge) || question.knowledge.length > 40)) throw new Error('知识点格式无效');
      const media = [question.sourceImage, question.figure, question.drawing, ...(Array.isArray(question.figures) ? question.figures.map(figure => figure.src) : [])].filter(Boolean);
      return { id, number, type: question.type, score: question.score, stem: text(question.stem), options: question.options.map(value => text(value,20000)), answer: question.answer.map(value => text(value,50000)), analysis: text(question.analysis), knowledge: (question.knowledge ?? []).map(value => text(value,200)), difficulty: question.difficulty ?? 'unset', source: text(question.source ?? '',2000), flag: text(question.flag ?? '',2000), mediaHashes: questionMediaHashes(question,media), figureCaptions: (question.figures ?? []).map(figure=>text(figure.caption??'',2000)), image: question.image ?? null };
    }) };
  });
  const result = { title: text(exam.title,10000), subtitle: text(exam.subtitle,10000), duration: exam.duration, notice: Array.isArray(exam.notice) ? exam.notice.map(value => text(value,10000)) : [], sections };
  if (!Number.isFinite(result.duration) || result.duration < 0) throw new Error('考试时长无效');
  if (stableStringify(result).length > 2000000) throw new Error('试卷文字总量超过 200 万字符，请分卷分析');
  return result;
}
export function examSnapshotFingerprint(exam) { return contentHash(stableStringify(snapshotExam(exam))); }
export function examContextHash(config) { return contentHash(stableStringify(normalizeExamAiConfig(config))); }
export function examReportKey(exam) { return typeof exam.id === 'string' && exam.id.length <= 200 && exam.id ? exam.id : contentHash(String(exam.title)).slice(0,24); }

export function planExamAnalysis(exam, input = {}) {
  const config = normalizeExamAiConfig(input), snapshot = snapshotExam(exam);
  const questions = snapshot.sections.flatMap(section => section.questions.map(question => ({ ...question, section: section.title, sectionNote: section.note })));
  const chunkLimit = config.mode === 'deep' ? 10000 : 16000;
  const chunks = []; let current = [], chars = 0;
  for (const question of questions) {
    const size = stableStringify(question).length;
    if (size > chunkLimit) throw new Error(`第 ${question.number} 题文字超过单次分析上限，请精简后重试`);
    if (current.length && (chars + size > chunkLimit || current.length >= 20)) { chunks.push(current); current=[]; chars=0; }
    current.push(question); chars += size;
  }
  if (current.length) chunks.push(current);
  const sourceQuestions = exam.sections.flatMap(section => section.questions), images = [];
  if (config.includeImages) for (const question of sourceQuestions) {
    for (const source of [question.sourceImage, question.figure, ...(question.figures ?? []).map(figure => figure.src)]) {
      if (images.length >= config.imageBudget) break;
      if (typeof source === 'string' && source.length <= 2800000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(source)) images.push({ questionId: question.id, source });
    }
  }
  return { config, snapshot, chunks, images, questionCount: questions.length, charCount: stableStringify(snapshot).length, chunkCount: chunks.length, maxRequests: config.maxRequests, maxOutputTokens: config.maxOutputTokens, maxTotalOutputTokens: config.maxRequests * config.maxOutputTokens, exceedsBudget: chunks.length > config.maxRequests, fingerprint: contentHash(stableStringify(snapshot)), contextHash: examContextHash(config), examKey: examReportKey(exam) };
}
