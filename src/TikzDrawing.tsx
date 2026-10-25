import { useEffect, useState } from "react";
import { renderDrawing, type DrawingResult } from "./drawing";

export function TikzDrawing({ code }: { code: string }) {
  const [result, setResult] = useState<DrawingResult>();
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    setResult(undefined); setReady(false); setError("");
    void renderDrawing(code).then(result => { if (active) setResult(result); }).catch(error => { if (active) setError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [code]);
  return <span className="tikz-drawing" data-drawing-status={error ? "error" : ready ? "ready" : "pending"} style={{ display: "inline-block", maxWidth: "100%", verticalAlign: "middle" }}>
    {error ? <span role="alert" className="text-danger" style={{ fontSize: 12 }}>绘图失败：{error}</span> : result ? <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`} alt="TikZ 题图" width={result.width * 1.33} height={result.height * 1.33} style={{ display: "block", maxWidth: "100%", height: "auto", maxHeight: 480, objectFit: "contain" }} onLoad={event => { void event.currentTarget.decode().catch(() => {}).then(() => setReady(true)); }} onError={() => setError("绘图图片无法解码")} /> : <span style={{ fontSize: 12, color: "#64748b" }}>绘图中…</span>}
  </span>;
}
