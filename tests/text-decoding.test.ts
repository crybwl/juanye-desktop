import test from "node:test";
import assert from "node:assert/strict";
import { decodeDocumentText } from "../src/text-decoding";
import { readDocumentText } from "../src/documents";

const buffer = (bytes: Uint8Array) => Uint8Array.from(bytes).buffer;
test("UTF-8 Chinese, formula commands and a BOM remain unchanged", () => {
  const source = "答案：C\n解析：$\\alpha=1$。";
  assert.equal(decodeDocumentText(buffer(new TextEncoder().encode(source))), source);
  assert.equal(decodeDocumentText(buffer(new TextEncoder().encode(`\uFEFF${source}`))), source);
});
test("Windows GBK and GB18030 text is decoded without replacement characters", async () => {
  const bytes = Uint8Array.from([0xb4, 0xf0, 0xb0, 0xb8, 0xa3, 0xba, 0x43, 0x0a, 0xbd, 0xe2, 0xce, 0xf6, 0xa3, 0xba, 0x41]);
  assert.equal(decodeDocumentText(buffer(bytes)), "答案：C\n解析：A");
  assert.equal(await readDocumentText(new File([buffer(bytes)], "答案.txt")), "答案：C\n解析：A");
});
test("UTF-16 LE and BE files including BOM-less Windows output are supported", () => {
  const source = "1. 答案：C\n解析：代入。";
  const le = Buffer.from(source, "utf16le");
  const be = Buffer.from(le).swap16();
  assert.equal(decodeDocumentText(buffer(Buffer.concat([Buffer.from([0xff, 0xfe]), le]))), source);
  assert.equal(decodeDocumentText(buffer(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))), source);
  assert.equal(decodeDocumentText(buffer(le)), source);
});
test("already damaged text and invalid bytes are rejected, never silently imported", () => {
  assert.throws(() => decodeDocumentText(buffer(Uint8Array.from([0xff, 0xff, 0xff]))), /编码/);
  assert.throws(() => decodeDocumentText(buffer(new TextEncoder().encode("答案：\ufffd\ufffd"))), /损坏/);
});
