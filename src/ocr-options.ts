import { drawingSegments } from "./drawing";
import { mathSegments } from "./math";

const asciiLabels = (text: string) => text.replace(/[Ａ-Ｈ]/g, letter => String.fromCharCode(letter.charCodeAt(0) - 0xfee0));
const labelPrefix = /^\s*(?:[（(][A-HＡ-Ｈ][)）]|[A-HＡ-Ｈ][.．、:：)）])\s*/;

export function stripOcrOptionLabel(text: string): string {
  return text.replace(labelPrefix, "").trim();
}

/** Preserve string offsets while hiding formulas and drawing code from the option-label scanner. */
function labelMask(text: string): string {
  const hide = (raw: string) => raw.replace(/[^\r\n]/g, "\ufffc");
  return drawingSegments(text).map(segment => {
    if (segment.kind === "tikz") return hide(segment.code);
    let offset = 0;
    return mathSegments(segment.text).map(part => {
      const delimiterLength = !part.math ? 0 : segment.text.startsWith("$$", offset) || segment.text.startsWith("\\[", offset) || segment.text.startsWith("\\(", offset) ? 2 : 1;
      const length = part.text.length + delimiterLength * 2;
      const raw = segment.text.slice(offset, offset + length);
      offset += length;
      return part.math ? hide(raw) : raw;
    }).join("");
  }).join("");
}

/** Only extract a complete A/B/... group. Ambiguous or incomplete groups stay editable in the stem. */
export function splitOcrOptions(text: string): { stem: string; options: string[] } | undefined {
  const mask = asciiLabels(labelMask(text));
  const pattern = /(^|[\s:：;；])(?:\*\*|__)?(?:[（(]([A-H])[)）]|([A-H])[.．、:：)）]|([A-H])(?=[ \t]))(?:\*\*|__)?[ \t]*/g;
  const markers: { start: number; end: number; label: string }[] = [];
  for (const match of mask.matchAll(pattern)) {
    const start = match.index! + match[1].length;
    // Unpunctuated letters need a line start or a real column gap, not prose such as "A 点".
    if (match[4]) {
      const linePrefix = mask.slice(mask.lastIndexOf("\n", start - 1) + 1, start);
      if (linePrefix.trim() && !/(?:\t| {2,})$/.test(linePrefix)) continue;
    }
    markers.push({ start, end: match.index! + match[0].length, label: match[2] || match[3] || match[4] });
  }
  const labels = markers.map(marker => marker.label).sort();
  if (labels.length < 2 || labels.some((label, index) => label !== String.fromCharCode(65 + index))) return;

  // Explanations following the choices are not part of option D (or the last choice).
  const last = markers[markers.length - 1];
  const tail = mask.slice(last.end).match(/\n[ \t]*[【\[]?(?:参考答案|答案|解析|分析|解答)[】\]]?[ \t]*[:：]/);
  const end = tail ? last.end + tail.index! : text.length;
  // Column-first OCR can return A/C/B/D; retain each label's own content before sorting the fields.
  const options = markers.map((marker, index) => ({
    label: marker.label,
    text: text.slice(marker.end, markers[index + 1]?.start ?? end).trim(),
  })).sort((a, b) => a.label.localeCompare(b.label)).map(option => option.text);
  if (options.some(option => !option)) return;
  const stem = [text.slice(0, markers[0].start).trim(), text.slice(end).trim()].filter(Boolean).join("\n");
  return { stem, options };
}
