import test from 'node:test';
import assert from 'node:assert/strict';
import { BookQuestionStore } from './book-editor-store';
import type { Question } from './types';

const question = (id: string): Question => ({ id, type: 'single', score: 5, stem: '$1+1$', options: ['1', '2'], answer: ['B'], analysis: '' });
test('chapter stores seed only visible question IDs and notify only changed snapshots', () => {
  const store = new BookQuestionStore(), one = question('one'), two = question('two'), other = question('elsewhere');
  const data = { one, two, elsewhere: other }, numbers = { one: '1.1', two: '1.2', elsewhere: '9.1' };
  store.prepare(data, numbers, ['one', 'two']);
  assert.equal(store.get('elsewhere'), undefined);
  let first = 0, second = 0;
  store.subscribe('one', () => first++); store.subscribe('two', () => second++);
  const previous = store.get('two');
  store.update({ ...data, one: { ...one, stem: 'edited' } }, numbers, ['one', 'two']);
  assert.equal(first, 1); assert.equal(second, 0); assert.equal(store.get('two'), previous);
});
test('question numbers update without resetting content and removed unsubscribed snapshots release', () => {
  const store = new BookQuestionStore(), data = { one: question('one'), two: question('two') };
  store.prepare(data, { one: '1.1', two: '1.2' }, ['one', 'two']);
  let notifications = 0; const stop = store.subscribe('one', () => notifications++);
  store.update(data, { one: '2.1', two: '2.2' }, ['one']);
  assert.equal(store.get('one')?.number, '2.1'); assert.equal(store.get('one')?.question, data.one); assert.equal(notifications, 1);
  assert.equal(store.get('two'), undefined); stop(); store.update(data, {}, []); assert.equal(store.get('one'), undefined);
});
