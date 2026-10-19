import test from 'node:test';
import assert from 'node:assert/strict';
import { Temporal } from '@js-temporal/polyfill';
import { analyzeSource, analyzeCase, exportCalendar, formatInstant, foldCalendarLine } from '../src/model.js';

const source = (overrides = {}) => ({ id: 'review', label: 'Rules', quote: 'Original deadline statement', date: '2026-10-31', time: '21:00', zone: 'UTC', ...overrides });
const scenario = (overrides = {}) => ({ title: 'Review case', sources: [source()], localZone: 'UTC', bufferMinutes: 60, ...overrides });
const has = (result, code) => result.issues.some(item => item.code === code);

test('review: malformed records and null sources fail closed without throwing', () => {
  for (const input of [null, false, 1, 'text', []]) {
    const result = analyzeCase(input);
    assert.equal(result.canExport, false);
    assert.equal(result.planningInstant, null);
  }
  for (const input of [null, false, 1, 'text', []]) {
    assert.equal(analyzeSource(input).status, 'invalid');
    const result = analyzeCase(scenario({ sources: [source(), input] }));
    assert.equal(result.canExport, false);
    assert.equal(result.planningInstant, null);
  }
});

test('review: a sparse source array cannot silently lose an unresolved source', () => {
  for (const sources of [new Array(1), [source(), , source()]]) {
    const result = analyzeCase(scenario({ sources }));
    assert.equal(result.canExport, false);
    assert.equal(result.planningInstant, null);
    assert.equal(result.results.length, sources.length);
  }
});

test('review: buffer rejects coercible nonnumbers and nondecimal strings', () => {
  for (const bufferMinutes of [true, false, [], ['5'], {}, ' ', '\t', '\n', '0x10', '1e2', '1.0']) {
    const result = analyzeCase(scenario({ bufferMinutes }));
    assert.equal(result.canExport, false, JSON.stringify(bufferMinutes));
    assert.equal(result.planningInstant, null, JSON.stringify(bufferMinutes));
    assert.ok(has(result, 'invalid-buffer'), JSON.stringify(bufferMinutes));
  }
  for (const bufferMinutes of [0, 1, 10080, '0', '1', '10080']) {
    assert.equal(analyzeCase(scenario({ bufferMinutes })).canExport, true, JSON.stringify(bufferMinutes));
  }
});

test('review: calendar range checks both UTC start and one-minute end', () => {
  const cases = [
    scenario({ sources: [source({ date: '9999-12-31', time: '23:59' })], bufferMinutes: 0 }),
    scenario({ sources: [source({ date: '9999-12-31', time: '23:59', zone: '-12:00' })], bufferMinutes: 0 }),
    scenario({ sources: [source({ date: '0001-01-01', time: '00:00', zone: '+14:00' })], bufferMinutes: 0 }),
    scenario({ sources: [source({ date: '0001-01-01', time: '00:00' })], bufferMinutes: 1 }),
  ];
  for (const data of cases) {
    const result = analyzeCase(data);
    assert.equal(result.canExport, false, JSON.stringify(data));
    assert.ok(has(result, 'calendar-range'));
    assert.throws(() => exportCalendar(data), RangeError);
  }
  for (const [date, time] of [['0001-01-01', '00:00'], ['9999-12-31', '23:58']]) {
    const data = scenario({ sources: [source({ date, time })], bufferMinutes: 0 });
    assert.equal(analyzeCase(data).canExport, true);
    for (const line of exportCalendar(data).split('\r\n').filter(line => /^DT(?:START|END|STAMP):/.test(line))) {
      assert.match(line, /^DT(?:START|END|STAMP):\d{8}T\d{6}Z$/);
    }
  }
});

test('review: historical offsets with seconds retain exact display precision', () => {
  const result = analyzeSource(source({ date: '1850-01-01', time: '12:00', zone: 'America/New_York' }));
  assert.equal(result.instant, '1850-01-01T16:56:02Z');
  assert.match(result.displayLocal, /16:56:02/);
  assert.match(formatInstant('1850-01-01T16:56:02Z', 'UTC'), /16:56:02/);
});

