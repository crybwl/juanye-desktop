import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankBook,validateBookProject,upgradeBookLayoutVersion,type BookNode} from './book-model';
import {DEFAULT_BOOK_BLOCK_STYLES,bookAnswerAreaHeightMm} from './book-blocks';
import {renderBookAnswerArea,resolveBookBlockLabels} from './book-block-render';
import {buildBookDocument} from './book-render';
const block=(id:string):BookNode=>({type:'callout',attrs:{styleId:id},content:[{type:'paragraph',content:[{type:'text',text:'正文内容'}]}]});
test('block counters resolve globally, independently and reset by chapter or section',()=>{
  const b=createBlankBook();b.chapters=b.chapters.filter(ch=>ch.kind==='chapter');
  b.styles=structuredClone([...DEFAULT_BOOK_BLOCK_STYLES]);
  const a=block('example'),c=block('example'),p=block('practice'),p2=block('practice'),d=block('example');
  b.chapters[0].content={type:'doc',content:[a,c,p,{type:'heading',attrs:{level:2},content:[{type:'text',text:'新节'}]},p2]};
  b.chapters.push({id:'second',title:'二',kind:'chapter',content:{type:'doc',content:[d]}});
  const labels=resolveBookBlockLabels(b);
  assert.deepEqual([a,c,p,p2,d].map(n=>labels.get(n)),['例1.1','例1.2','1','1','例2.1']);
  b.styles[1].counter!.reset='book';assert.equal(resolveBookBlockLabels(b).get(d),'例2.3');
  assert.equal(buildBookDocument(b,'second').html.includes('例2.3'),true);
});
test('answer areas have physical geometry, vector backgrounds and bounded validated settings',()=>{
  assert.equal(bookAnswerAreaHeightMm({unit:'lines',size:5,lineHeight:7}),35);
  assert.equal(bookAnswerAreaHeightMm({unit:'mm',size:40,lineHeight:7}),40);
  for(const kind of ['blank','lines','grid','coordinate']){
    const h=renderBookAnswerArea({kind,unit:'mm',size:35});assert.match(h,/height:35mm/);
    assert.equal(h.includes('background-image'),kind!=='blank');assert.equal(h.includes('book-answer-axes'),kind==='coordinate');
  }
  const b=createBlankBook();b.chapters[1].content.content!.push({type:'answerArea',attrs:{kind:'lines',unit:'mm',size:-1}});
  assert.throws(()=>validateBookProject(upgradeBookLayoutVersion(b)));
});
test('styles escape titles, only emit trusted icons and survive portable model validation',()=>{
  const b=createBlankBook();b.styles=[{...DEFAULT_BOOK_BLOCK_STYLES[0],id:'custom',title:'<script>标题</script>',icon:'book'}];
  b.chapters[1].content={type:'doc',content:[block('custom')]};
  const checked=validateBookProject(upgradeBookLayoutVersion(b));assert.equal(checked.version,2);
  const d=buildBookDocument(checked);assert.match(d.html,/&lt;script&gt;/);assert.doesNotMatch(d.html,/<script>/);assert.match(d.html,/data-style-id="custom"/);
});
test('legacy unnumbered blocks never consume hidden new-style counter numbers',()=>{
  const b=createBlankBook(),fresh=block('example');
  b.chapters[1].content.content=[{type:'callout',attrs:{kind:'example'},content:[{type:'paragraph'}]},fresh];
  const labels=resolveBookBlockLabels(b);assert.equal(labels.size,1);assert.equal(labels.get(fresh),'例1.1');
});
