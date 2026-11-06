import { upgradeBookLayoutVersion, validateBookProject, type BookNode, type BookProject } from './book-model';
import { DEFAULT_BOOK_ANSWER_AREA, DEFAULT_BOOK_BLOCK_STYLES, type BookAnswerAreaAttrs, type BookBlockStyle } from './book-blocks';

/** Pure transactions for UI use: validate first, never mutate the previous book. */
export function setBookBlockStyle(book: BookProject, style: BookBlockStyle): BookProject {
  const styles = structuredClone(book.styles ?? [...DEFAULT_BOOK_BLOCK_STYLES]);
  const index = styles.findIndex(item=>item.id===style.id);
  if(index<0) styles.push(structuredClone(style)); else styles[index]=structuredClone(style);
  return validateBookProject(upgradeBookLayoutVersion({...book,styles}));
}
export function removeBookBlockStyle(book: BookProject, id: string, replacement?: string): BookProject {
  const styles = [...(book.styles ?? DEFAULT_BOOK_BLOCK_STYLES)];
  if(!styles.some(s=>s.id===id)) throw Error('块样式不存在');
  if(replacement===id||replacement&&!styles.some(s=>s.id===replacement))throw Error('替代样式不存在');
  const visit=(node:BookNode):BookNode=>{
    const used=node.type==='callout'&&String(node.attrs?.styleId||node.attrs?.kind||'lesson')===id;
    if(used&&!replacement)throw Error('仍有内容使用此样式，请先指定替代样式');
    return {...node,...(used?{attrs:{...node.attrs,kind:null,styleId:replacement}}:{}),...(node.content?{content:node.content.map(visit)}:{})};
  };
  return validateBookProject(upgradeBookLayoutVersion({...book,styles:styles.filter(s=>s.id!==id),chapters:book.chapters.map(ch=>({...ch,content:visit(ch.content)}))}));
}
/** Add/update a writing area after each requested question in a single undoable transaction. */
export function setBookQuestionAnswerAreas(book:BookProject, ids:readonly string[], attrs:Partial<BookAnswerAreaAttrs>):BookProject {
  if (!ids.length) return book;
  const selected=new Set(ids),found=new Set<string>();
  const visit=(node:BookNode):BookNode=>{
    if(!node.content)return node;
    const content:BookNode[]=[];
    for(let i=0;i<node.content.length;i++){
      const child=node.content[i];content.push(visit(child));
      if(child.type==='bookQuestion'&&selected.has(String(child.attrs?.questionId))){
        found.add(String(child.attrs!.questionId));
        const next=node.content[i+1];
        content.push({type:'answerArea',attrs:{...DEFAULT_BOOK_ANSWER_AREA,...(next?.type==='answerArea'?next.attrs:{}),...attrs}});
        if(next?.type==='answerArea')i++;
      }
    }
    return {...node,content};
  };
  const chapters=book.chapters.map(ch=>({...ch,content:visit(ch.content)}));
  if([...selected].some(id=>!found.has(id)))throw Error('目标题目不在书稿中，未应用批量作答区');
  return validateBookProject(upgradeBookLayoutVersion({...book,chapters}));
}
