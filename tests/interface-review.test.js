/**
 * Interface source-contract checks. These execute actual app helper/render/storage
 * code in Node vm with explicit document/storage stubs. They DO NOT run a
 * browser, parse HTML, validate native forms, test CSS, or prove accessibility.
 * Run: node --test tests/interface-review.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as model from '../src/model.js';
import * as ui from '../src/ui-utils.js';
import { examples } from '../src/examples.js';

const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
const clone = value => JSON.parse(JSON.stringify(value));
const stateFrom = (id = 'agreement') => ({ version: 1, exampleId: id, modified: false, case: clone(examples.find(e => e.id === id).case) });
function harness({ stored = null, readBlocked = false, writeBlocked = false } = {}) {
  const writes = [], listeners = {}, nodes = new Map();
  for (const key of ['#app', '#dialog-root', '#announcer']) nodes.set(key, { innerHTML: '', textContent: '' });
  const doc = {
    querySelector: selector => nodes.get(selector) || null,
    getElementById: () => null,
    addEventListener: (name, callback) => (listeners[name] ||= []).push(callback),
    activeElement: null,
  };
  const sandbox = vm.createContext({
    ...model, ...ui, examples, document: doc, Intl, URL, Blob, console, setTimeout,
    crypto: { randomUUID: () => 'review-generated-id' },
    localStorage: {
      getItem: () => { if (readBlocked) throw new Error('Read blocked'); return stored; },
      setItem: (key, value) => { if (writeBlocked) throw new Error('Write blocked'); writes.push({ key, value }); stored = value; },
    },
    FormData: class { constructor(form) { this.data = form.data; } *[Symbol.iterator]() { yield* Object.entries(this.data); } },
  });
  vm.runInContext(source, sandbox, { filename: 'src/app.js' });
  return { sandbox, writes, listeners, nodes, evaluate: text => vm.runInContext(text, sandbox), stored: () => stored };
}
test('interface: render escapes source text and limits links to HTTP(S)', () => {
  const data = stateFrom();
  const payload = '<img src=x onerror="globalThis.pwned=1"> & <script>bad()</script>';
  const s = data.case.sources[0];
  s.label = payload; s.quote = payload; s.url = 'javascript:alert(1)'; s.resolution = { note: payload };
  const h = harness({ stored: JSON.stringify(data) });
  const html = h.nodes.get('#app').innerHTML;
  assert.ok(html.includes('&lt;img src=x onerror=&quot;globalThis.pwned=1&quot;&gt;'));
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes('<script>bad()'), false);
  assert.equal(html.includes('href="javascript:'), false);
  assert.equal(ui.safeURL('data:text/html,hello'), null);
  assert.equal(ui.safeURL('file:///tmp/test'), null);
  assert.equal(ui.safeURL('//example.com'), null);
  assert.equal(ui.safeURL('https://example.com/path?a=1&b=2'), 'https://example.com/path?a=1&b=2');
  assert.match(html, /rel="noopener noreferrer"/);
});

test('interface: corrupt or read-blocked storage is preserved and never overwritten by normal edits', () => {
  for (const options of [{ stored: '{broken' }, { readBlocked: true }]) {
    const h = harness(options);
    assert.match(h.nodes.get('#app').innerHTML, /could not be read/);
    h.evaluate('state.case.title = "Changed"; persist(); render()');
    assert.equal(h.writes.length, 0);
    if (options.stored) assert.equal(h.stored(), options.stored);
  }
});

test('interface: write-blocked storage reports unsaved data without losing the in-memory case', () => {
  const h = harness({ writeBlocked: true });
  h.evaluate('state.case.title = "Still here"; persist(); render()');
  assert.equal(h.evaluate('state.case.title'), 'Still here');
  assert.match(h.nodes.get('#app').innerHTML, /could not save/);
  assert.match(h.nodes.get('#app').innerHTML, /Not saved/);
});

test('interface: malformed stored clarification fields fail closed without crashing render', () => {
  for (const [field, value] of [
    ['note', { toString: null }], ['zone', { toString: null }],
    ['note', 123], ['zone', true], ['fold', 'guessed'], ['weekday', 'ignore'],
  ]) {
    const data = stateFrom();
    data.case.sources[0].resolution = { [field]: value };
    const serialized = JSON.stringify(data);
    const h = harness({ stored: serialized });
    assert.match(h.nodes.get('#app').innerHTML, /could not be read/, `${field} must be rejected`);
    assert.equal(h.stored(), serialized);
    assert.equal(h.writes.length, 0);
  }
});

test('interface: every accepted UTC alias produces a usable date label', () => {
  for (const zone of ['UTC', 'utc', 'Etc/UTC', 'Z', 'z', '+05:30', '-00:00', 'America/New_York']) {
    assert.doesNotThrow(() => model.normalizeZone(zone));
    const parts = ui.dateParts('2026-10-31T06:59:00Z', zone);
    assert.notEqual(parts.day, 'Check display zone', zone);
    assert.notEqual(parts.time, '—', zone);
  }
});

test('interface: persisted source-count boundary accepts 100 and rejects 101', () => {
  const data = stateFrom();
  const template = data.case.sources[0];
  data.case.sources = Array.from({ length: 100 }, (_, i) => ({ ...clone(template), id: `review-${i}` }));
  assert.equal(ui.validState(data), true);
  data.case.sources.push({ ...clone(template), id: 'review-100' });
  assert.equal(ui.validState(data), false);
});

test('interface: storage rejects duplicate IDs, nonintegral buffers, and oversized strings', () => {
  const data = stateFrom();
  data.case.sources[1].id = data.case.sources[0].id;
  assert.equal(ui.validState(data), false);
  for (const buffer of [-1, 10081, 1.5, '1']) {
    const invalid = stateFrom(); invalid.case.bufferMinutes = buffer;
    assert.equal(ui.validState(invalid), false);
  }
  for (const [key, limit] of [['label', 100], ['quote', 10000], ['url', 2000], ['zone', 100]]) {
    const invalid = stateFrom(); invalid.case.sources[0][key] = 'X'.repeat(limit + 1);
    assert.equal(ui.validState(invalid), false, key);
  }
});

test('interface: all six synthetic cases produce their advertised issue or agreement', () => {
  const result = Object.fromEntries(examples.map(example => [example.id, model.analyzeCase(example.case)]));
  assert.equal(result.disagreement.status, 'conflict');
  assert.equal(result.disagreement.spreadMinutes, 59);
  for (const [id, code] of [['fold', 'dst-fold'], ['gap', 'dst-gap'], ['missing-zone', 'missing-zone'], ['weekday', 'weekday-conflict']]) {
    assert.equal(result[id].canExport, false, id);
    assert.equal(result[id].planningInstant, null, id);
    assert.ok(result[id].results[0].issues.some(issue => issue.code === code), id);
  }
  assert.equal(result.agreement.status, 'agreement');
  assert.equal(result.agreement.earliest.instant, '2026-10-31T06:59:00Z');
  assert.equal(result.agreement.planningInstant, '2026-10-31T05:59:00Z');
});

test('interface: calendar export is a tentative, transparent one-minute planning marker with escaped evidence', () => {
  const text = model.exportCalendar(stateFrom().case, { now: '2026-10-18T12:00:00Z' }).replace(/\r\n /g, '');
  assert.match(text, /DTSTART:20261031T055900Z/);
  assert.match(text, /DTEND:20261031T060000Z/);
  assert.match(text, /SUMMARY:Planning target:/);
  assert.match(text, /STATUS:TENTATIVE/);
  assert.match(text, /TRANSP:TRANSPARENT/);
  assert.match(text, /not an official deadline/);
  assert.match(text, /Original statement:/);
  assert.doesNotMatch(text, /BEGIN:VALARM/);
});