test('review: calendar text does not emit forbidden C0 or DEL controls', () => {
  const controlText = 'A\u0000B\u000bC\u000cD\u001fE\u007fF';
  const data = scenario({ title: controlText, sources: [source({ label: controlText, quote: controlText, url: controlText, resolution: { note: controlText } })] });
  const calendar = exportCalendar(data);
  assert.doesNotMatch(calendar, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
  assert.equal(data.title, controlText, 'sanitization must not overwrite raw input');
});

test('review: 24-hour and 23-hour historical folds preserve both candidates', () => {
  for (const [date, zone, expectedMinutes] of [['1892-07-04', 'Pacific/Apia', 1440], ['1969-09-30', 'Pacific/Kwajalein', 1380]]) {
    const result = analyzeSource(source({ date, time: '12:00', zone }));
    assert.equal(result.status, 'unresolved');
    assert.ok(has(result, 'dst-fold'));
    assert.equal((result.candidates[1].epochMs - result.candidates[0].epochMs) / 60000, expectedMinutes);
    for (const candidate of result.candidates) {
      const local = Temporal.Instant.from(candidate.instant).toZonedDateTimeISO(zone);
      assert.equal(local.toPlainDate().toString(), date);
      assert.equal(local.toPlainTime().toString({ smallestUnit: 'minute' }), '12:00');
    }
  }
});

test('review: weekday mismatch and fold each need their own explicit resolution', () => {
  const original = source({ date: '2026-11-01', time: '01:30', zone: 'America/Toronto', weekday: 'Saturday' });
  for (const resolution of [{}, { fold: 'earlier' }, { weekday: 'date' }]) {
    const result = analyzeSource({ ...original, resolution });
    assert.equal(result.status, 'unresolved');
    assert.equal(result.instant, null);
  }
  const result = analyzeSource({ ...original, resolution: { fold: 'later', weekday: 'date' } });
  assert.equal(result.status, 'resolved');
  assert.equal(result.instant, '2026-11-01T06:30:00Z');
  assert.equal(result.source.weekday, 'Saturday');
  assert.ok(has(result, 'weekday-resolved'));
  assert.ok(has(result, 'fold-resolved'));
});

test('review: zero buffer still uses earliest conflicting exact instant and locks export', () => {
  const data = scenario({ sources: [source(), source({ id: 'b', time: '21:01' })], bufferMinutes: 0 });
  const result = analyzeCase(data);
  assert.equal(result.status, 'conflict');
  assert.equal(result.spreadMinutes, 1);
  assert.equal(result.planningInstant, '2026-10-31T21:00:00Z');
  assert.equal(result.canExport, false);
});

test('review: control-looking prose cannot create ICS properties after unfolding', () => {
  const attack = '\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:19000101T000000Z\r\nATTENDEE:evil@example.com';
  const data = scenario({ title: attack, sources: [source({ label: attack, quote: attack, url: attack, resolution: { note: attack } })] });
  const calendar = exportCalendar(data).replace(/\r\n[ \t]/g, '');
  const lines = calendar.split('\r\n');
  assert.equal(lines.filter(line => line === 'BEGIN:VEVENT').length, 1);
  assert.equal(lines.filter(line => line === 'END:VEVENT').length, 1);
  assert.equal(lines.filter(line => line.startsWith('DTSTART:')).length, 1);
  assert.equal(lines.filter(line => line.startsWith('ATTENDEE:')).length, 0);
});

test('review: UTF-8 folding boundary tests preserve code points and full lines', () => {
  for (const prefixLength of [0, 1, 70, 71, 72, 73, 74, 75, 76, 149, 150]) {
    for (const content of ['é', '東', '🕰', '\\n', '👩🏽‍💻']) {
      const original = 'X'.repeat(prefixLength) + content.repeat(40);
      const folded = foldCalendarLine(original);
      assert.equal(folded.replace(/\r\n /g, ''), original);
      for (const line of folded.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
    }
  }
});
