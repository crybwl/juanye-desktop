const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Opt-in: local native encryption only. Never reads the installed app's userData
// and never calls a provider, even when run on a machine with real credentials.
test('real Electron safeStorage persists exactly the tested plaintext credential', { skip: process.env.JUANYE_NATIVE_MODEL_TEST !== '1', timeout: 60000 }, async () => {
  const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');
  const root = path.resolve(__dirname, '..');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-native-model-test-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root], env, timeout: 60000 });
  try {
    const evidence = await app.evaluate(async ({ app, safeStorage }, storePath) => {
      const require = process.getBuiltinModule('module').createRequire(storePath);
      const fs = require('node:fs/promises');
      const path = require('node:path');
      const { createModelStore } = require(storePath);
      const key = 'native-fixture-not-a-real-provider-key';
      const encrypted = await safeStorage.encryptStringAsync(key);
      const oldResult = await safeStorage.decryptStringAsync(Buffer.from(encrypted));
      const initial = { baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-native-fixture' };
      const file = path.join(app.getPath('userData'), 'model-native-fixture.json');
      const dependencies = {
        safeStorage,
        read: async () => {
          try { return JSON.parse(await fs.readFile(file, 'utf8')); }
          catch (error) { if (error.code === 'ENOENT') return initial; throw error; }
        },
        write: async value => {
          await fs.mkdir(app.getPath('userData'), { recursive: true });
          await fs.writeFile(file, JSON.stringify(value), 'utf8');
        },
      };
      const store = createModelStore(dependencies);
      const tested = await store.resolve({ ...initial, key });
      await store.save({ ...initial, key });
      const restarted = createModelStore(dependencies);
      const loaded = await restarted.resolve();
      await restarted.save({ ...initial, model: 'local-native-next', key: '' });
      return {
        oldDecryptReturnsObject: typeof oldResult === 'object',
        oldCodeWouldSendObjectString: String(oldResult) === '[object Object]',
        fixedNativeRoundtrip: loaded.key === key,
        testedAndSavedMatch: tested.key === loaded.key,
        loadedKeyIsString: typeof loaded.key === 'string',
        plaintextAbsentFromDisk: !(await fs.readFile(file, 'utf8')).includes(key),
        blankSavePreserves: (await restarted.resolve()).key === key,
        metadataHasKey: (await restarted.get()).hasKey,
      };
    }, path.join(root, 'electron/model-store.cjs'));
    assert.deepEqual(evidence, {
      oldDecryptReturnsObject: true, oldCodeWouldSendObjectString: true,
      fixedNativeRoundtrip: true, testedAndSavedMatch: true, loadedKeyIsString: true,
      plaintextAbsentFromDisk: true, blankSavePreserves: true, metadataHasKey: true,
    });
  } finally { await app.close(); }
});
