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
const config=(overrides={})=>({...DEFAULT_EXAM_AI_CONFIG,maxQuestionsPerChunk:20,wholePaperSummary:false,...overrides});
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
  for(const invalid of [{maxOutputTokens:131073},{maxOutputTokens:Infinity},{maxRequests:65},{maxRequests:0},{maxChunkChars:1000001},{maxQuestionsPerChunk:65},{imageBudget:9},{includeImages:'yes'},{wholePaperSummary:'yes'}])assert.throws(()=>planExamAnalysis(source,invalid));
  const duplicate=exam();duplicate.sections[0].questions[1].id='q1';assert.throws(()=>planExamAnalysis(duplicate),/重复/);
  const longStem=exam();longStem.sections[0].questions[0].stem='x'.repeat(150000);assert.equal(typeof examSnapshotFingerprint(longStem),'string');assert.throws(()=>planExamAnalysis(longStem),/单次输入上限/);
  assert.equal(planExamAnalysis(longStem,{maxChunkChars:200000}).chunks[0][0].stem.length,150000);
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
    const {body,data}=sentData(options);assert.equal(body.model,'saved-model');assert.equal(body.max_tokens,8192);assert.equal(body.response_format,undefined);assert.equal(typeof body.messages[0].content,'string');assert.ok(!options.body.includes('data:image'));
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

test('planned budget counts actual groups plus optional synthesis, not the request ceiling',()=>{
  const source=exam(19),plan=planExamAnalysis(source);
  assert.equal(plan.chunkCount,3);assert.equal(plan.summaryRequestCount,1);assert.equal(plan.plannedRequests,4);
  assert.equal(plan.maxTotalOutputTokens,4*8192);assert.equal(plan.maxRequests,12);assert.equal(plan.exceedsBudget,false);
  const deep=planExamAnalysis(source,{mode:'deep'});assert.equal(deep.chunkCount,5);assert.equal(deep.plannedRequests,6);
  assert.equal(planExamAnalysis(source,{maxRequests:3}).exceedsBudget,true);
  assert.equal(planExamAnalysis(source,{wholePaperSummary:false}).plannedRequests,3);
});

test('larger explicit output allowances reach the actual provider payload unchanged',async t=>{
  const budgets=[];
  const service=createExamAnalysisService({directory:await temporary(t),getConfig:async()=>savedModel,fetchImpl:async(_url,options)=>{const {body,data}=sentData(options);budgets.push(body.max_tokens);return mockResponse(reply(data.questions));}});
  for(const maxOutputTokens of [16384,65536,131072])await service.analyze(request(exam(),config({maxOutputTokens}),`output-${maxOutputTokens}`));
  assert.deepEqual(budgets,[16384,65536,131072]);
});

test('full-paper synthesis is one confirmed extra request and preserves every detailed review and finding',async t=>{
  const source=exam(19),configuration={...DEFAULT_EXAM_AI_CONFIG,maxRequests:4};let calls=0,synthesisCalls=0;
  const service=createExamAnalysisService({directory:await temporary(t),getConfig:async()=>savedModel,fetchImpl:async(_url,options)=>{
    calls++;const {data}=sentData(options);
    if(!data.questions){synthesisCalls++;assert.equal(data.groupReports.length,3);assert.equal(data.globalStructure.questionCount,19);return mockResponse({summary:'整卷综合：题型较单一，需要增加推理层次。',recommendations:['结合考试时间增补分层题。']});}
    const result=reply(data.questions);result.findings=[{kind:'coverage',severity:'info',questionIds:[data.questions[0].id],message:'本组存在重复知识点。',evidence:'组内均标注加法。',suggestion:'结合整卷覆盖复核。'}];return mockResponse(result);
  }});
  const result=await service.analyze(request(source,configuration));
  assert.equal(calls,4);assert.equal(synthesisCalls,1);assert.equal(result.requestCount,4);assert.equal(result.aggregateStatus,'complete');assert.match(result.summary,/整卷综合/);
  assert.equal(result.questionReviews.length,19);assert.equal(result.findings.length,3);assert.deepEqual(result.questionReviews.map(item=>item.questionId),source.sections[0].questions.map(item=>item.id));
  const repeated=await service.analyze(request(source,configuration,'cached'));
  assert.equal(calls,4);assert.equal(repeated.requestCount,0);assert.equal(repeated.cacheHits,4);assert.equal(repeated.aggregateStatus,'complete');
});

test('failed synthesis preserves complete per-question report and chunks; manual retry only calls synthesis',async t=>{
  let calls=0,failSummary=true;
  const source=exam(19),configuration={...DEFAULT_EXAM_AI_CONFIG,maxRequests:4};
  const service=createExamAnalysisService({directory:await temporary(t),getConfig:async()=>savedModel,fetchImpl:async(_url,options)=>{
    calls++;const {data}=sentData(options);
    if(data.questions)return mockResponse(reply(data.questions));
    if(failSummary)return {ok:false,status:500,text:async()=>JSON.stringify({error:{message:`bad summary ${savedModel.key}`}})};
    return mockResponse({summary:'手动重试的整卷综合。',recommendations:[]});
  }});
  const result=await service.analyze(request(source,configuration));
  assert.equal(calls,4);assert.equal(result.aggregateStatus,'unavailable');assert.equal(result.questionReviews.length,19);assert.match(result.aggregateError,/已隐藏/);assert.ok(!result.aggregateError.includes(savedModel.key));
  assert.equal((await service.list()).length,1);assert.equal((await service.list())[0].aggregateStatus,'unavailable');
  failSummary=false;
  const retried=await service.analyze(request(source,configuration,'manual-retry'));
  assert.equal(calls,5);assert.equal(retried.requestCount,1);assert.equal(retried.cacheHits,3);assert.equal(retried.aggregateStatus,'complete');
});

