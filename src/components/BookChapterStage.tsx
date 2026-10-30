import { useRef, useState, type RefCallback } from 'react';
import { BookEditor, type BookEditorHandle, type BookEditorProps } from './BookEditor';
import { BookMotionItem, bookSpring } from './book-motion';
import { useRichMotion } from './bank-motion';

type Frame = BookEditorProps & { editorRef: RefCallback<BookEditorHandle> };

/** Immediate selection with at most one outgoing editor. A new selection
 * interrupts an obsolete exit, not the new entry; rapid navigation never
 * creates a backlog of large Tiptap trees or clears the current editor's ref. */
export function BookChapterStage({ direction, ...current }: Frame & { direction: number }) {
  const rich = useRichMotion();
  const previousRender = useRef<Frame>(current);
  const [transition, setTransition] = useState<{ id: string; outgoing: Frame | null }>({ id: current.chapter.id, outgoing: null });
  if (transition.id !== current.chapter.id) setTransition({ id: current.chapter.id, outgoing: previousRender.current });
  previousRender.current = current;
  const frames = transition.outgoing && transition.outgoing.chapter.id !== current.chapter.id ? [transition.outgoing, current] : [current];
  return <div className="book-editor-stage">{frames.map(frame => {
    const selected = frame.chapter.id === current.chapter.id;
    return <BookMotionItem key={frame.chapter.id} className="book-chapter-pane" data-book-chapter-pane={frame.chapter.id}
      data-phase={selected ? 'active' : 'exiting'} aria-hidden={!selected} {...(!selected ? { inert: '' } : {})}
      initial={rich ? { opacity: 0, transform: `translateY(${direction * 13}px)` } : false}
      animate={{ opacity: selected ? 1 : 0, transform: rich && !selected ? `translateY(${-direction * 9}px)` : 'translateY(0px)' }}
      transition={rich ? selected ? { ...bookSpring, opacity: { duration: .2 } } : { duration: .13, ease: [.2,.8,.2,1] } : { duration: 0 }}
      onAnimationComplete={() => { if (!selected) setTransition(value => value.outgoing?.chapter.id === frame.chapter.id ? { ...value, outgoing: null } : value); }}>
      <BookEditor {...frame} ref={frame.editorRef} active={frame.active && selected}
        onChange={value => { if (selected) frame.onChange(value); }}
        onQuestionChange={(id, patch) => { if (selected) frame.onQuestionChange(id, patch); }}
        onCloneQuestion={id => selected ? frame.onCloneQuestion?.(id) : undefined}/>
    </BookMotionItem>;
  })}</div>;
}
