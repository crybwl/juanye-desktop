import { useEffect, useState } from "react";
import katex from "katex";
import { MathText } from "../math";
import { Button, Modal, inputCls } from "../ui";

const snippets = [
  ["分式", String.raw`\frac{a}{b}`], ["根式", String.raw`\sqrt{x}`], ["上标", "x^{2}"], ["下标", "a_{n}"],
  ["求和", String.raw`\sum_{k=1}^{n}a_k`], ["积分", String.raw`\int_a^b f(x)\,dx`], ["向量", String.raw`\overrightarrow{AB}`],
  ["分段", String.raw`f(x)=\begin{cases}x,&x\ge 0\\-x,&x<0\end{cases}`], ["矩阵", String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`],
];
export function FormulaEditor({ open, onClose, onInsert, initial = "" }: { open: boolean; onClose: () => void; onInsert: (formula: string) => void; initial?: string }) {
  const [code, setCode] = useState("");
  useEffect(() => { if (open) setCode(initial.replace(/^\$|\$$/g, "")); }, [open, initial]);
  let error = "";
  try { if (code.trim()) katex.renderToString(code, { throwOnError: true, trust: false, maxExpand: 1000, maxSize: 20 }); }
  catch { error = "公式语法有误"; }
  return <Modal open={open} onClose={onClose} className="w-[640px] max-w-full p-6">
    <div className="mb-4 text-[15px] font-semibold">公式编辑器</div>
    <div className="mb-3 flex flex-wrap gap-2">{snippets.map(([label, value]) => <Button key={label} size="sm" variant="outline" onClick={() => setCode(previous => previous + value)}>{label}</Button>)}</div>
    <textarea autoFocus aria-label="公式代码" rows={4} className={`${inputCls} h-auto resize-y py-3 font-mono`} value={code} onChange={event => setCode(event.target.value)} />
    <div className="mt-4 min-h-24 overflow-x-auto rounded-xl border border-line p-4"><MathText text={code.trim() ? `$${code}$` : ""} /></div>
    <div className="mt-4 flex items-center justify-end gap-2">{error && <span role="alert" className="mr-auto text-[12px] text-danger">{error}</span>}<Button variant="outline" onClick={onClose}>取消</Button><Button variant="primary" disabled={!code.trim() || Boolean(error)} onClick={() => { onInsert(`$${code.trim()}$`); onClose(); }}>插入公式</Button></div>
  </Modal>;
}