test('known v1 history validates its original configuration hash and normalizes in memory without rewriting disk',async t=>{
  const directory=await temporary(t),source=exam(),plan=planExamAnalysis(source);
  const legacyConfig={grade:'',scope:'',purpose:'组卷质量核查',mode:'quick',maxRequests:4,maxOutputTokens:4096,includeImages:false,imageBudget:2};
  const old={version:1,id:'legacy',examKey:'exam-a',createdAt:'2026-10-27T00:00:00Z',promptVersion:'exam-review-v1',fingerprint:plan.fingerprint,contextHash:contentHash(stableStringify(legacyConfig)),config:legacyConfig,snapshot:plan.snapshot,model:{name:'saved-model',endpoint:savedModel.baseUrl},requestCount:1,cacheHits:0,checkedImageQuestionIds:[],...reply(source.sections[0].questions)};
  const file=path.join(directory,'exam-ai-reports-v1.json'),bytes=JSON.stringify({version:1,reports:[old,{...old,id:'corrupt',contextHash:'f'.repeat(64)}],cache:[]});await fs.writeFile(file,bytes);
  const service=createExamAnalysisService({directory,getConfig:async()=>{throw Error('must not read credentials');},fetchImpl:async()=>{throw Error('must not call model');}});
  const reports=await service.list('exam-a');assert.equal(reports.length,1);assert.equal(reports[0].id,'legacy');assert.equal(reports[0].promptVersion,'exam-review-v1');assert.equal(reports[0].config.maxOutputTokens,4096);assert.equal(reports[0].config.maxQuestionsPerChunk,8);
  assert.equal(reports[0].contextHash,contentHash(stableStringify(reports[0].config)));assert.equal(await fs.readFile(file,'utf8'),bytes);
});

test('detailed responses beyond the old 200k JSON ceiling survive; model token-limit failures do not retry',async t=>{
  const source=exam(20);let calls=0;
  const service=createExamAnalysisService({directory:await temporary(t),getConfig:async()=>savedModel,fetchImpl:async(_url,options)=>{calls++;const result=reply(sentData(options).data.questions);result.questionReviews.forEach(item=>item.rationale='详'.repeat(11000));assert.ok(JSON.stringify(result).length>200000);return mockResponse(result);}});
  const result=await service.analyze(request(source,config({maxOutputTokens:131072})));assert.equal(result.questionReviews.length,20);assert.equal(result.questionReviews[19].rationale.length,11000);assert.equal(calls,1);
  const rejected=createExamAnalysisService({directory:await temporary(t),getConfig:async()=>savedModel,fetchImpl:async()=>{calls++;return {ok:false,status:400,text:async()=>JSON.stringify({error:{message:'Range of max_tokens should be [1, 8192]'}})};}});
  await assert.rejects(rejected.analyze(request(exam(),config({maxOutputTokens:65536}))),/降低每次输出tokens.*未自动重试/);
  assert.equal(calls,2);assert.deepEqual(await rejected.list(),[]);
});

test('character limit covers the actual prompt including images and never cuts a long question',()=>{
  const {reviewPrompt}=require('./exam-ai-shared.mjs');
  const source=exam(8);source.sections[0].questions[0].sourceImage='data:image/png;base64,AAAA';source.sections[0].questions[2].stem='复杂原文🙂'.repeat(3500);
  const plan=planExamAnalysis(source,{includeImages:true,imageBudget:2,maxChunkChars:30000});
  for(const chunk of plan.chunks){const ids=plan.images.filter(image=>chunk.some(question=>question.id===image.questionId)).map(image=>image.questionId);assert.ok(reviewPrompt(plan,chunk,ids).length<=30000);}
  assert.equal(plan.chunks.flat().find(question=>question.id==='q3').stem,source.sections[0].questions[2].stem);
});

test('raising only request/input insurance limits reuses identical prompts, but changed output allowance invalidates cache',async t=>{
  let calls=0;
  const source=exam(19),configuration={...DEFAULT_EXAM_AI_CONFIG,maxRequests:4};
  const service=createExamAnalysisService({directory:await temporary(t),getConfig:async()=>savedModel,fetchImpl:async(_url,options)=>{calls++;const {data}=sentData(options);return mockResponse(data.questions?reply(data.questions):{summary:'完整综合。',recommendations:[]});}});
  await service.analyze(request(source,configuration));assert.equal(calls,4);
  const reused=await service.analyze(request(source,{...configuration,maxRequests:64,maxChunkChars:200000},'larger-insurance'));
  assert.equal(calls,4);assert.equal(reused.cacheHits,4);assert.equal(reused.requestCount,0);
  await service.analyze(request(source,{...configuration,maxOutputTokens:16384},'more-output'));
  assert.equal(calls,8);
});
