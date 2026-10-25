const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
async function main() {
  const root = path.resolve(__dirname, '..');
  const source = await loadImage(path.join(root, 'src/assets/juanye-icon.svg'));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map(size => {
    const canvas = createCanvas(size, size);
    canvas.getContext('2d').drawImage(source, 0, 0, size, size);
    return canvas.toBuffer('image/png');
  });
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const at = 6 + 16 * index;
    header[at] = size === 256 ? 0 : size; header[at + 1] = header[at];
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(pngs[index].length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += pngs[index].length;
  });
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build/icon.ico'), Buffer.concat([header, ...pngs]));
  fs.writeFileSync(path.join(root, 'public/juanye-icon.png'), pngs.at(-1));
  console.log('Built original Juanye icon (16–256px ICO + PNG)');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
