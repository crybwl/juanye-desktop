/** Local text files may be saved by Windows editors as GBK or UTF-16, not only UTF-8. */
export function decodeDocumentText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const decode = (encoding: string, input = bytes) => new TextDecoder(encoding, { fatal: true }).decode(input).replace(/^\uFEFF/, "");
  let text: string;
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) text = decode("utf-16le");
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = decode("utf-16be");
    else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) text = decode("utf-8");
    else {
      // BOM-less UTF-16 containing ASCII has a consistent zero-byte lane.
      const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
      let evenZeros = 0, oddZeros = 0;
      sample.forEach((value, index) => { if (value === 0) index % 2 ? oddZeros++ : evenZeros++; });
      if (sample.length >= 4 && oddZeros >= 2 && oddZeros > sample.length * 0.1 && evenZeros < oddZeros * 0.1) text = decode("utf-16le");
      else if (sample.length >= 4 && evenZeros >= 2 && evenZeros > sample.length * 0.1 && oddZeros < evenZeros * 0.1) text = decode("utf-16be");
      else {
        try { text = decode("utf-8"); }
        catch { text = decode("gb18030"); }
      }
    }
  } catch { throw new Error("无法读取文件编码，请将原文件另存为 UTF-8 后导入"); }
  if (/[\u0000-\u0008\u000b\u000e-\u001f\ufffd]/.test(text)) throw new Error("文件文字已损坏或编码不受支持，请将原文件另存为 UTF-8 后导入");
  return text;
}
