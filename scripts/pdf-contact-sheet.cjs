/* Internal visual QA only: arrange Poppler-rendered pages without changing the PDFs. */
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
async function main() {
  const dir = path.resolve(process.argv[2]);
  const files = fs.readdirSync(dir).filter(file => /\.png$/.test(file) && !file.startsWith('contact-')).sort();
  const width = 1200, cellWidth = 400, cellHeight = 580;
  const canvas = createCanvas(width, Math.ceil(files.length / 3) * cellHeight);
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#dfe2e6'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [i, file] of files.entries()) {
    const img = await loadImage(path.join(dir, file));
    const scale = Math.min(380 / img.width, 545 / img.height);
    const x = i % 3 * cellWidth + (cellWidth - img.width * scale) / 2, y = Math.floor(i / 3) * cellHeight;
    ctx.fillStyle = '#222'; ctx.font = '14px Arial'; ctx.fillText(file, i % 3 * cellWidth + 10, y + 20);
    ctx.drawImage(img, x, y + 28, img.width * scale, img.height * scale);
  }
  const target = path.join(dir, 'contact-layouts.png'); fs.writeFileSync(target, canvas.toBuffer('image/png')); console.log(target);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
