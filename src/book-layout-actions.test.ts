import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankBook,insertBookQuestions} from './book-model';
import {setBookQuestionAnswerAreas,setBookBlockStyle,removeBookBlockStyle} from './book-layout-actions';
import {DEFAULT_BOOK_BLOCK_STYLES} from './book-blocks';
test('batch writing areas are atomic, repeatable and preserve questions and source',()=>{
 let b=createBlankBook();b=insertBookQuestions(b,b.chapters[1].id,[{id:'q',type:'essay',score:10,stem:'题干',options:[],answer:['答'],analysis:'解析'}]);
 const id=Object.keys(b.questions)[0],before=structuredClone(b);
 const after=setBookQuestionAnswerAreas(b,[id],{kind:'grid',unit:'mm',size:40});
 assert.equal(after.version,2);assert.deepEqual(b,before);assert.deepEqual(after.questions,b.questions);
 assert.deepEqual(setBookQuestionAnswerAreas(after,[id],{kind:'grid',unit:'mm',size:40}),after);
 assert.throws(()=>setBookQuestionAnswerAreas(b,[id,'missing'],{size:5}));assert.deepEqual(b,before);
});
test('style deletion never silently leaves a broken reference',()=>{
 let b=createBlankBook();b=setBookBlockStyle(b,{...DEFAULT_BOOK_BLOCK_STYLES[0],id:'user'});
 b.chapters[1].content.content!.push({type:'callout',attrs:{styleId:'user'},content:[{type:'paragraph'}]});
 assert.throws(()=>removeBookBlockStyle(b,'user'));
 const removed=removeBookBlockStyle(b,'user','lesson');assert.equal(removed.styles!.some(s=>s.id==='user'),false);
 assert.equal(removed.chapters[1].content.content!.at(-1)!.attrs!.styleId,'lesson');
});

test('partial writing-area changes preserve existing physical height and pagination',()=>{
 let b=createBlankBook();b=insertBookQuestions(b,b.chapters[1].id,[{id:'q',type:'essay',score:10,stem:'题干',options:[],answer:[],analysis:''}]);
 const id=Object.keys(b.questions)[0];
 b=setBookQuestionAnswerAreas(b,[id],{kind:'grid',unit:'mm',size:62,gridSize:4});
 const area=b.chapters[1].content.content!.at(-1)!;area.attrs!.keepTogether=false;area.attrs!.spaceAfter=12;
 const next=setBookQuestionAnswerAreas(b,[id],{kind:'coordinate'}),attrs=next.chapters[1].content.content!.at(-1)!.attrs!;
 assert.equal(attrs.kind,'coordinate');assert.equal(attrs.unit,'mm');assert.equal(attrs.size,62);assert.equal(attrs.gridSize,4);
 assert.equal(attrs.keepTogether,false);assert.equal(attrs.spaceAfter,12);
 assert.equal(b.chapters[1].content.content!.at(-1)!.attrs!.kind,'grid');
});
