import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { BOOK_PAPER_MM, bookQuestionIds, bookQuestionNumbers, copyExamIntoBook, createBlankBook, insertBookQuestions, validateBookProject, type BookNode } from './book-model';
import { exportBookProject, importBookProject } from './book-project';
import type { Question } from './types';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1EAAAAASUVORK5CYII=';
const question = (): Question => ({ id:'source-q',type:'single',score:5,stem:'$1+1=$',options:['$2$','$3$'],answer:['A'],analysis:'相加得$2$。',source:'原始来源',figure:image,knowledge:['加法'],difficulty:'easy',bankOrigin:{libraryId:'library',revisionId:'revision',version:1} });
test('blank book has independent identity, validated defaults and supported paper dimensions',()=>{
  const book=createBlankBook();assert.equal(book.kind,'juanye-book');assert.notEqual(book.id,createBlankBook().id);assert.equal(validateBookProject(book).title,book.title);assert.deepEqual(BOOK_PAPER_MM.B5,[176,250]);
});
test('question insertion makes independent snapshots and numbering follows chapter order',()=>{
  const original=question(),book=createBlankBook(),chapterId=book.chapters[1].id;
  const first=insertBookQuestions(book,chapterId,[original,original]);const ids=bookQuestionIds(first.chapters[1].content);
  assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);assert.notEqual(ids[0],original.id);assert.equal(Object.keys(book.questions).length,0);
  assert.deepEqual(bookQuestionNumbers(first).get(ids[1]),{number:2,label:'1.2',chapterId});
  first.questions[ids[0]].stem='本地修改';assert.equal(original.stem,'$1+1=$');assert.deepEqual(first.questions[ids[0]].bankOrigin,original.bankOrigin);
  const secondId='second-chapter',second=insertBookQuestions({...first,chapters:[...first.chapters,{id:secondId,title:'第二章',kind:'chapter',content:{type:'doc',content:[]}}]},secondId,[original]);
  const last=bookQuestionIds(second.chapters[2].content)[0];assert.equal(bookQuestionNumbers(second).get(last)?.label,'2.1');
  assert.equal(bookQuestionNumbers({...second,settings:{...second.settings,numbering:'book'}}).get(last)?.label,'3');
  const prefaced=insertBookQuestions(second,second.chapters[0].id,[original]),front=bookQuestionIds(prefaced.chapters[0].content)[0];assert.equal(bookQuestionNumbers(prefaced).get(front)?.label,'前置1.1');assert.equal(new Set([...bookQuestionNumbers(prefaced).values()].map(item=>item.label)).size,4);
  assert.throws(()=>insertBookQuestions(book,'missing',[original]),/章节/);
});
test('copying an existing paper preserves source data without mutating the paper or bank',()=>{
  const q=question(),exam={id:'paper',title:'数学试卷',subtitle:'',duration:90,notice:[],sections:[{id:'s',type:'single' as const,title:'选择题',note:'',questions:[q]}]};
  const before=structuredClone(exam),book=copyExamIntoBook(exam);assert.deepEqual(exam,before);assert.equal(book.chapters[1].title,'选择题');assert.equal(Object.values(book.questions)[0].source,'原始来源');assert.notEqual(Object.values(book.questions)[0].id,q.id);
});
test('validation preserves rich content and rejects active resources, unknown HTML and duplicate references',()=>{
  const base=createBlankBook();
  const book=insertBookQuestions(base,base.chapters[1].id,[question()]);
  const doc=book.chapters[1].content;
  doc.content!.push({type:'paragraph',attrs:{spaceBefore:4,spaceAfter:6,textAlign:'justify'},content:[{type:'text',text:'正文',marks:[{type:'textStyle',attrs:{fontSize:'12pt',color:'#123456'}}]},{type:'inlineMath',attrs:{latex:'x^2'}}]},{type:'image',attrs:{src:image,width:45,align:'right'}},{type:'callout',attrs:{kind:'hint'},content:[{type:'paragraph'}]});
  assert.equal(validateBookProject(book).chapters[1].content.content?.length,5);
  for(const unsafe of [
    {type:'image',attrs:{src:'https://example.com/private.png'}},
    {type:'paragraph',attrs:{onclick:'alert(1)'}},
    {type:'script',content:[]},
    {type:'paragraph',content:[{type:'text',text:'x',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]}]},
  ] as BookNode[]){const invalid=structuredClone(book);invalid.chapters[1].content.content!.push(unsafe);assert.throws(()=>validateBookProject(invalid));}
  const duplicate=structuredClone(book);duplicate.chapters[1].content.content!.push(duplicate.chapters[1].content.content![1]);assert.throws(()=>validateBookProject(duplicate),/重复/);
  const missing=structuredClone(book);delete missing.questions[Object.keys(missing.questions)[0]];assert.throws(()=>validateBookProject(missing),/缺失/);
});
test('invalid document hierarchy is rejected before the editor can normalize or lose imported content',()=>{
  const cases:BookNode[]=[
    {type:'doc',content:[{type:'text',text:'正文不能直接挂在文档根节点'}]},
    {type:'doc',content:[{type:'paragraph',content:[{type:'table',content:[]}]}]},
    {type:'doc',content:[{type:'table',content:[{type:'paragraph'}]}]},
    {type:'doc',content:[{type:'bulletList',content:[{type:'paragraph'}]}]},
    {type:'doc',content:[{type:'callout',attrs:{kind:'hint'},content:[]}]},
    {type:'doc',content:[{type:'paragraph',content:[{type:'text'}]}]},
    {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:''}]}]},
    {type:'doc',content:[{type:'heading',attrs:{level:2.5},content:[{type:'text',text:'非法标题'}]}]},
    {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'不支持的样式',marks:[{type:'highlight'}]}]}]},
  ];
  for(const content of cases){const book=createBlankBook();book.chapters[1].content=content;assert.throws(()=>validateBookProject(book));}
});
test('portable project retains editable JSON and deduplicates embedded images with hash validation',async()=>{
  let book=createBlankBook();book=insertBookQuestions(book,book.chapters[1].id,[question(),question()]);
  book.chapters[1].content.content!.push({type:'image',attrs:{src:image,width:50,align:'center'}},{type:'paragraph',content:[{type:'text',text:'asset:这是普通正文，不是附件引用'}]});
  const bytes=await exportBookProject(book),zip=await JSZip.loadAsync(bytes);assert.ok(zip.file('manifest.json'));assert.ok(zip.file('project.json'));
  assert.equal(Object.values(zip.files).filter(entry=>!entry.dir&&entry.name.startsWith('assets/')).length,1);
  const imported=await importBookProject(bytes);assert.deepEqual(imported,validateBookProject(book));
  const path=Object.keys(zip.files).find(name=>name.startsWith('assets/')&&!zip.files[name].dir)!;zip.file(path,new Uint8Array([1,2,3]));await assert.rejects(importBookProject(await zip.generateAsync({type:'uint8array'})),/校验/);
});
test('import refuses unrelated or unsafe ZIPs and missing picture references',async()=>{
  await assert.rejects(importBookProject(new Uint8Array([1,2,3])),/ZIP/);
  const zip=new JSZip();zip.file('../outside.txt','not allowed');zip.file('manifest.json','{}');zip.file('project.json','{}');await assert.rejects(importBookProject(await zip.generateAsync({type:'uint8array'})),/不安全|未知/);
  const book=createBlankBook(),file=new JSZip(),encoded=JSON.stringify({...book,chapters:[{...book.chapters[0],content:{type:'doc',content:[{type:'image',attrs:{src:{__juanyeAsset:`assets/${'a'.repeat(64)}.png`}}}]}}]});
  const projectSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(encoded)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');file.file('manifest.json',JSON.stringify({schema:'juanye-book/1',project:'project.json',projectSha256}));
  file.file('project.json',encoded);
  await assert.rejects(importBookProject(await file.generateAsync({type:'uint8array'})),/缺失/);
});
