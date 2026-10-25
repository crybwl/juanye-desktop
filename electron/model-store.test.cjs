const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createModelStore, decryptKey, encryptedBytes } = require('./model-store.cjs');
const { DEFAULT_MODEL, requestModel } = require('./model.cjs');

function fixture({ typedArray = false } = {}) {
  let stored = { ...DEFAULT_MODEL };
  const writes = [];
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async key => {
      const encrypted = Buffer.from(`local-test:${key}`);
      return typedArray ? new Uint8Array(encrypted) : encrypted;
    },
    decryptStringAsync: async bytes => {
      const text = Buffer.from(bytes).toString();
      if (!text.startsWith('local-test:')) throw new Error('invalid fixture ciphertext');
      return { result: text.slice('local-test:'.length), shouldReEncrypt: false };
    },
  };
  const read = async () => JSON.parse(JSON.stringify(stored));
  const write = async value => { stored = JSON.parse(JSON.stringify(value)); writes.push(stored); };
  const dependencies = { safeStorage, read, write };
  return { ...dependencies, store: createModelStore(dependencies), writes, setStored: value => { stored = value; } };
}

test('Electron 45 result object is unwrapped; a stored key is identical to a direct test key', async () => {
  const { store, read } = fixture();
  const key = 'local-unit-credential-A';
  const direct = await store.resolve({ ...DEFAULT_MODEL, key });
  await store.save({ ...DEFAULT_MODEL, key });
  const loaded = await store.resolve();
  assert.equal(typeof loaded.key, 'string');
  assert.equal(loaded.key, direct.key);
  assert.notEqual(`Bearer ${loaded.key}`, 'Bearer [object Object]');
  const metadata = await store.get();
  assert.equal(metadata.hasKey, true); assert.equal(Object.hasOwn(metadata, 'key'), false);
  assert.equal(JSON.stringify(await read()).includes(key), false);
});

test('Uint8Array native cipher output is converted via Buffer before base64', async () => {
  const { store, read } = fixture({ typedArray: true });
  await store.save({ ...DEFAULT_MODEL, key: 'local-unit-typed-array' });
  const stored = await read();
  assert.match(stored.encryptedKey, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.equal((await store.resolve()).key, 'local-unit-typed-array');
  assert.equal(encryptedBytes(new Uint8Array([1, 2, 3])).toString('base64'), 'AQID');
});

test('a restart and a blank-key save preserve the same validated key', async () => {
  const env = fixture();
  await env.store.save({ ...DEFAULT_MODEL, key: 'local-unit-persist' });
  const restarted = createModelStore(env);
  assert.equal((await restarted.resolve()).key, 'local-unit-persist');
  await restarted.save({ ...DEFAULT_MODEL, model: 'local-model-changed', key: '' });
  assert.equal((await restarted.resolve()).key, 'local-unit-persist');
  assert.equal((await restarted.get()).model, 'local-model-changed');
});

test('damaged legacy keys fail explicitly and can be repaired with a replacement', async () => {
  const env = fixture();
  env.setStored({ ...DEFAULT_MODEL, encryptedKey: '1,2,3,4' });
  await assert.rejects(env.store.get(), /重新填写 API Key/);
  await assert.rejects(env.store.resolve(), /重新填写 API Key/);
  await assert.rejects(env.store.save({ ...DEFAULT_MODEL }), /重新填写 API Key/);
  assert.equal((await env.store.resolve({ ...DEFAULT_MODEL, key: 'local-unit-repair' })).key, 'local-unit-repair');
  await env.store.save({ ...DEFAULT_MODEL, key: 'local-unit-repair' });
  assert.equal((await env.store.resolve()).key, 'local-unit-repair');
});

test('a changed provider never receives a retained key without explicit replacement', async () => {
  const { store } = fixture();
  await store.save({ ...DEFAULT_MODEL, key: 'local-unit-provider' });
  const changed = { baseUrl: 'https://other.example.test/v1', model: 'local-model' };
  await assert.rejects(store.resolve(changed), /修改请求地址/);
  await assert.rejects(store.save(changed), /修改请求地址/);
  assert.equal((await store.resolve({ ...changed, key: 'local-unit-other-provider' })).key, 'local-unit-other-provider');
});

test('concurrent saves preserve invocation order and blank-key save reads the newest credential', async () => {
  const env = fixture();
  const encrypt = env.safeStorage.encryptStringAsync;
  env.safeStorage.encryptStringAsync = async key => { await new Promise(resolve => setTimeout(resolve, key.endsWith('A') ? 15 : 1)); return encrypt(key); };
  const a = env.store.save({ ...DEFAULT_MODEL, key: 'local-unit-concurrent-A' });
  const b = env.store.save({ ...DEFAULT_MODEL, key: 'local-unit-concurrent-B' });
  const c = env.store.save({ ...DEFAULT_MODEL, model: 'newest-model' });
  await Promise.all([a, b, c]);
  assert.equal((await env.store.resolve()).key, 'local-unit-concurrent-B');
  assert.equal((await env.store.get()).model, 'newest-model');
  assert.equal(env.writes.length, 3);
});

test('failed encrypt verification and durable readback never report save success', async () => {
  const env = fixture();
  const oldDecrypt = env.safeStorage.decryptStringAsync;
  env.safeStorage.decryptStringAsync = async () => ({ result: 'wrong-roundtrip-credential', shouldReEncrypt: false });
  await assert.rejects(env.store.save({ ...DEFAULT_MODEL, key: 'local-unit-verify' }), /加密校验失败/);
  assert.equal(env.writes.length, 0);
  env.safeStorage.decryptStringAsync = oldDecrypt;
  const lostWrite = createModelStore({ ...env, write: async () => {} });
  await assert.rejects(lostWrite.save({ ...DEFAULT_MODEL, key: 'local-unit-lost-write' }), /回读校验失败/);
});

test('older Electron plaintext return remains compatible and an object can never enter Authorization', async () => {
  assert.equal(await decryptKey({ decryptStringAsync: async () => 'local-unit-old-electron' }, Buffer.from('fixture').toString('base64')), 'local-unit-old-electron');
  await assert.rejects(requestModel({ ...DEFAULT_MODEL, key: { result: 'local-unit-not-a-string' } }, { test: true }), /API Key 格式无效/);
});
