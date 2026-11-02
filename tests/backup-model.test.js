import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, readBackup, MAX_BACKUP_BYTES } from '../src/backup.js';
import { analyzeCase } from '../src/model.js';
import { examples } from '../src/examples.js';
const state = (id='disagreement') => ({version:1,exampleId:id,modified:false,case:structuredClone(examples.find(e=>e.id===id).case)});
const stamp='2026-11-02T20:00:00.000Z';
const alter = fn => {const value=JSON.parse(createBackup(state(),stamp));fn(value);return JSON.stringify(value);};
test('backup roundtrip retains every example, evidence and unresolved verdict without shared references',()=>{
  for(const example of examples){const before=state(example.id), loaded=readBackup(createBackup(before,stamp));assert.deepEqual(loaded.workspace,before);assert.equal(loaded.createdAt,stamp);assert.deepEqual(analyzeCase(loaded.workspace.case),analyzeCase(before.case));loaded.workspace.case.title='changed';assert.notEqual(before.case.title,'changed');}
});
test('backup retains source facts that require clarification instead of inventing a resolution',()=>{
  const before=state();before.case.sources[0].date='2026-02-31';before.case.sources[1].zone='Unknown/Zone';
  const after=readBackup(createBackup(before,stamp)).workspace;assert.deepEqual(after,before);assert.equal(analyzeCase(after.case).status,'blocked');
});
test('backup rejects unknown fields, computed verdicts, unsupported versions and unsafe object keys',()=>{
  for(const mutate of [v=>v.extra=1,v=>v.version=2,v=>v.format='other',v=>v.workspace.canExport=true,v=>v.workspace.case.analysis={},v=>v.workspace.case.sources[0].trusted=true,v=>v.workspace.case.sources[0].resolution={canExport:true}]) assert.throws(()=>readBackup(alter(mutate)));
  for(const key of ['__proto__','prototype','constructor']) assert.throws(()=>readBackup(alter(v=>{Object.defineProperty(v.workspace.case.sources[0],key,{value:{polluted:true},enumerable:true});})));
  assert.equal({}.polluted,undefined);
});
test('backup rejects invalid timestamp and display zone, excessive count, duplicate IDs and invalid bounds',()=>{
  for(const mutate of [v=>v.createdAt='2026-02-30T20:00:00.000Z',v=>v.createdAt='tomorrow',v=>delete v.createdAt,v=>v.workspace.case.localZone='Invalid/Zone',v=>v.workspace.case.sources=Array.from({length:101},(_,i)=>({...v.workspace.case.sources[0],id:String(i)})),v=>v.workspace.case.sources[1].id=v.workspace.case.sources[0].id,v=>v.workspace.case.bufferMinutes=-1,v=>v.workspace.case.sources[0].quote='x'.repeat(10001)]) assert.throws(()=>readBackup(alter(mutate)));
});
test('backup enforces byte limit, including multibyte payloads, and rejects malformed JSON',()=>{
  assert.throws(()=>readBackup(' '.repeat(MAX_BACKUP_BYTES+1)));assert.throws(()=>readBackup('é'.repeat(MAX_BACKUP_BYTES/2+1)));assert.throws(()=>readBackup('{'));assert.throws(()=>readBackup('null'));assert.throws(()=>readBackup('[]'));
});
