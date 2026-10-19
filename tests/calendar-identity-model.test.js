import test from 'node:test';
import assert from 'node:assert/strict';
import { exportCalendar } from '../src/model.js';

const scenario = (title, time = '21:00') => ({
  title, localZone: 'UTC', bufferMinutes: 60,
  sources: [{ id: 'deadline', label: 'Rules', quote: `Deadline: October 31, 2026 at ${time} UTC`, date: '2026-10-31', time, zone: 'UTC' }],
});
const uid = (data, now = '2026-10-19T10:00:00Z') => exportCalendar(data, { now }).match(/^UID:(.+)\r$/m)[1];

test('calendar identity: distinct deadlines from a concrete 32-bit collision have different UIDs', () => {
  // Both exported cutoff-8d4c876f@local.invalid with the original 32-bit fingerprint.
  const morning = scenario('Deadline sahj5s', '04:15');
  const afternoon = scenario('Deadline 7lmvrk', '15:43');
  assert.notEqual(uid(morning), uid(afternoon));
  assert.equal(uid(morning), 'cutoff-4a293c58a12a4c4dd9c4797b21f62d7f@local.invalid');
  assert.equal(uid(afternoon), 'cutoff-6ca45c332fc6d7d1a1c74175a0a8cca7@local.invalid');
  assert.match(exportCalendar(morning), /DTSTART:20261031T031500Z\r\n/);
  assert.match(exportCalendar(afternoon), /DTSTART:20261031T144300Z\r\n/);
});

test('calendar identity: independent UTF-8 FNV-1a-128 integration vectors', () => {
  // Expected values calculated separately using Python integer arithmetic over
  // the exact identity's UTF-8 bytes, never by the application helper under test.
  for (const [title, fingerprint] of [
    ['Deadline 1q3w3i8 1odysdb', '428cdf50370a67b8a213ce1e7e92adde'],
    ['Deadline ultjtk 1cf642f', '8611a41e9dfe1591f70308b8540ecff6'],
    ['é ☕ 🗓️', 'b532fb94fb4d0ce539431071ff46dad4'],
  ]) assert.equal(uid(scenario(title)), `cutoff-${fingerprint}@local.invalid`);
});

test('calendar identity: repeated export, save/load, and display changes preserve the UID', () => {
  const data = scenario('Repeatable plan');
  const expected = uid(data);
  assert.match(expected, /^cutoff-[0-9a-f]{32}@local\.invalid$/);
  assert.equal(uid(data, '2026-10-20T12:34:56Z'), expected, 'export timestamp is not event identity');
  assert.equal(uid(JSON.parse(JSON.stringify(data))), expected, 'saved workspace retains identity');
  assert.equal(uid({ ...data, localZone: 'Asia/Tokyo' }), expected, 'display zone is not event identity');
  assert.equal(uid({ ...data, title: '  Repeatable plan  ' }), expected, 'existing title normalization is retained');
});

test('calendar identity: existing title, source evidence, and target identity policy is retained', () => {
  const data = scenario('Original plan');
  const variants = [
    data,
    { ...data, title: 'Different plan' },
    { ...data, bufferMinutes: 30 },
    { ...data, sources: [{ ...data.sources[0], id: 'different-source' }] },
    { ...data, sources: [{ ...data.sources[0], resolution: { note: 'Confirmed separately.' } }] },
  ];
  assert.equal(new Set(variants.map(value => uid(value))).size, variants.length);
});
