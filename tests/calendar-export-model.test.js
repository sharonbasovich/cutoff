import test from 'node:test';
import assert from 'node:assert/strict';
import { exportCalendar } from '../src/model.js';
import { examples } from '../src/examples.js';
import { assertResolvedFoldCalendarExport } from './calendar-export-assertions.js';

const data = structuredClone(examples.find(example => example.id === 'fold').case);
data.sources[0].resolution = {
  fold: 'later',
  note: 'Synthetic organizer explicitly confirmed the second occurrence.',
};
const text = exportCalendar(data, { now: '2026-10-19T13:49:15Z' });
const check = value => assertResolvedFoldCalendarExport(Buffer.from(value, 'utf8'));

test('browser calendar assertion accepts the actual folded export that failed hosted QA', () => {
  assert.match(text, /Original st\r\n atement:/);
  assert.throws(() => assert.match(text, /Original statement:/), assert.AssertionError);
  const bytes = Buffer.from(text, 'utf8'), original = Buffer.from(bytes);
  const unfolded = assertResolvedFoldCalendarExport(bytes);
  assert.match(unfolded, /Original statement: Registration closes November 1\\, 2026/);
  assert.deepEqual(bytes, original, 'Validation must leave downloaded evidence bytes untouched');
});

test('browser calendar assertion unfolds SPACE and HTAB for all three semantic checks', () => {
  for (const whitespace of [' ', '\t']) {
    const folded = text.replace(/\r\n /g, `\r\n${whitespace}`)
      .replace('DTSTART:20261101T060000Z', `DTSTART:20261101T\r\n${whitespace}060000Z`)
      .replace('SUMMARY:Planning target:', `SUMMARY:Planning\r\n${whitespace} target:`);
    assert.doesNotThrow(() => check(folded));
  }
});

test('browser calendar assertion rejects bare CR/LF and a missing final CRLF', () => {
  for (const invalid of [text.replace(/\r\n/g, '\n'), text.replace(/\r\n/g, '\r'), text.slice(0, -2)]) {
    assert.throws(() => check(invalid), assert.AssertionError);
  }
});

test('browser calendar assertion enforces octet folding, including multibyte text', () => {
  for (const extraLine of ['X-TEST:' + 'a'.repeat(69), 'X-TEST:' + 'é'.repeat(35)]) {
    assert.ok(Buffer.byteLength(extraLine, 'utf8') > 75);
    assert.throws(() => check(text.replace('END:VEVENT', `${extraLine}\r\nEND:VEVENT`)), /75 UTF-8 octets/);
  }
});

test('browser calendar assertion still rejects wrong time, missing planning label and missing source evidence', () => {
  for (const [before, after] of [
    ['DTSTART:20261101T060000Z', 'DTSTART:20261101T050000Z'],
    ['SUMMARY:Planning target:', 'SUMMARY:Official target:'],
    ['Original st\r\n atement:', 'Omitted! st\r\n atement:'],
  ]) {
    assert.ok(text.includes(before));
    assert.throws(() => check(text.replace(before, after)), assert.AssertionError);
  }
});

test('browser calendar assertion does not repair malformed folds or discard meaningful whitespace', () => {
  for (const separator of ['\r\n', '\n ', '\r ', '\r\n\v', '\r\n  ', '\r\n\t ']) {
    assert.throws(() => check(text.replace('Original st\r\n atement:', `Original st${separator}atement:`)), assert.AssertionError);
  }
});

test('browser calendar assertion requires source evidence within DESCRIPTION and a complete calendar', () => {
  assert.throws(() => check(text.replace('DESCRIPTION:', 'X-OTHER:')), assert.AssertionError);
  assert.throws(() => check(text.replace('BEGIN:VCALENDAR', 'BEGIN:VEVENT')), assert.AssertionError);
  assert.throws(() => check(text.replace('END:VCALENDAR\r\n', '')), assert.AssertionError);
  assert.throws(() => check(text.replace('VERSION:2.0\r\n', 'VERSION:2.0\r\n\r\n')), assert.AssertionError);
});

test('browser calendar assertion rejects invalid UTF-8 instead of silently replacing bytes', () => {
  const corrupted = Buffer.from(text, 'utf8');
  corrupted[corrupted.indexOf('Event notice')] = 0xff;
  assert.throws(() => assertResolvedFoldCalendarExport(corrupted), TypeError);
});
