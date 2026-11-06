import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema, type CommandProps, type RawCommands } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState } from '@tiptap/pm/state';
import { BookAnswerArea } from './components/BookBlockNodes';
import { DEFAULT_BOOK_ANSWER_AREA, validBookAnswerAreaAttrs } from './book-blocks';
import { renderBookAnswerArea } from './book-block-render';

const commands = (BookAnswerArea.config.addCommands as unknown as () => Partial<RawCommands>)();
const schema = getSchema([StarterKit, BookAnswerArea]);
const state = () => EditorState.create({schema,doc:schema.nodeFromJSON({type:'doc',content:[
  {type:'answerArea',attrs:{...DEFAULT_BOOK_ANSWER_AREA,unit:'mm',size:50}},
  {type:'answerArea',attrs:{...DEFAULT_BOOK_ANSWER_AREA,size:20}},
]})});

test('writing-area geometry guard rejects nonfinite and invalid typed values',()=>{
  for(const patch of [{size:NaN},{size:Infinity},{size:'20'},{unit:'px'},{kind:null},{gridSize:1},{size:40,lineHeight:15}])
    assert.equal(validBookAnswerAreaAttrs({...DEFAULT_BOOK_ANSWER_AREA,...patch}),false);
  assert.equal(validBookAnswerAreaAttrs({...DEFAULT_BOOK_ANSWER_AREA,unit:'mm',size:300}),true);
});
test('invalid insertion returns false before creating a transaction',()=>{
  let inserts=0;
  const props={commands:{insertContent:()=>{inserts++;return true;}}} as unknown as CommandProps;
  assert.equal(commands.insertBookAnswerArea!({size:NaN})(props),false);
  assert.equal(commands.insertBookAnswerArea!({unit:'mm',size:55})(props),true);
  assert.equal(inserts,1);
});
test('batch command validates every targeted area before any step is written',()=>{
  const current=state(),tr=current.tr;
  // This is valid for the mm area but would enlarge the second lines area to 400 mm.
  assert.equal(commands.setBookAnswerAreas!({lineHeight:15,size:30},'chapter')({state:current,tr,dispatch:()=>{}} as unknown as CommandProps),false);
  assert.equal(tr.steps.length,0);assert.deepEqual(tr.doc.toJSON(),current.doc.toJSON());
  assert.equal(commands.setBookAnswerAreas!({kind:'grid'},'chapter')({state:current,tr,dispatch:()=>{}} as unknown as CommandProps),true);
  assert.equal(tr.steps.length,2);assert.equal(tr.doc.firstChild!.attrs.size,50);assert.equal(tr.doc.lastChild!.attrs.size,20);
});
test('invalid transient rendering falls back to safe finite physical geometry',()=>{
  const html=renderBookAnswerArea({kind:'grid',unit:'mm',size:'10mm;background:red'});
  assert.match(html,/height:35mm/);assert.doesNotMatch(html,/NaN|background:red/);
});
