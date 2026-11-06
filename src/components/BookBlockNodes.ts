import { Node, Extension, mergeAttributes } from '@tiptap/core';
import { DEFAULT_BOOK_ANSWER_AREA, bookAnswerAreaHeightMm, validBookAnswerAreaAttrs, type BookAnswerAreaAttrs } from '../book-blocks';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bookBlocks: {
      insertBookAnswerArea: (attrs?: Partial<BookAnswerAreaAttrs>) => ReturnType;
      setBookAnswerAreas: (attrs: Partial<BookAnswerAreaAttrs>, scope?: 'selection' | 'chapter') => ReturnType;
      insertStyledBookBlock: (styleId: string) => ReturnType;
    };
  }
}
export const BookAnswerArea = Node.create({
  name:'answerArea',group:'block',atom:true,selectable:true,
  addAttributes(){return Object.fromEntries(Object.entries(DEFAULT_BOOK_ANSWER_AREA).map(([name,value])=>[name,{default:value}]));},
  parseHTML(){return [{tag:'div[data-book-answer-area]',getAttrs:el=>{
    try{const attrs={...DEFAULT_BOOK_ANSWER_AREA,...JSON.parse((el as HTMLElement).getAttribute('data-book-answer-area')||'{}')};return validBookAnswerAreaAttrs(attrs)?attrs:false;}catch{return false;}
  }}];},
  renderHTML({HTMLAttributes}){
    const merged={...DEFAULT_BOOK_ANSWER_AREA,...HTMLAttributes};
    const a=validBookAnswerAreaAttrs(merged)?merged:DEFAULT_BOOK_ANSWER_AREA;
    const height=bookAnswerAreaHeightMm(a);
    return ['div',mergeAttributes({'data-book-answer-area':JSON.stringify(a),class:'book-editor-answer-area',contenteditable:'false',style:`height:${height}mm;border:1px dashed #a0aab4;position:relative;background:var(--surface,#f8f9fa)`}),a.kind==='blank'?'空白作答区':a.kind==='coordinate'?'坐标纸':a.kind==='grid'?'方格作答区':'横线作答区'];
  },
  addCommands(){return {
    insertBookAnswerArea:(attrs={})=>({commands})=>{const area={...DEFAULT_BOOK_ANSWER_AREA,...attrs};return validBookAnswerAreaAttrs(area)&&commands.insertContent({type:'answerArea',attrs:area});},
    setBookAnswerAreas:(attrs,scope='selection')=>({state,tr,dispatch})=>{
      const {from,to}=state.selection;const updates:{pos:number;attrs:Record<string,unknown>}[]=[];let valid=true;
      state.doc.descendants((node,pos)=>{if(node.type.name==='answerArea'&&(scope==='chapter'||pos+node.nodeSize>from&&pos<to)){const next={...node.attrs,...attrs};if(!validBookAnswerAreaAttrs(next))valid=false;updates.push({pos,attrs:next});}});
      if(!valid||!updates.length)return false;
      if(dispatch)for(const update of updates)tr.setNodeMarkup(update.pos,undefined,update.attrs);
      return true;
    },
    insertStyledBookBlock:styleId=>({commands})=>commands.insertContent({type:'callout',attrs:{styleId},content:[{type:'paragraph'}]}),
  };},
});
export const BookSpanHeading = Extension.create({
  name:'bookSpanHeading',addGlobalAttributes(){return [{types:['heading'],attributes:{columnSpan:{default:null,parseHTML:el=>el.getAttribute('data-column-span')==='all'?'all':null,renderHTML:a=>a.columnSpan==='all'?{'data-column-span':'all'}:{}}}}];},
});
