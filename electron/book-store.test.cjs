const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const { createBookStore, validateStoredBook, installBookHandlers }=require('./book-store.cjs');
const fixture=()=>({version:1,kind:'juanye-book',id:'book-qa',title:'隔离书稿',author:'测试',chapters:[{id:'c1',title:'第一章',kind:'chapter',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'不含用户资料'}]}]}}],questions:{},settings:{paper:'B5',marginTop:17,marginBottom:17,marginInner:20,marginOuter:16,fontFamily:'SimSun, serif',fontSize:10.5,lineHeight:1.65,paragraphGap:2,questionGap:3,numbering:'chapter',answers:'book',toc:true,pageNumbers:true,header:'',footer:'',chapterNewPage:true}});
async function sandbox(run){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'juanye-book-store-'));try{return await run(directory);}finally{const resolved=await fs.realpath(directory),temporary=await fs.realpath(os.tmpdir());assert.equal(path.dirname(resolved).toLowerCase(),temporary.toLowerCase());assert.ok(path.basename(resolved).startsWith('juanye-book-store-'));await fs.rm(resolved,{recursive:true,force:true});}}
test('book store is independent, queued, durable and preserves the previous draft',()=>sandbox(async directory=>{
  await fs.writeFile(path.join(directory,'draft.json'),'ORIGINAL EXAM');await fs.writeFile(path.join(directory,'question-bank.json'),'ORIGINAL BANK');
  const store=createBookStore({directory});assert.equal(await store.load(),null);
  const first=fixture(),second={...fixture(),title:'第二版'};await Promise.all([store.save(first),store.save(second)]);await store.flush();
  assert.equal((await store.load()).title,'第二版');assert.equal(JSON.parse(await fs.readFile(path.join(directory,'book-draft.backup.json'),'utf8')).title,'隔离书稿');
  assert.equal(await fs.readFile(path.join(directory,'draft.json'),'utf8'),'ORIGINAL EXAM');assert.equal(await fs.readFile(path.join(directory,'question-bank.json'),'utf8'),'ORIGINAL BANK');
  assert.equal((await createBookStore({directory}).load()).title,'第二版');
}));
test('damaged book never silently resets; explicit backup recovery preserves bad bytes',()=>sandbox(async directory=>{
  const store=createBookStore({directory});await store.save(fixture());await store.save({...fixture(),title:'较新版'});await fs.writeFile(path.join(directory,'book-draft.json'),'{damaged');
  await assert.rejects(store.load(),/损坏/);await assert.rejects(store.save(fixture()),/损坏/);assert.equal(await fs.readFile(path.join(directory,'book-draft.json'),'utf8'),'{damaged');
  const recovered=await store.restore();assert.equal(recovered.title,'隔离书稿');
  const preserved=(await fs.readdir(directory)).find(name=>name.startsWith('book-draft.before-restore-'));assert.ok(preserved);assert.equal(await fs.readFile(path.join(directory,preserved),'utf8'),'{damaged');
}));
test('manual versions are independently readable and bounded without deleting old versions',()=>sandbox(async directory=>{
  const store=createBookStore({directory});const first=await store.checkpoint(fixture());await store.save({...fixture(),title:'当前稿'});
  assert.equal((await store.version(first.id)).title,'隔离书稿');assert.equal((await store.load()).title,'当前稿');assert.equal((await store.versions()).length,1);await assert.rejects(store.version('../draft'),/ID/);
  for(let i=1;i<20;i++)await store.checkpoint({...fixture(),title:`版本${i}`});await assert.rejects(store.checkpoint(fixture()),/20/);assert.equal((await store.versions()).length,20);assert.equal((await store.version(first.id)).title,'隔离书稿');
}));
test('main envelope rejects unsafe resources, settings and malicious structure',()=>{
  assert.equal(validateStoredBook(fixture()).title,'隔离书稿');
  for(const mutate of [book=>{book.settings.marginTop=-1;},book=>{book.settings.fontFamily='serif;url(https://bad)';},book=>{book.chapters[0].content.content.push({type:'image',attrs:{src:'https://bad/private'}});},book=>{book.chapters[0].content.content.push({type:'paragraph',attrs:{onclick:'alert(1)'}});},book=>{book.chapters[0].content.content.push({type:'bookQuestion',attrs:{questionId:'missing'}});}]){const value=fixture();mutate(value);assert.throws(()=>validateStoredBook(value));}
});
test('project export uses only explicit native save and rejects non-ZIP bytes',()=>sandbox(async directory=>{
  const handlers=new Map();let shown=0;const output=path.join(directory,'portable.juanye-book');
  installBookHandlers({directory,handle:(name,handler)=>handlers.set(name,handler),getWindow:()=>null,dialog:{showSaveDialog:async()=>{shown++;return{canceled:false,filePath:output};}}});
  await assert.rejects(handlers.get('book:export')({name:'x',bytes:[1,2,3]}),/ZIP/);assert.equal(shown,0);
  await handlers.get('book:export')({name:'x',bytes:[0x50,0x4b,3,4]});assert.equal(shown,1);assert.deepEqual([...await fs.readFile(output)],[0x50,0x4b,3,4]);
}));
