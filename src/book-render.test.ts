import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankBook, type BookProject } from './book-model';
import { buildBookDocument } from './book-render';
import { CUBE_TIKZ } from './drawing';

function fixture():BookProject {
  const book=createBlankBook();book.title='教辅 <安全> 标题';book.author='编者';
  book.chapters=[{id:'cover',title:'封面',kind:'cover',content:{type:'doc',content:[]}},{id:'ch1',title:'第一章',kind:'chapter',content:{type:'doc',content:[
    {type:'heading',attrs:{level:2},content:[{type:'text',text:'函数与代数'}]},
    {type:'paragraph',content:[{type:'text',text:'已知 $x^2+1$，求值。'}]},
    {type:'bookQuestion',attrs:{questionId:'q1'}},
    {type:'table',content:[{type:'tableRow',content:[{type:'tableHeader',content:[{type:'paragraph',content:[{type:'text',text:'变量'}]}]}]},{type:'tableRow',content:[{type:'tableCell',content:[{type:'paragraph',content:[{type:'inlineMath',attrs:{latex:'x^2'}}]}]}]}]},
  ]}},{id:'ch2',title:'第二章',kind:'chapter',content:{type:'doc',content:[{type:'bookQuestion',attrs:{questionId:'q2'}}]}}];
  book.questions={q1:{id:'q1',type:'single',score:5,stem:'1. 计算 $1+1$。',options:['$1$','$2$'],answer:['B'],analysis:'相加得 $2$。'},q2:{id:'q2',type:'essay',score:10,stem:'观察立方体。',drawing:CUBE_TIKZ,options:[],answer:['证明见解析'],analysis:'连接顶点。'}};
  return book;
}
test('book projection keeps question numbering, formulas, tables, drawings and generated answer references',()=>{
  const book=fixture(),copy=structuredClone(book),result=buildBookDocument(book);
  assert.match(result.html,/1\.1\./);assert.match(result.html,/2\.1\./);assert.match(result.html,/katex/);assert.match(result.html,/<thead>/);
  assert.match(result.html,/href="#bk-ch1"/);assert.match(result.css,/target-counter/);assert.match(result.css,/@page :left/);
  assert.match(result.html,/id="bk-ch1-heading-1"/);assert.match(result.html,/href="#bk-ch1-heading-1"/);
  assert.match(result.html,/data-book-solution="q1"/);assert.equal(result.drawings.length,1);assert.equal(result.drawings[0].code,CUBE_TIKZ);
  assert.equal((result.html.match(/计算/g)||[]).length,1);assert.equal(result.errors.length,0);assert.deepEqual(book,copy);
});
test('chapter previews do not accidentally duplicate the whole book or its full answer section',()=>{
  const result=buildBookDocument(fixture(),'ch1');assert.match(result.html,/第一章/);assert.doesNotMatch(result.html,/第二章|book-toc|data-book-solution/);
  const chapter=fixture();chapter.settings.answers='chapter';assert.match(buildBookDocument(chapter,'ch1').html,/本章参考答案/);
  const inline=fixture();inline.settings.answers='inline';assert.equal((buildBookDocument(inline).html.match(/data-book-solution=/g)||[]).length,2);
  const empty=createBlankBook();empty.settings.answers='chapter';assert.doesNotMatch(buildBookDocument(empty,empty.chapters[1].id).html,/本章参考答案|book-chapter-answers/);
});
test('node text and attributes never inject executable HTML, external media or raw styles',()=>{
  const book=fixture();book.chapters[1].content.content!.push({type:'paragraph',content:[{type:'text',text:'<script>alert(1)</script><img src=x onerror=alert(2)>'}]},{type:'image',attrs:{src:'https://example.test/private.png',align:'right',width:30}});
  const result=buildBookDocument(book);assert.doesNotMatch(result.html,/<script|<[^>]+\sonerror=|src="https/);assert.match(result.html,/&lt;script&gt;/);assert.ok(result.errors.some(value=>value.includes('图片缺失')));
  assert.equal(result.html.includes(book.title),false);assert.match(result.html,/&lt;安全&gt;/);
});
test('unknown formulas, unsupported blocks and missing question media yield actionable preflight errors',()=>{
  const book=fixture();book.chapters[1].content.content!.push({type:'blockMath',attrs:{latex:'\\notARealMathCommand{a}'}},{type:'unknown-block',content:[]});
  const result=buildBookDocument(book);assert.ok(result.errors.some(value=>value.includes('公式')));assert.ok(result.errors.some(value=>value.includes('不支持')));
});
test('local image placement and inherited paragraph spacing survive the print projection',()=>{
  const book=fixture();const image='data:image/png;base64,iVBORw0KGgo=';
  book.questions.q1.figures=[{id:'figure',src:image,layout:'right',width:20}];
  book.chapters[1].content.content!.push({type:'image',attrs:{src:image,width:40,align:'right',spaceAfter:9}},{type:'paragraph',attrs:{spaceBefore:null,spaceAfter:null},content:[{type:'text',text:'继承全局段距'}]});
  const result=buildBookDocument(book);
  assert.match(result.html,/class="book-question-figures" style="width:20%"/);
  assert.match(result.html,/class="book-image-block" style="float:right;width:40%;margin-left:4mm;margin-bottom:9pt"/);
  assert.match(result.html,/<p>继承全局段距<\/p>/);
  assert.doesNotMatch(result.css,/@media print/,'Print-surface CSS must bypass Paged.js media rewriting so the onscreen preview remains scaled');
});
