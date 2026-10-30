import { useEffect, useRef, useState } from 'react';
import type { BookProject } from '../book-model';

export interface BookPreviewStatus { pages: number; warnings: string[]; errors?: string[]; busy: boolean; error?: string }
export function BookPreview({ book, chapterId, active, fullBook = false, onStatus }: {
  book: BookProject; chapterId: string; active: boolean; fullBook?: boolean; onStatus?: (status: BookPreviewStatus) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null), latest = useRef({ book, chapterId, active, fullBook }); latest.current = { book, chapterId, active, fullBook };
  const callbacks = useRef(onStatus); callbacks.current = onStatus;
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<BookPreviewStatus>({pages:0,warnings:[],busy:false});
  const request = useRef('');
  // Full-book preview is an explicit snapshot. It must not rebuild 300 pages on
  // every typing event; chapter preview stays debounced and editable.
  const fullSnapshot = useRef(book);
  const previousFull = useRef(false);
  if (fullBook && !previousFull.current) fullSnapshot.current = book;
  previousFull.current = fullBook;
  const input = fullBook ? fullSnapshot.current : book;
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = event.data;
      if (message?.type === 'juanye-book-ready') setReady(true);
      if (message?.type === 'juanye-book-result' && message.id === request.current) { const value={ pages: message.pages, warnings: message.warnings || [], errors:message.errors||[], busy: false, ...(message.error ? { error: message.error } : {}) }; setStatus(value); callbacks.current?.(value); }
      if (message?.type === 'juanye-book-drawing' && typeof message.id === 'string' && typeof message.code === 'string' && message.code.length < 200000) {
        const child = frame.current?.contentWindow;
        const job = window.juanye?.renderDrawing(message.code) ?? Promise.reject(Error('绘图请使用桌面应用'));
        void job.then(result => child?.postMessage({ type: 'juanye-book-drawing-result', id: message.id, result }, '*'), error => child?.postMessage({ type: 'juanye-book-drawing-result', id: message.id, error: error instanceof Error ? error.message : String(error) }, '*'));
      }
    };
    window.addEventListener('message', listener); return () => window.removeEventListener('message', listener);
  }, []);
  useEffect(() => {
    if (!active || !ready) return;
    const timer = setTimeout(() => {
      const id = crypto.randomUUID(); request.current = id;
      const value={ pages: 0, warnings: [], busy: true };setStatus(value);callbacks.current?.(value);
      frame.current?.contentWindow?.postMessage({ type: 'juanye-book-render', id, book: input, chapterId: fullBook ? undefined : chapterId }, '*');
    }, 600);
    return () => clearTimeout(timer);
  }, [input, chapterId, active, fullBook, ready]);
  const issues=[...(status.error?[status.error]:[]),...(status.errors||[]),...status.warnings];
  return <div style={{position:'relative',width:'100%',height:'100%'}}><iframe key={fullBook?'full':'chapter'} ref={frame} onLoad={()=>{setReady(false);frame.current?.contentWindow?.postMessage({type:'juanye-book-handshake'},'*');}} title={fullBook ? '教辅全书分页预览' : '教辅章节分页预览'} className="book-preview-frame" data-testid="book-preview" src={new URL('book-renderer.html', document.baseURI).href} style={{ width: '100%', height: '100%', border: 0, background: '#e9edf1' }} />{issues.length>0&&<details className="book-preview-issues" style={{position:'absolute',bottom:12,left:12,right:12,maxHeight:'38%',overflow:'auto',padding:'9px 12px',borderRadius:10,background:'var(--color-panel)',color:'var(--color-fg)',border:'1px solid var(--color-line)'}}><summary>{status.errors?.length||status.error?'导出前需修复':'排版提示'} · {issues.length} 项</summary><ul style={{paddingLeft:20,fontSize:12,marginBottom:0}}>{issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul></details>}</div>;
}
