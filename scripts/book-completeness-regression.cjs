/* Detect partial question loss at page boundaries in the real bundled engine. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright');
const {stressBook}=require('./book-workspace-regression.cjs');
const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'juanye-book-completeness-'));
const env={...process.env,JUANYE_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
(async()=>{let app;try{
  app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[root,'--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows'],env});
  await app.evaluate(async({BrowserWindow},root)=>{const win=new BrowserWindow({width:1100,height:900,show:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});globalThis.__bookCompletenessWindow=win;win.setPosition(-16000,-16000);win.showInactive();await win.loadFile(root+'/dist/book-renderer.html');},root);
  const page=app.windows().find(value=>value.url().endsWith('book-renderer.html'));
  await page.waitForFunction(()=>typeof window.renderJuanyeBook==='function');
  const book=stressBook();book.chapters=book.chapters.slice(0,5);book.questions=Object.fromEntries(Object.entries(book.questions).slice(0,100));
  const result=await page.evaluate(async book=>{const rendered=await window.renderJuanyeBook(book);const text=document.querySelector('#book-pages').textContent;return{...rendered,questionIds:[...text.matchAll(/长书稿第\s*(\d+)\s*题/g)].map(match=>Number(match[1])),solutions:document.querySelectorAll('[data-book-solution]').length,missingNodes:[...document.querySelectorAll('[data-book-question]')].filter(node=>!node.textContent.includes('长书稿第')).map(node=>({id:node.dataset.bookQuestion,text:node.textContent.slice(0,90)}))};},book);
  const output=path.join(root,'artifacts/qa-book-completeness');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.questionIds,Array.from({length:100},(_,i)=>i+1));assert.equal(result.solutions,100);assert.deepEqual(result.missingNodes,[]);
}finally{await app?.close().catch(()=>app.process().kill());const resolved=fs.realpathSync(profile);if(path.dirname(resolved).toLowerCase()===fs.realpathSync(os.tmpdir()).toLowerCase()&&path.basename(resolved).startsWith('juanye-book-completeness-'))fs.rmSync(resolved,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
