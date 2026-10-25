const DEFAULT_MODEL = { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max' };

function normalizeEndpoint(value) {
  const url = new URL(String(value).trim());
  if (url.username || url.password || url.search || url.hash) throw new Error('请求地址不能包含账号、查询参数或片段');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('请使用 HTTPS 请求地址（本机服务可使用 HTTP）');
  let path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/chat/completions')) path += '/chat/completions';
  url.pathname = path;
  return url.toString();
}

function checkedConfig(input) {
  if (!input || typeof input !== 'object') throw new Error('模型配置无效');
  normalizeEndpoint(input.baseUrl);
  if (typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200) throw new Error('请填写模型名称');
  if (input.key !== undefined && (typeof input.key !== 'string' || input.key.length > 4096 || /[^\x21-\x7e]/.test(input.key.trim()))) throw new Error('API Key 格式无效，请重新填写（不能包含空白或非英文字符）');
  return { baseUrl: String(input.baseUrl).trim().replace(/\/+$/, ''), model: input.model.trim(), key: input.key?.trim() };
}

function ocrPrompt(multiple) {
  return `你是数学试卷OCR。逐字忠实转写图片，不解题，不编造内容或答案。${multiple ? '按顶层题号拆分多个独立题目；(1)(2)、①②等小问始终保留在同一道题内。' : '整张图片作为一道题，小问保留在题干。'}\n只返回JSON对象 {"questions":[{"type":"single|multi|blank|essay","score":5,"stem":"题干","options":["选项内容"],"answer":[],"analysis":""}]}。type用single/multi/blank/essay其一；未标注分值时选择/填空用5分、解答用12分。题干不带顶层题号，选项不带A/B等前缀。不要生成未显示的答案或解析。所有数学表达式（包括选项中的数学数字、区间、概率、向量、上下标）必须用单个美元符号包裹，如 $2$、$\\frac{1}{2}$。正文题号/分值等不包裹。不使用双美元、HTML、Markdown代码围栏、enumerate、额外说明。JSON中的LaTeX反斜杠依法转义，不要额外加斜杠。保留图片实际内容，遇到模糊处用[待核对]，不要丢题。`;
}

async function requestModel(input, { image, multiple = false, test = false, signal } = {}) {
  // All request paths validate a plaintext string. In particular never stringify
  // Electron's { result, shouldReEncrypt } decryption return object into a header.
  const config = checkedConfig(input);
  const endpoint = normalizeEndpoint(config.baseUrl);
  if (!config.key) throw new Error('请先在设置中保存 API Key');
  if (!test && (typeof image !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(image))) throw new Error('只支持 PNG、JPG、WebP 图片');
  if (image && image.length > 28 * 1024 * 1024) throw new Error('图片过大，请压缩到 20 MB 内');
  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(test ? 30000 : 180000)]) : AbortSignal.timeout(test ? 30000 : 180000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
    body: JSON.stringify({
      model: config.model,
      max_tokens: test ? 16 : 8192,
      messages: [{ role: 'user', content: test ? '请仅回复 OK' : [
        { type: 'image_url', image_url: { url: image } },
        { type: 'text', text: ocrPrompt(multiple) },
      ] }],
    }),
  });
  const body = await response.text();
  let payload;
  try { payload = JSON.parse(body); } catch { throw new Error(`模型服务未返回有效 JSON（HTTP ${response.status}）`); }
  if (!response.ok) {
    const message = String(payload.error?.message || payload.message || response.statusText).replaceAll(config.key, '[已隐藏]');
    throw new Error(`请求失败（${response.status}）：${message.slice(0, 450)}`);
  }
  const choice = payload.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('返回内容超过模型输出上限，请改用单题识别或裁小图片后重试');
  const content = choice?.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(x => x.text || '').join('\n') : '';
  if (!text.trim()) throw new Error('模型未返回识别内容，请检查模型是否支持图片输入');
  return text;
}

module.exports = { DEFAULT_MODEL, normalizeEndpoint, checkedConfig, ocrPrompt, requestModel };
