import JSZip from 'jszip';
import { validateBookProject, type BookProject } from './book-model';

const MAX_BYTES = 250 * 1024 * 1024;
const MIME_EXTENSION: Record<string, string> = { png: 'png', jpeg: 'jpg', jpg: 'jpg', gif: 'gif', webp: 'webp' };
const assetPath = /^assets\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/;

/** One portable ZIP; repeated images are content-addressed and stored once.
 * JSON contains project structure, never flattened page screenshots. */
export async function exportBookProject(input: BookProject): Promise<Uint8Array> {
  const project = validateBookProject(input), archive = new JSZip();
  const images = new Map<string, Promise<string>>(); let total = 0;
  const visit = async (value: unknown): Promise<unknown> => {
    if (typeof value === 'string') {
      const match = value.match(/^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=\s]+)$/);
      if (!match) return value;
      let cached = images.get(value);
      if (!cached) {
        cached = (async () => {
          const binary = atob(match[2].replace(/\s/g, '')), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
          total += bytes.length; if (total > MAX_BYTES) throw Error('书稿附件超过250MB，请分册导出');
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
          const path = `assets/${hash}.${MIME_EXTENSION[match[1]]}`;
          archive.file(path, bytes); return path;
        })(); images.set(value, cached);
      }
      return { __juanyeAsset: await cached };
    }
    if (Array.isArray(value)) return Promise.all(value.map(visit));
    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await visit(child)])));
    return value;
  };
  const encoded = JSON.stringify(await visit(project));
  if (encoded.length > 50 * 1024 * 1024) throw Error('书稿正文超过50MB，请分册导出');
  const projectSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  archive.file('manifest.json', JSON.stringify({ schema: 'juanye-book/1', project: 'project.json', projectSha256, createdAt: new Date().toISOString() }));
  archive.file('project.json', encoded);
  const bytes = await archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 5 } });
  if (bytes.length > MAX_BYTES) throw Error('项目超过250MB，请分册导出');
  return bytes;
}

export async function importBookProject(input: ArrayBuffer | Uint8Array): Promise<BookProject> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_BYTES) throw Error('项目超过250MB');
  let archive: JSZip;
  try { archive = await JSZip.loadAsync(bytes); } catch { throw Error('不是完整的教辅项目ZIP，原书稿未修改'); }
  let expanded = 0;
  for (const entry of Object.values(archive.files)) {
    const unsafe = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
    if (unsafe && unsafe !== entry.name || entry.name.includes('..') || entry.name.includes('\\') || entry.name.startsWith('/')) throw Error('项目包含不安全的附件路径');
    if (!entry.dir && entry.name !== 'manifest.json' && entry.name !== 'project.json' && !assetPath.test(entry.name)) throw Error('项目包含未知文件');
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (!entry.dir && (!Number.isSafeInteger(size) || size! < 0 || (expanded += size!) > MAX_BYTES)) throw Error('项目解压后超过250MB或附件尺寸无效');
    if (entry.name === 'manifest.json' && size! > 1024 * 1024 || entry.name === 'project.json' && size! > 50 * 1024 * 1024) throw Error('项目清单或正文过大');
  }
  const manifestFile = archive.file('manifest.json'), projectFile = archive.file('project.json');
  if (!manifestFile || !projectFile) throw Error('教辅项目缺少清单或书稿');
  let manifest: unknown, project: unknown; const encoded = await projectFile.async('string');
  try { manifest = JSON.parse(await manifestFile.async('string')); project = JSON.parse(encoded); } catch { throw Error('教辅项目JSON损坏'); }
  if (!manifest || typeof manifest !== 'object' || (manifest as { schema?: string }).schema !== 'juanye-book/1' || (manifest as { project?: string }).project !== 'project.json') throw Error('教辅项目版本不受支持');
  const expectedHash = (manifest as { projectSha256?: unknown }).projectSha256;
  const actualHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash) || expectedHash !== actualHash) throw Error('教辅书稿完整性校验失败');
  const cache = new Map<string, Promise<string>>();
  const visit = async (value: unknown, depth = 0): Promise<unknown> => {
    if (depth > 60) throw Error('书稿结构过深');
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && '__juanyeAsset' in value) {
      const path = (value as { __juanyeAsset: unknown }).__juanyeAsset; if (typeof path !== 'string' || !assetPath.test(path)) throw Error('图片引用路径无效');
      let picture = cache.get(path);
      if (!picture) {
        picture = (async () => {
          const entry = archive.file(path); if (!entry) throw Error('项目图片缺失');
          const image = await entry.async('uint8array'); if (image.byteLength > 30 * 1024 * 1024) throw Error('单张图片超过30MB');
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(image)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
          if (!path.includes(`/${hash}.`)) throw Error('项目图片校验失败');
          const suffix = path.split('.').at(-1), mime = suffix === 'jpg' ? 'jpeg' : suffix;
          return `data:image/${mime};base64,${await entry.async('base64')}`;
        })(); cache.set(path, picture);
      }
      return picture;
    }
    if (Array.isArray(value)) return Promise.all(value.map(child => visit(child, depth + 1)));
    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await visit(child, depth + 1)])));
    return value;
  };
  return validateBookProject(await visit(project));
}
