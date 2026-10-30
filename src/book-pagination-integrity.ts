/** A continued DOM text node is a suffix, not the first matching substring.
 * Paged.js 0.4's indexOf lookup can jump backwards for repeated phrases. */
export function continuedBookTextOffset(source: string, remainder: string, offset: number): number | undefined {
  if (!remainder || !Number.isInteger(offset) || offset < 0 || offset > remainder.length || !source.endsWith(remainder)) return;
  return source.length - remainder.length + offset;
}

const compact = (value: string) => value.replace(/\s+/gu, '');
export function missingBookTextRuns(expected: ReadonlyMap<string, string>, fragments: Iterable<readonly [string, string]>): string[] {
  const actual = new Map<string, string>();
  for (const [id, text] of fragments) actual.set(id, (actual.get(id) || '') + text);
  return [...expected].filter(([id, text]) => compact(text) !== compact(actual.get(id) || '')).map(([id]) => id);
}
