const { parentPort } = require('node:worker_threads');
const path = require('node:path');
const { checkedTikz, sanitizeSvg, libraries } = require('./diagram-security.cjs');

// The WebAssembly TeX engine reads only node-tikzjax's in-memory package filesystem.
// No cloud, native TeX executable, shell, browser page or user files are involved.
const tikz = require('node-tikzjax');
const fontRoot = path.join(path.dirname(require.resolve('node-tikzjax/package.json')), 'css/bakoma/ttf');
parentPort.on('message', async ({ id, source }) => {
  let logs = '';
  const oldLog = console.log;
  try {
    const code = checkedTikz(source);
    console.log = (...args) => { if (logs.length < 12000) logs += `${args.join(' ')}\n`; };
    const svg = await tikz.default(`\\begin{document}\n${code}\n\\end{document}`, {
      showConsole: true,
      tikzLibraries: libraries,
      texPackages: { amsmath: '', amssymb: '' },
      embedFontCss: false,
    });
    if (/^!|(?:Undefined control sequence|Emergency stop|Fatal error|Package .+ Error|LaTeX Error)/m.test(logs)) throw new Error('TikZ 语法或命令有误，请检查绘图代码');
    parentPort.postMessage({ id, ok: true, ...sanitizeSvg(svg, { fontRoot }) });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: error?.message?.includes('TeX engine') ? 'TikZ 编译失败，请检查命令、坐标和分号' : String(error?.message || 'TikZ 编译失败').slice(0, 240) });
  } finally { console.log = oldLog; }
});
