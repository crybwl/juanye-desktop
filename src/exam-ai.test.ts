import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {Exam} from './types';
import {DEFAULT_EXAM_AI_CONFIG, contentHash, examContextHash, examSnapshotFingerprint, invertMetadataPatches, isExamReportStale, knowledgeDifficultyMatrix, planExamAnalysis, previewMetadataPatches, reportMetadataProposals, type ExamAiReport} from './exam-ai';

const exam:Exam={title:'测试卷',subtitle:'',duration:100,notice:[],sections:[{id:'s',type:'single',title:'选择',note:'',questions:[{id:'q1',type:'single',score:6,stem:'$2+3$',options:['4','5'],answer:['B'],analysis:'',knowledge:['加法','运算','加法'],difficulty:'easy'},{id:'q2',type:'blank',score:4,stem:'$1+1=$',options:[],answer:[],analysis:''}]}]};
const config={...DEFAULT_EXAM_AI_CONFIG};
function report():ExamAiReport{return {version:1,id:'r',examKey:'test',createdAt:new Date().toISOString(),promptVersion:'exam-review-v1',fingerprint:examSnapshotFingerprint(exam),contextHash:examContextHash(config),config,snapshot:planExamAnalysis(exam).snapshot,model:{name:'fake',endpoint:'https://example.test'},requestCount:1,cacheHits:0,checkedImageQuestionIds:[],summary:'',recommendations:[],findings:[],questionReviews:exam.sections[0].questions.map(question=>({questionId:question.id,knowledge:['加法'],estimatedDifficulty:'medium',rationale:'定性估计',answerCheck:'not_checked',visualCheck:'not_checked'}))};}
test('browser hash is deterministic with UTF-8 and equals server-standard SHA256',()=>{assert.equal(contentHash('卷页🙂'),createHash('sha256').update('卷页🙂').digest('hex'));assert.equal(examSnapshotFingerprint(structuredClone(exam)),examSnapshotFingerprint(exam));});
test('report staleness reacts to content, answers, points, order and context but not paper layout',()=>{
  const current=report();assert.equal(isExamReportStale(current,exam,config),false);
  assert.equal(isExamReportStale(current,exam,{...config,scope:'函数'}),true);
  const layout=structuredClone(exam);layout.sections[0].pageBreakBefore=true;layout.sections[0].questions[0].answerSpace='full';assert.equal(isExamReportStale(current,layout,config),false);
  for(const field of ['stem','answer','score','knowledge','difficulty'] as const){const changed=structuredClone(exam),question=changed.sections[0].questions[0];if(field==='stem')question.stem='变化';if(field==='answer')question.answer=['A'];if(field==='score')question.score=10;if(field==='knowledge')question.knowledge=['乘法'];if(field==='difficulty')question.difficulty='hard';assert.equal(isExamReportStale(current,changed,config),true);}
  const reordered=structuredClone(exam);reordered.sections[0].questions.reverse();assert.equal(isExamReportStale(current,reordered,config),true);
});
test('metadata proposals are explicit, selectable, preserve text and have an exact unset-aware undo',()=>{
  const patches=reportMetadataProposals(report(),exam);assert.equal(patches.length,2);assert.deepEqual(patches[0],{id:'q1',knowledge:['加法'],difficulty:'medium'});
  const inverse=invertMetadataPatches(exam,patches),next=previewMetadataPatches(exam,patches);
  assert.equal(exam.sections[0].questions[0].difficulty,'easy');assert.equal(next.sections[0].questions[0].analysis,'');assert.equal(next.sections[0].questions[0].stem,exam.sections[0].questions[0].stem);
  assert.ok('difficulty' in inverse[1]);assert.equal(inverse[1].difficulty,undefined);
  assert.equal(examSnapshotFingerprint(previewMetadataPatches(next,inverse)),examSnapshotFingerprint(exam));
});
test('knowledge × difficulty matrix conserves score, deduplicates labels and keeps unset explicit',()=>{
  const matrix=knowledgeDifficultyMatrix(exam);assert.equal(matrix.rows.reduce((sum,row)=>sum+row.score,0),10);
  assert.equal(matrix.rows.find(row=>row.name==='加法')?.cells.easy.score,3);
  assert.deepEqual(matrix.rows.find(row=>row.name==='加法')?.cells.easy.numbers,[1]);
  assert.equal(matrix.rows.find(row=>row.name==='未设置')?.cells.unset.score,4);
});
test('oversized per-question payload and invalid output budgets fail locally',()=>{
  assert.throws(()=>planExamAnalysis(exam,{maxOutputTokens:131073}),/预算/);
  assert.equal(planExamAnalysis(exam,{maxOutputTokens:65536}).maxOutputTokens,65536);
  const huge=structuredClone(exam);huge.sections[0].questions[0].stem='x'.repeat(17000);assert.equal(planExamAnalysis(huge).chunks[0][0].stem.length,17000);
  huge.sections[0].questions[0].stem='x'.repeat(150000);assert.throws(()=>planExamAnalysis(huge),/单次输入上限/);
  assert.equal(planExamAnalysis(huge,{maxChunkChars:200000}).chunks[0][0].stem.length,150000);
});
