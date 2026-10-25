const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  const source = path.join(root, 'node_modules/pdfjs-dist', name);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(root, 'public/pdfjs', name), { recursive: true });
}
