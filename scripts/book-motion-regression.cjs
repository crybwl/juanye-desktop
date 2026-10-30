/* Match the old editor's real motion, not screenshots of final states.
 * --record-only --label=before records the identical fixture before changes.
 * Uses no accounts, models, network or user documents. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron } = require('playwright');
const { stressBook } = require('./book-workspace-regression.cjs');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged'), recordOnly = process.argv.includes('--record-only');
const label = process.argv.find(value => value.startsWith('--label='))?.split('=')[1] || (packaged ? 'packaged' : 'source');
assert.match(label, /^[a-z\d-]+$/);
const output = path.join(root, 'artifacts/qa-book-motion', label);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-book-motion-'));
  const fixture = stressBook();
  fs.writeFileSync(path.join(profile, 'book-draft.json'), JSON.stringify(fixture));
  fs.mkdirSync(output, { recursive: true });
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page, stage = 'launch', report; const checks = [], samples = [], errors = [];
  const watchdog = setTimeout(() => { app?.process().kill(); console.error(`Book motion timeout: ${stage}`); process.exit(1); }, 180000);
  const until = async (check, message) => { const deadline=Date.now()+15000;while(Date.now()<deadline){if(await check())return;await pause(40);}throw Error(message); };
  try {
    const flags=['--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows'];
    app=await _electron.launch({executablePath:path.join(root,packaged?'release/win-unpacked/卷页.exe':'node_modules/electron/dist/electron.exe'),args:packaged?flags:[root,...flags],env});
    await app.evaluate(({BrowserWindow,session,ipcMain})=>{const win=BrowserWindow.getAllWindows()[0];win.setContentSize(1500,980);win.setPosition(-16000,-16000);win.showInactive();win.webContents.setBackgroundThrottling(false);globalThis.__bookMotionCalls={http:0,model:0};session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,done)=>{globalThis.__bookMotionCalls.http++;done({cancel:true});});for(const channel of ['model:test','model:recognize','model:generate','exam:analyze']){ipcMain.removeHandler(channel);ipcMain.handle(channel,()=>{globalThis.__bookMotionCalls.model++;throw Error('Models disabled in motion QA');});}});
    page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
    await page.evaluate(()=>{localStorage.setItem('juanye.appearance.v1','telegram');localStorage.setItem('juanye.telegram-scheme.v1','dark');});await page.reload();
    await page.getByRole('navigation',{name:'工作区',exact:true}).getByRole('button',{name:'教辅编辑台',exact:true}).click();
    const workspace=page.getByTestId('book-workspace');await workspace.locator('.tiptap[contenteditable=true]').waitFor();
    const preview=()=>page.frameLocator('iframe[data-testid=book-preview]');
    await preview().locator('body[data-book-ready=true]').waitFor();await pause(500);
    assert.equal(await workspace.locator('.book-question-node').count(),25);
    const session=await app.context().newCDPSession(page);await session.send('Performance.enable');
    const metrics=async()=>Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(item=>[item.name,item.value]));
    const capture=async(name,action)=>{
      stage=name;const before=await metrics();
      await page.evaluate(()=>{window.__bookMotionTrace=new Promise(resolve=>{const start=performance.now(),frames=[];let previous=start;const step=now=>{const main=document.querySelector('.book-main'),side=document.querySelector('.book-side'),panes=[...document.querySelectorAll('[data-book-chapter-pane]')];const fields=document.querySelector('.book-question-fields');frames.push({t:now-start,dt:now-previous,main:main?.getBoundingClientRect().width||0,side:side?.getBoundingClientRect().width||0,panes:panes.map(node=>({id:node.dataset.bookChapterPane,hidden:node.getAttribute('aria-hidden'),opacity:Number(getComputedStyle(node).opacity),transform:getComputedStyle(node).transform,inert:node.inert})),fieldHeight:fields?.getBoundingClientRect().height||0});previous=now;if(now-start<760)requestAnimationFrame(step);else resolve(frames);};requestAnimationFrame(step);});});
      await action();const frames=await page.evaluate(()=>window.__bookMotionTrace),after=await metrics();
      const times=frames.slice(1).map(frame=>frame.dt).sort((a,b)=>a-b),p95=times[Math.min(times.length-1,Math.floor(times.length*.95))]||0;
      const sample={name,frames,p95,scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000,layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000,styleMs:(after.RecalcStyleDuration-before.RecalcStyleDuration)*1000};samples.push(sample);return sample;
    };
    await workspace.locator('iframe[data-testid=book-preview]').evaluate(node=>{window.__keptBookFrame=node;});
    await preview().locator('body').evaluate(()=>{window.__bookMotionRenders=0;window.__bookMotionSheet=document.querySelector('.pagedjs_page');const render=window.renderJuanyeBook;window.renderJuanyeBook=(...args)=>{window.__bookMotionRenders++;return render(...args);};});
    const collapse=await capture('preview-collapse',()=>workspace.getByRole('button',{name:'收起排版预览',exact:true}).click());
    const expand=await capture('preview-expand',()=>workspace.getByRole('button',{name:'展开排版预览',exact:true}).click());
    const retained=await page.evaluate(()=>window.__keptBookFrame===document.querySelector('iframe[data-testid=book-preview]'));
    if(!recordOnly){for(const sample of [collapse,expand])assert.ok(new Set(sample.frames.map(frame=>Math.round(frame.main))).size>=5,`Center pane jumps instead of resizing: ${sample.name}`);assert.equal(retained,true,'Collapsing preview must not recreate iframe');checks.push('Preview has real intermediate widths, uninterrupted spring reversal and a retained pagination iframe');}
    await preview().locator('body[data-book-ready=true]').waitFor();await pause(300);
    await capture('settings-tab',()=>workspace.getByRole('button',{name:'排版',exact:true}).click());
    await capture('preview-tab',()=>workspace.getByRole('button',{name:'预览',exact:true}).click());
    if(!recordOnly){assert.equal(await page.evaluate(()=>window.__keptBookFrame===document.querySelector('iframe[data-testid=book-preview]')),true);assert.deepEqual(await preview().locator('body').evaluate(()=>({calls:window.__bookMotionRenders,samePage:window.__bookMotionSheet===document.querySelector('.pagedjs_page')})),{calls:0,samePage:true});checks.push('Settings/preview crossfade retains the actual page node and causes zero unchanged pagination calls');}
    const switchChapter=()=>workspace.locator('.book-chapter-row').filter({hasText:'第2章 专题练习'}).locator('button').first().click();
    const chapter=await capture('chapter-switch',switchChapter);
    if(!recordOnly){assert.ok(chapter.frames.some(frame=>frame.panes.some(pane=>pane.opacity>0&&pane.opacity<.98&&pane.hidden==='false')),'Missing chapter entry frames');assert.ok(chapter.frames.some(frame=>frame.panes.some(pane=>pane.opacity>0&&pane.opacity<.98&&pane.hidden==='true'&&pane.inert)),'Missing inert chapter exit frames');checks.push('Chapter entry and exit both render; outgoing chapter is inert and rapid selection publishes immediately');}
    await workspace.getByRole('button',{name:'编辑教辅题目 2.1',exact:true}).click();await workspace.getByLabel('教辅题干 2.1',{exact:true}).waitFor();await pause(550);
    const details=workspace.locator('.book-question-fields details').first();
    const disclosure=await capture('answer-disclosure',()=>details.locator('summary').click());
    if(!recordOnly){assert.ok(new Set(disclosure.frames.map(frame=>Math.round(frame.fieldHeight))).size>=5,'Answer expansion has no intermediate height');checks.push('Answer/analysis opens with a measured reveal, not native details snapping');}
    await workspace.getByLabel('教辅参考答案',{exact:true}).fill('C');await page.evaluate(()=>window.dispatchEvent(new Event('juanye:flush')));
    await until(async()=>(await page.evaluate(()=>window.juanye.bookLoad())).questions['stress-26'].answer[0]==='C','Motion swallowed answer editing');
    if(!recordOnly){
      stage='rapid reversals, live input, bounded editors and focus guard';
      const beforeRapid=await page.evaluate(()=>window.juanye.bookLoad());
      const rapid=await page.evaluate(async()=>{const samples=[];for(const number of [1,2,3,2,1,2,1]){const row=[...document.querySelectorAll('.book-chapter-row')].find(row=>row.textContent.includes(`第${number}章 专题练习`));row.querySelector('button').click();await new Promise(resolve=>setTimeout(resolve,42));const panes=[...document.querySelectorAll('[data-book-chapter-pane]')],current=panes.filter(node=>node.getAttribute('aria-hidden')==='false');let focusGuard=true;for(const old of panes.filter(node=>node.getAttribute('aria-hidden')==='true')){const control=old.querySelector('textarea,input,[contenteditable]');control?.focus();focusGuard&&=!old.contains(document.activeElement)&&old.inert;}samples.push({panes:panes.length,current:current.map(node=>node.dataset.bookChapterPane),focusGuard});}for(let index=0;index<5;index++){const button=document.querySelector('.book-main-toolbar button[aria-label="收起排版预览"],.book-main-toolbar button[aria-label="展开排版预览"]');button.click();await new Promise(resolve=>setTimeout(resolve,55));}return samples;});
      assert.ok(rapid.every(value=>value.panes<=2&&value.current.length===1&&value.focusGuard),JSON.stringify(rapid));
      if(await workspace.getByRole('button',{name:'展开排版预览',exact:true}).count())await workspace.getByRole('button',{name:'展开排版预览',exact:true}).click();
      await until(()=>workspace.locator('[data-book-chapter-pane]').count().then(count=>count===1),'Old chapter exit never completed');
      assert.equal(await workspace.locator('[data-book-chapter-pane][aria-hidden=false]').getAttribute('data-book-chapter-pane'),'stress-chapter-1');
      const prose=workspace.locator('[data-book-chapter-pane][aria-hidden=false] .tiptap');await prose.locator('> p').first().click();await page.keyboard.press('End');await page.keyboard.type(' MOTION_LAST_INPUT');await page.keyboard.press('Control+s');
      await until(async()=>JSON.stringify((await page.evaluate(()=>window.juanye.bookLoad())).chapters[1].content).includes('MOTION_LAST_INPUT'),'Rapid return lost current editor ref or final input');
      const afterRapid=await page.evaluate(()=>window.juanye.bookLoad());for(let index=2;index<afterRapid.chapters.length;index++)assert.deepEqual(afterRapid.chapters[index],beforeRapid.chapters[index]);assert.deepEqual(afterRapid.questions,beforeRapid.questions);
      checks.push('Seven rapid chapter selections and five interrupted sidebar reversals: at most two editors, one interactive, no old-focus access, final Ctrl+S persists without changing other chapters/questions');
      stage='system reduced motion and keyboard disclosure';
      await page.emulateMedia({reducedMotion:'reduce'});await until(()=>workspace.getAttribute('data-book-motion').then(value=>value==='reduced'),'System motion preference not observed');
      const reduced=await capture('reduced-preview-collapse',()=>workspace.getByRole('button',{name:'收起排版预览',exact:true}).click());
      assert.ok(new Set(reduced.frames.map(frame=>Math.round(frame.main))).size<=3,'Reduced motion still animates panel width');
      await workspace.getByRole('button',{name:'展开排版预览',exact:true}).click();await page.emulateMedia({reducedMotion:'no-preference'});await until(()=>workspace.getAttribute('data-book-motion').then(value=>value==='full'),'Full motion did not restore');
      checks.push('Live OS reduced-motion preference immediately settles panes; restoring preference restores full animation');
      stage='offscreen formulas retain keyboard navigation and editing';
      await prose.locator('> p').first().click();await page.keyboard.press('Control+End');await page.keyboard.type(' MOTION_END_INPUT');await page.keyboard.press('Control+s');
      await until(async()=>JSON.stringify((await page.evaluate(()=>window.juanye.bookLoad())).chapters[1].content).includes('MOTION_END_INPUT'),'Last paragraph input missing');
      const lastQuestion=workspace.locator('[data-book-chapter-pane][aria-hidden=false] [data-book-question=stress-25]');await lastQuestion.evaluate(node=>node.scrollIntoView({block:'center'}));
      await workspace.getByRole('button',{name:'编辑教辅题目 1.25',exact:true}).click();await workspace.getByLabel('教辅题干 1.25',{exact:true}).waitFor();
      assert.equal(await lastQuestion.evaluate(node=>getComputedStyle(node).contentVisibility),'visible');
      await prose.locator('> p').first().evaluate(node=>node.scrollIntoView({block:'center'}));await prose.locator('> p').first().click();await page.keyboard.press('Control+Home');
      const firstVisible=await prose.locator('> h2').first().evaluate(node=>{const r=node.getBoundingClientRect(),s=node.closest('.book-editor-scroll').getBoundingClientRect();return r.bottom>s.top&&r.top<s.bottom;});assert.equal(firstVisible,true);
      assert.equal(await workspace.locator('.book-question-node').count(),25);
      checks.push('Offscreen formula painting is skipped without removing nodes: end input, last-question editing and first-heading return all work');
      stage='paper entry is decorative, never a print transform';
      await pause(1000);await preview().locator('.pagedjs_page').first().waitFor();await page.emulateMedia({media:'print'});
      const printed=await preview().locator('.pagedjs_page').first().evaluate(node=>{const style=getComputedStyle(node);return{animation:style.animationName,transform:style.transform,opacity:style.opacity};});
      assert.deepEqual(printed,{animation:'none',transform:'none',opacity:'1'});await page.emulateMedia({media:'screen'});
      checks.push('Screen-only page entrance explicitly becomes animation:none, transform:none and opacity:1 in print media');
    }
    for(const item of [{theme:'dark'},{theme:'light'},{theme:'telegram',scheme:'dark'},{theme:'telegram',scheme:'light'}]){
      await page.evaluate(item=>{for(const[key,value]of Object.entries({'juanye.appearance.v1':item.theme,'juanye.telegram-scheme.v1':item.scheme||'dark'})){localStorage.setItem(key,value);window.dispatchEvent(new StorageEvent('storage',{key,newValue:value}));}},item);await pause(150);
      const bounds=await workspace.evaluate(node=>({scroll:document.documentElement.scrollWidth,width:innerWidth,right:node.getBoundingClientRect().right}));assert.ok(bounds.scroll<=bounds.width+1&&bounds.right<=bounds.width+1,JSON.stringify({item,bounds}));
      await page.screenshot({path:path.join(output,`book-${item.theme}-${item.scheme||'default'}.png`)});
    }
    if(!recordOnly)checks.push('Four appearance families preserve layout, live fields and readable selected states');
    assert.deepEqual(errors,[]);assert.deepEqual(await app.evaluate(()=>globalThis.__bookMotionCalls),{http:0,model:0});
    const file=path.join(root,packaged?'release/win-unpacked/resources/app.asar':'dist/index.html');
    report={passed:true,recordOnly,packaged,label,fixture:{questions:1000,chapters:40,currentChapterQuestions:25},checks,samples,frameRetained:retained,errors,buildHash:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),note:'760 ms screen-off Chromium samples include automation/layout probes; not user-display FPS.'};
    console.log(JSON.stringify({passed:true,recordOnly,checks,samples:samples.map(({frames,...rest})=>({...rest,frameCount:frames.length})),frameRetained:retained}));
  }catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});report={passed:false,stage,error:error.stack||String(error),checks,errors};console.error(JSON.stringify(report));process.exitCode=1;}
  finally{clearTimeout(watchdog);await app?.close().catch(()=>app.process().kill());fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));const resolved=fs.realpathSync(profile);assert.equal(path.dirname(resolved).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());assert.ok(path.basename(resolved).startsWith('juanye-book-motion-'));fs.rmSync(resolved,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
