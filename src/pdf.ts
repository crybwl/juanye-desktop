/** All PDF decoder/font assets are bundled; imported files never need a CDN. */
export const pdfOptions = () => {
  const base = new URL("pdfjs/", document.baseURI).href;
  return { cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`, useWasm: true };
};
