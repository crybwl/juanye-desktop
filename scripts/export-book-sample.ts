/** Export the synthetic PDF fixture as a portable, still-editable book. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { exportBookProject, importBookProject } from '../src/book-project';
import { validateBookProject } from '../src/book-model';

const require = createRequire(import.meta.url);
const { sampleBook } = require('./book-workspace-regression.cjs');
const sample = validateBookProject(sampleBook());
const bytes = await exportBookProject(sample);
assert.deepEqual(await importBookProject(bytes), sample);
const directory = new URL('../output/book/', import.meta.url);
await mkdir(directory, { recursive: true });
const target = new URL('数学专题讲义.juanye-book', directory);
await writeFile(target, bytes);
console.log(JSON.stringify({ path: fileURLToPath(target), bytes: bytes.length, editableRoundtrip: true }));
