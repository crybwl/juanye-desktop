const { Worker } = require('node:worker_threads');
const path = require('node:path');
const { checkedTikz } = require('./diagram-security.cjs');

function createDiagramService({ timeoutMs = 15000, maxQueue = 32, workerPath = path.join(__dirname, 'diagram-worker.cjs') } = {}) {
  let worker;
  let queue = Promise.resolve();
  let queued = 0;
  let counter = 0;
  let closed = false;
  const cache = new Map();
  const active = new Map();
  function terminate() {
    if (worker) { const previous = worker; worker = undefined; void previous.terminate(); }
  }
  function run(source) {
    return new Promise((resolve, reject) => {
      if (closed) return reject(new Error('绘图服务已关闭'));
      if (!worker) {
        worker = new Worker(workerPath, { resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 8 }, stdout: true, stderr: true });
        worker.stdout.resume(); worker.stderr.resume();
      }
      const current = worker;
      const id = ++counter;
      const finish = (error, result) => {
        clearTimeout(timer);
        current.off('message', onMessage); current.off('error', onError); current.off('exit', onExit);
        if (error) { terminate(); reject(error); } else resolve(result);
      };
      const onMessage = message => { if (message?.id === id) finish(message.ok ? null : new Error(message.error || '绘图编译失败'), message); };
      const onError = error => finish(new Error(`绘图引擎异常：${String(error.message).slice(0, 140)}`));
      const onExit = () => finish(new Error('绘图引擎已停止，请简化代码后重试'));
      const timer = setTimeout(() => finish(new Error('绘图编译超时，请检查循环或简化绘图代码')), timeoutMs);
      current.on('message', onMessage); current.once('error', onError); current.once('exit', onExit);
      current.postMessage({ id, source });
    });
  }
  return {
    render(source) {
      let code;
      try { code = checkedTikz(source); } catch (error) { return Promise.reject(error); }
      if (cache.has(code)) return Promise.resolve(cache.get(code));
      if (active.has(code)) return active.get(code);
      if (queued >= maxQueue) return Promise.reject(new Error('待绘图过多，请稍后重试'));
      queued++;
      const job = queue.then(() => run(code)).then(result => {
        const output = { svg: result.svg, width: result.width, height: result.height };
        cache.set(code, output);
        if (cache.size > 80) cache.delete(cache.keys().next().value);
        return output;
      }).finally(() => { queued--; active.delete(code); });
      active.set(code, job);
      queue = job.catch(() => {});
      return job;
    },
    dispose() { closed = true; terminate(); cache.clear(); },
  };
}
module.exports = { createDiagramService };
