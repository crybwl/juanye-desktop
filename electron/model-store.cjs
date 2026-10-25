const { DEFAULT_MODEL, checkedConfig, normalizeEndpoint } = require('./model.cjs');

const KEY_REENTRY = '本机保存的 API Key 无法正确读取，请在“设置 → 模型服务”重新填写 API Key 并保存';

function checkedPlainKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[^\x21-\x7e]/.test(value.trim())) throw new Error(KEY_REENTRY);
  return value.trim();
}

function encryptedBytes(value) {
  // Buffer in current Electron, Uint8Array across some native bridges. Never call
  // a typed array's own toString('base64'), which serializes comma-separated bytes.
  if (!Buffer.isBuffer(value) && !ArrayBuffer.isView(value)) throw new Error('系统加密返回了无效数据，API Key 未保存');
  const bytes = Buffer.from(value);
  if (!bytes.length) throw new Error('系统加密返回为空，API Key 未保存');
  return bytes;
}

async function decryptKey(safeStorage, encryptedKey) {
  try {
    if (typeof encryptedKey !== 'string' || encryptedKey.length > 65536 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encryptedKey)) throw new Error('bad ciphertext');
    const bytes = Buffer.from(encryptedKey, 'base64');
    if (!bytes.length || bytes.toString('base64') !== encryptedKey) throw new Error('noncanonical ciphertext');
    const decrypted = await safeStorage.decryptStringAsync(bytes);
    // Electron 45 returns { result, shouldReEncrypt }, not a plaintext string.
    // Keep older Electron compatibility without ever forwarding an object as key.
    return checkedPlainKey(typeof decrypted === 'string' ? decrypted : decrypted?.result);
  } catch { throw new Error(KEY_REENTRY); }
}

function createModelStore({ safeStorage, read, write }) {
  if (!safeStorage || typeof read !== 'function' || typeof write !== 'function') throw new TypeError('模型存储依赖无效');
  let queue = Promise.resolve();
  const serial = (work) => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  const readStored = async () => {
    const stored = await read();
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('本机模型配置格式无效，请重新配置模型服务');
    const config = checkedConfig({ baseUrl: stored.baseUrl ?? DEFAULT_MODEL.baseUrl, model: stored.model ?? DEFAULT_MODEL.model });
    return { baseUrl: config.baseUrl, model: config.model, encryptedKey: stored.encryptedKey };
  };
  const resolveStored = async (stored, override) => {
    const next = override ? checkedConfig(override) : { baseUrl: stored.baseUrl, model: stored.model };
    // A newly entered key must repair a damaged stored key, so do not decrypt old
    // ciphertext before checking the explicit replacement.
    if (next.key) return { ...next, key: checkedPlainKey(next.key) };
    if (override && normalizeEndpoint(next.baseUrl) !== normalizeEndpoint(stored.baseUrl) && stored.encryptedKey) throw new Error('修改请求地址时，请重新填写 API Key');
    if (!stored.encryptedKey) throw new Error('请先在“设置 → 模型服务”填写并保存 API Key');
    return { ...next, key: await decryptKey(safeStorage, stored.encryptedKey) };
  };

  return {
    get: () => serial(async () => {
      const stored = await readStored();
      if (stored.encryptedKey) await decryptKey(safeStorage, stored.encryptedKey);
      return { baseUrl: stored.baseUrl, model: stored.model, hasKey: Boolean(stored.encryptedKey) };
    }),
    resolve: (override) => serial(async () => resolveStored(await readStored(), override)),
    save: (input) => {
      // Snapshot the call's fields before enqueueing. The prior credential is read
      // inside the queue so concurrent blank-key saves preserve the newest key.
      const next = checkedConfig(input);
      return serial(async () => {
        const prior = await readStored();
        const resolved = await resolveStored(prior, next);
        if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('系统加密服务不可用，API Key 未保存');
        const encryptedKey = encryptedBytes(await safeStorage.encryptStringAsync(resolved.key)).toString('base64');
        if (await decryptKey(safeStorage, encryptedKey) !== resolved.key) throw new Error('API Key 加密校验失败，未保存，请重新填写后重试');
        const expected = { baseUrl: next.baseUrl, model: next.model, encryptedKey };
        await write(expected);
        // Success is reported only after durable readback yields the same key.
        const persisted = await readStored();
        if (persisted.baseUrl !== expected.baseUrl || persisted.model !== expected.model || persisted.encryptedKey !== encryptedKey || await decryptKey(safeStorage, persisted.encryptedKey) !== resolved.key) throw new Error('API Key 保存后回读校验失败，请重新填写并保存');
      });
    },
  };
}

module.exports = { createModelStore, decryptKey, encryptedBytes, KEY_REENTRY };
