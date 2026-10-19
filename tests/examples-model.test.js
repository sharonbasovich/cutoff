import test from 'node:test';
import assert from 'node:assert/strict';
import { examples } from '../src/examples.js';
import { analyzeCase } from '../src/model.js';

test('all six judge examples have correct states and exclusively synthetic source links',()=>{
  const expected={disagreement:'conflict',fold:'blocked',gap:'blocked','missing-zone':'blocked',weekday:'blocked',agreement:'agreement'};
  assert.deepEqual(examples.map(e=>e.id).sort(),Object.keys(expected).sort());
  for(const e of examples){assert.equal(analyzeCase(e.case).status,expected[e.id],e.id);for(const s of e.case.sources)assert.equal(new URL(s.url).hostname,'example.com');}
});
test('fold example needs a decision, preserves wording, and exports only after resolution',()=>{
  const c=structuredClone(examples.find(e=>e.id==='fold').case);const quote=c.sources[0].quote;
  assert.equal(analyzeCase(c).canExport,false);c.sources[0].resolution={fold:'later',note:'Synthetic explicit confirmation'};
  const result=analyzeCase(c);assert.equal(result.canExport,true);assert.equal(c.sources[0].quote,quote);assert.equal(result.planningInstant,'2026-11-01T06:00:00Z');
});
test('agreement example produces a conservative planning marker one hour earlier',()=>{
  const c=examples.find(e=>e.id==='agreement').case;const r=analyzeCase(c);
  assert.equal(r.earliest.instant,'2026-10-31T06:59:00Z');assert.equal(r.planningInstant,'2026-10-31T05:59:00Z');assert.equal(r.canExport,true);
});
