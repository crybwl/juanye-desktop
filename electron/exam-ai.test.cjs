const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {createExamAnalysisService,validateChunk,parseModelJson}=require('./exam-ai.cjs');
const {contentHash,stableStringify,examSnapshotFingerprint,planExamAnalysis,DEFAULT_EXAM_AI_CONFIG}=require('./exam-ai-shared.mjs');
const savedModel={baseUrl:'https://example.test/v1',model:'saved-model',key:'fake-test-key'};
const exam=(count=2)=>({id:'exam-a',title:'测试卷',subtitle:'数学',duration:120,notice:['认真作答'],sections:[{id:'s1',title:'选择题',type:'single',note:'',questions:Array.from({length:count},(_,i)=>({id:`q${i+1}`,type:'single',stem:`求 $${i}+1$`,score:5,options:['1','2'],answer:['B'],analysis:'',knowledge:['加法'],difficulty:'easy'}))}]});
const config=(overrides={})=>({...DEFAULT_EXAM_AI_CONFIG,...overrides});
function reply(questions){return {summary:'本卷标注以基础题为主。',recommendations:['复核答案。'],findings:[],questionReviews:questions.map(question=>({questionId:question.id,knowledge:['加法'],estimatedDifficulty:'easy',rationale:'一次加法；定性估计。',answerCheck:'consistent',visualCheck:'checked'}))};}
function mockResponse(value,status=200,finish='stop'){return {ok:status===200,status,text:async()=>JSON.stringify({choices:[{finish_reason:finish,message:{content:typeof value==='string'?value:JSON.stringify(value)}}]})};}
function request(examValue,configuration=config(),taskId='task-a'){return {taskId,exam:examValue,config:configuration,expectedFingerprint:examSnapshotFingerprint(examValue)};}
function sentData(options){const body=JSON.parse(options.body),content=body.messages[0].content;const text=typeof content==='string'?content:content[0].text;return {body,data:JSON.parse(text.match(/\n<data>([\s\S]*)<\/data>$/)[1])};}
async function temporary(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'juanye-exam-ai-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;}

test('portable fingerprint matches SHA-256 and excludes only layout changes',()=>{
  for(const value of ['', 'abc', '你好🙂', 'x'.repeat(10000)])assert.equal(contentHash(value),createHash('sha256').update(value).digest('hex'));
  const original=exam(),fingerprint=examSnapshotFingerprint(original),layout=structuredClone(original);
  layout.sections[0].questions[0].answerSpace='full';layout.sections[0].questions[0].pageBreakBefore=true;layout.sections[0].questions[0].figures=[];
  assert.equal(examSnapshotFingerprint(layout),fingerprint);
  for(const modify of [q=>q.answer=['A'],q=>q.stem+='?',q=>q.score=6,q=>q.analysis='有新解析',q=>q.knowledge=['减法'],q=>q.difficulty='hard',q=>q.sourceImage='data:image/png;base64,AAAA']){const changed=structuredClone(original);modify(changed.sections[0].questions[0]);assert.notEqual(examSnapshotFingerprint(changed),fingerprint);}
  const reordered=structuredClone(original);reordered.sections[0].questions.reverse();assert.notEqual(examSnapshotFingerprint(reordered),fingerprint);
});
test('planning validates explicit finite budgets and defaults to no images',()=>{
  const source=exam();source.sections[0].questions[0].sourceImage='data:image/png;base64,AAAA';
  const plan=planExamAnalysis(source);assert.equal(plan.images.length,0);assert.equal(plan.questionCount,2);assert.equal(plan.chunkCount,1);assert.ok(!stableStringify(plan.snapshot).includes('base64'));
  assert.equal(planExamAnalysis(source,config({includeImages:true,imageBudget:1})).images.length,1);
  for(const invalid of [{maxOutputTokens:8193},{maxOutputTokens:Infinity},{maxRequests:17},{maxRequests:0},{imageBudget:9},{includeImages:'yes'}])assert.throws(()=>planExamAnalysis(source,invalid));
  const duplicate=exam();duplicate.sections[0].questions[1].id='q1';assert.throws(()=>planExamAnalysis(duplicate),/重复/);
  const longStem=exam();longStem.sections[0].questions[0].stem='x'.repeat(150000);assert.equal(typeof examSnapshotFingerprint(longStem),'string');assert.throws(()=>planExamAnalysis(longStem),/单次分析上限/);
});
test('structured validation rejects missing, invented and duplicate references; image review cannot be fabricated',()=>{
  const questions=exam().sections[0].questions,value=reply(questions);
  assert.equal(validateChunk(value,questions).questionReviews[0].visualCheck,'not_checked');
  const unanswered=structuredClone(questions);unanswered[0].answer=[];assert.equal(validateChunk(value,unanswered).questionReviews[0].answerCheck,'not_checked');
  const missing=structuredClone(value);missing.questionReviews.pop();assert.throws(()=>validateChunk(missing,questions),/不完整/);
  const invented=structuredClone(value);invented.questionReviews[0].questionId='imagined';assert.throws(()=>validateChunk(invented,questions),/无效/);
  const duplicate=structuredClone(value);duplicate.questionReviews[1].questionId='q1';assert.throws(()=>validateChunk(duplicate,questions),/重复/);
  const finding=structuredClone(value);finding.findings=[{kind:'answer',severity:'warning',questionIds:['invented'],message:'x',evidence:'x',suggestion:'x'}];assert.throws(()=>validateChunk(finding,questions),/不存在/);
  assert.throws(()=>parseModelJson('{"summary":'),/完整 JSON/);
  assert.deepEqual(parseModelJson('```json\n{"ok":true}\n```'),{ok:true});
});
test('saved credentials, global exact statistics, bounded sequential requests, default privacy and atomic persistence',async t=>{
  const directory=await temporary(t),source=exam(41);source.sections[0].questions[0].sourceImage='data:image/png;base64,AAAA';let calls=0,active=0;
  const service=createExamAnalysisService({directory,getConfig:async()=>savedModel,fetchImpl:async(url,options)=>{
    calls++;assert.equal(active++,0);assert.equal(options.headers.Authorization,'Bearer fake-test-key');assert.ok(options.signal);assert.equal(url,'https://example.test/v1/chat/completions');
    const {body,data}=sentData(options);assert.equal(body.model,'saved-model');assert.equal(body.max_tokens,4096);assert.equal(body.response_format,undefined);assert.equal(typeof body.messages[0].content,'string');assert.ok(!options.body.includes('data:image'));
    assert.equal(data.globalStructure.questionCount,41);assert.equal(data.globalStructure.totalScore,205);active--;
    return mockResponse(reply(data.questions));
  }});
  const result=await service.analyze(request(source));assert.equal(calls,3);assert.equal(result.requestCount,3);assert.equal(result.questionReviews.length,41);assert.equal(result.questionReviews[0].visualCheck,'not_checked');assert.equal(result.model.name,'saved-model');
  assert.equal((await service.list('exam-a')).length,1);assert.equal((await fs.readdir(directory)).filter(name=>name.endsWith('.tmp')).length,0);
  const persisted=await fs.readFile(path.join(directory,'exam-ai-reports-v1.json'),'utf8');assert.ok(!persisted.includes(savedModel.key));assert.ok(!persisted.includes('data:image'));
  const restored=createExamAnalysisService({directory,getConfig:async()=>savedModel,fetchImpl:async()=>{throw new Error('must reuse cached chunks');}});
  const reused=await restored.analyze(request(source));assert.equal(reused.requestCount,0);assert.equal(reused.cacheHits,3);assert.equal((await restored.list()).length,2);
});
test('content-addressed chunk cache invalidates only changed text chunks and model/context changes invalidate cache',async t=>{
  const directory=await temporary(t);let calls=0,currentModel=savedModel;
  const service=createExamAnalysisService({directory,getConfig:async()=>currentModel,fetchImpl:async(_url,options)=>{calls++;return mockResponse(reply(sentData(options).data.questions));}});
  const original=exam(21);await service.analyze(request(original));assert.equal(calls,2);
  const changed=structuredClone(original);changed.sections[0].questions[0].stem+='（改）';await service.analyze(request(changed));assert.equal(calls,3);
  await service.analyze(request(changed,config({grade:'高一'})));assert.equal(calls,5);
  currentModel={...savedModel,model:'another'};await service.analyze(request(changed));assert.equal(calls,7);
});
test('budget and snapshot failures reject before reading config or touching network',async t=>{
  const directory=await temporary(t);let touched=0;const service=createExamAnalysisService({directory,getConfig:async()=>{touched++;return savedModel;},fetchImpl:async()=>{touched++;throw Error('not allowed');}});
  await assert.rejects(service.analyze(request(exam(21),config({maxRequests:1}))),/预算/);
  const input=request(exam());input.expectedFingerprint='old';await assert.rejects(service.analyze(input),/快照/);
  assert.equal(touched,0);
});
test('truncated JSON and finish_reason length never trigger paid retries or save reports',async t=>{
  for(const response of [mockResponse('{"summary":'),mockResponse({},200,'length')]){
    const directory=await temporary(t);let calls=0;
    const service=createExamAnalysisService({directory,getConfig:async()=>savedModel,fetchImpl:async()=>{calls++;return response;}});
    await assert.rejects(service.analyze(request(exam())),/JSON|截断/);assert.equal(calls,1);assert.deepEqual(await service.list(),[]);
  }
});
test('cancel is task-scoped, does not cancel another analysis, and disposal aborts all owned jobs',async t=>{
  const directory=await temporary(t),waiters=[];let started;
  const start=new Promise(resolve=>{started=resolve;});
  const service=createExamAnalysisService({directory,getConfig:async()=>savedModel,fetchImpl:async(_url,options)=>new Promise((resolve,reject)=>{waiters.push({resolve,reject,options});options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});if(waiters.length===2)started();})});
  const first=service.analyze(request(exam(),config(),'first')),second=service.analyze(request(exam(),config(),'second'));
  const firstRejected=assert.rejects(first,/取消/);await start;service.cancel('first');await firstRejected;
  assert.equal(waiters[1].options.signal.aborted,false);waiters[1].resolve(mockResponse(reply(sentData(waiters[1].options).data.questions)));await second;
  const third=service.analyze(request(exam(),config({purpose:'新的任务'}),'third'));const thirdRejected=assert.rejects(third,/取消/);
  while(waiters.length<3)await new Promise(resolve=>setImmediate(resolve));service.dispose();await thirdRejected;
  assert.equal((await service.list()).length,1);
});
test('server error payload and transport errors redact saved API key',async t=>{
  for(const fetchImpl of [async()=>({ok:false,status:401,text:async()=>JSON.stringify({error:{message:`bad ${savedModel.key}`}})}),async()=>{throw Error(`network ${savedModel.key}`);}]){
    const service=createExamAnalysisService({directory:await temporary(t),getConfig:async()=>savedModel,fetchImpl});
    await assert.rejects(service.analyze(request(exam())),error=>!error.message.includes(savedModel.key)&&error.message.includes('[已隐藏]'));
  }
});
test('invalid persisted JSON is ignored without executing or calling model',async t=>{
  const directory=await temporary(t);await fs.writeFile(path.join(directory,'exam-ai-reports-v1.json'),'not json');
  const service=createExamAnalysisService({directory,getConfig:async()=>{throw Error('not used');},fetchImpl:async()=>{throw Error('not used');}});
  assert.deepEqual(await service.list(),[]);
});
