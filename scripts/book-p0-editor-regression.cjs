/* Isolated P0 schema+editor+persistence check; no real profiles or model requests. */
const { _electron }=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),packaged=process.argv.includes('--packaged');
const out=path.join(root,'artifacts/qa-book-p0-editor',...(packaged?['packaged']:[]));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const p=text=>({type:'paragraph',content:[{type:'text',text}]});
async function main(){
 fs.mkdirSync(out,{recursive:true});const profile=fs.mkdtempSync(path.join(os.tmpdir(),'juanye-book-p0-'));
 const {initialBook}=require('./book-workspace-regression.cjs'),b=initialBook();b.version=2;b.settings.optionColumns='auto';
 b.chapters=b.chapters.filter(ch=>ch.kind==='chapter');b.chapters[0].content={type:'doc',content:[p('P0_EDIT_START'),{type:'columnSet',attrs:{count:2,gap:6,rule:true},content:[p('COLUMN_ONE'),{type:'columnBreak'},p('COLUMN_TWO')]},{type:'callout',attrs:{styleId:'example'},content:[p('STYLED_CONTENT')]},{type:'answerArea',attrs:{kind:'coordinate',unit:'mm',size:30,lineHeight:7,gridSize:5}},p('P0_EDIT_END')]};
 fs.writeFileSync(path.join(profile,'book-draft.json'),JSON.stringify(b));const env={...process.env,JUANYE_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
 let app,report;try{
 app=await _electron.launch({executablePath:path.join(root,packaged?'release/win-unpacked/卷页.exe':'node_modules/electron/dist/electron.exe'),args:[...(packaged?[]:[root]),'--disable-renderer-backgrounding'],env});
 if(packaged)assert.equal(await app.evaluate(({app})=>app.getVersion()),require('../package.json').version);
 await app.evaluate(({BrowserWindow,ipcMain})=>{const w=BrowserWindow.getAllWindows()[0];w.setPosition(-16000,-16000);w.webContents.setBackgroundThrottling(false);for(const c of ['model:test','model:recognize','model:generate','exam:analyze']){ipcMain.removeHandler(c);ipcMain.handle(c,()=>{throw Error('Model disabled');});}});
 const page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\//,r=>r.abort());
 await page.getByRole('navigation',{name:'工作区'}).getByRole('button',{name:'教辅编辑台',exact:true}).click();
 const prose=page.locator('[data-book-chapter-pane][aria-hidden=false] [aria-label="教辅章节正文"]');await prose.waitFor();
 await prose.locator('>p').first().click();await page.keyboard.press('End');await page.keyboard.type(' SAVED');await page.keyboard.press('Control+s');await pause(1300);
 const load=()=>page.evaluate(()=>window.juanye.bookLoad());let saved=await load();
 const types=n=>[n.type,...(n.content||[]).flatMap(types)];assert.ok(types(saved.chapters[0].content).includes('answerArea'));assert.ok(types(saved.chapters[0].content).includes('columnBreak'));
 await page.getByLabel('分栏区栏数',{exact:true}).getByRole('radio',{name:'3 栏'}).click();await page.getByLabel('分栏区栏距（毫米）').fill('8');await page.keyboard.press('Control+s');await pause(1200);saved=await load();
 const col=saved.chapters[0].content.content.find(n=>n.type==='columnSet');assert.equal(col.attrs.count,3);assert.equal(col.attrs.gap,8);
 assert.equal(saved.chapters[0].content.content.find(n=>n.type==='callout').attrs.styleId,'example');assert.equal(saved.chapters[0].content.content.find(n=>n.type==='answerArea').attrs.kind,'coordinate');
 await page.reload();await page.getByRole('navigation',{name:'工作区'}).getByRole('button',{name:'教辅编辑台',exact:true}).click();await prose.waitFor();await pause(500);
 assert.deepEqual(await load(),saved);assert.deepEqual(errors,[]);
 if(process.argv.includes('--pdf')){
   const target=path.join(out,'p0-native-ipc.pdf');
   await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},target);
   const result=await page.evaluate(book=>window.juanye.bookExportPdf(book),saved);
   assert.equal(result.canceled,false);assert.ok(result.pages>0);assert.ok(fs.statSync(target).size>1000);
 }
 await page.screenshot({path:path.join(out,'p0-editor.png')});report={passed:true,packaged,checks:['v2 columns, style references and writing areas survive actual editor typing/save/reopen','Existing column UI changes persist through native IPC','No editor normalization drops new node fields'],errors};console.log(JSON.stringify(report));
 }catch(e){report={passed:false,error:e.stack};console.error(JSON.stringify(report));process.exitCode=1;}finally{await app?.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));assert.equal(path.dirname(profile),os.tmpdir());fs.rmSync(profile,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
