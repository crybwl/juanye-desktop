import { memo, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LoaderCircle } from 'lucide-react';
import type { BookProject } from '../book-model';
import { useRichMotion } from './bank-motion';

export interface BookPreviewStatus { pages: number; warnings: string[]; errors?: string[]; busy: boolean; error?: string }
export const BookPreview = memo(function BookPreview({ book, chapterId, active, fullBook = false, onStatus }: {
  book: BookProject; chapterId: string; active: boolean; fullBook?: boolean; onStatus?: (status: BookPreviewStatus) => void;
}) {
  const rich = useRichMotion(), frame = useRef<HTMLIFrameElement>(null);
  const callbacks = useRef(onStatus); callbacks.current = onStatus;
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<BookPreviewStatus>({ pages: 0, warnings: [], busy: false });
  const latestStatus = useRef(status); latestStatus.current = status;
  const request = useRef('');
  const sent = useRef<{ book: BookProject; chapterId?: string }>();
  // Tabs and panel collapse keep decoded pages and their scroll position alive.
  const fullSnapshot = useRef(book), previousFull = useRef(false);
  if (fullBook && !previousFull.current) fullSnapshot.current = book;
  previousFull.current = fullBook;
  const input = fullBook ? fullSnapshot.current : book;
  const targetChapter = fullBook ? undefined : chapterId;

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = event.data;
      if (message?.type === 'juanye-book-ready') setReady(true);
      if (message?.type === 'juanye-book-result' && message.id === request.current) {
        const value = { pages: message.pages, warnings: message.warnings || [], errors: message.errors || [], busy: false,
          ...(message.error ? { error: message.error } : {}) };
        if (message.error || message.errors?.length) sent.current = undefined;
        setStatus(value); callbacks.current?.(value);
      }
      if (message?.type === 'juanye-book-drawing' && typeof message.id === 'string' && typeof message.code === 'string' && message.code.length < 200000) {
        const child = frame.current?.contentWindow;
        const job = window.juanye?.renderDrawing(message.code) ?? Promise.reject(Error('绘图请使用桌面应用'));
        void job.then(result => child?.postMessage({ type: 'juanye-book-drawing-result', id: message.id, result }, '*'),
          error => child?.postMessage({ type: 'juanye-book-drawing-result', id: message.id, error: error instanceof Error ? error.message : String(error) }, '*'));
      }
    };
    window.addEventListener('message', listener); return () => window.removeEventListener('message', listener);
  }, []);
  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage({ type: 'juanye-book-motion', rich: rich && active }, '*');
  }, [ready, rich, active]);
  useEffect(() => {
    if (!active || !ready || sent.current?.book === input && sent.current.chapterId === targetChapter) return;
    const timer = setTimeout(() => {
      const id = crypto.randomUUID(); request.current = id;
      sent.current = { book: input, chapterId: targetChapter };
      const value = { ...latestStatus.current, busy: true }; setStatus(value); callbacks.current?.(value);
      frame.current?.contentWindow?.postMessage({ type: 'juanye-book-render', id, book: input, chapterId: targetChapter }, '*');
    }, 600);
    return () => clearTimeout(timer);
  }, [input, targetChapter, active, ready]);
  const issues = [...(status.error ? [status.error] : []), ...(status.errors || []), ...status.warnings];
  return <div className="book-preview-container" aria-busy={status.busy}>
    <iframe ref={frame} onLoad={() => { sent.current = undefined; setReady(false); frame.current?.contentWindow?.postMessage({ type: 'juanye-book-handshake' }, '*'); }}
      title={fullBook ? '教辅全书分页预览' : '教辅章节分页预览'} className="book-preview-frame" data-testid="book-preview" src={new URL('book-renderer.html', document.baseURI).href}/>
    <AnimatePresence initial={false}>{status.busy && <motion.div key="progress" className="book-preview-progress" role="status"
      initial={rich ? { opacity: 0, transform: 'translateY(6px)' } : false} animate={{ opacity: 1, transform: 'translateY(0px)' }}
      exit={{ opacity: 0, transition: { duration: rich ? .1 : 0 } }} transition={{ duration: rich ? .16 : 0 }}><LoaderCircle size={13}/><span>正在分页</span></motion.div>}</AnimatePresence>
    {issues.length > 0 && <details className="book-preview-issues"><summary>{status.errors?.length || status.error ? '导出前需修复' : '排版提示'} · {issues.length} 项</summary><ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details>}
  </div>;
});
