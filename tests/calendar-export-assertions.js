import assert from 'node:assert/strict';

// Shared by the browser download check and its non-browser regression. Keep raw
// bytes for evidence; only unfold the copy used for semantic content assertions.
export function assertResolvedFoldCalendarExport(bytes) {
  assert.ok(Buffer.isBuffer(bytes), 'Inspect the raw downloaded calendar bytes');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert.ok(text.endsWith('\r\n'), 'Calendar must end with CRLF');
  assert.doesNotMatch(text.replace(/\r\n/g, ''), /[\r\n]/, 'Calendar must use CRLF line endings');
  assert.doesNotMatch(text, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/, 'Calendar must not contain forbidden controls');
  const lines = text.slice(0, -2).split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines.at(-1), 'END:VCALENDAR');
  for (const line of lines) {
    assert.ok(line.length > 0, 'Calendar must not contain empty physical lines');
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, 'Cutoff folds physical lines at 75 UTF-8 octets');
  }
  // RFC 5545 section 3.1: remove CRLF plus exactly one SPACE or HTAB, not
  // arbitrary whitespace or ordinary property-delimiting CRLF sequences.
  const unfolded = text.replace(/\r\n[ \t]/g, '');
  assert.match(unfolded, /(?:^|\r\n)DTSTART:20261101T060000Z\r\n/);
  assert.match(unfolded, /(?:^|\r\n)SUMMARY:Planning target:/);
  assert.match(unfolded, /(?:^|\r\n)DESCRIPTION:[^\r\n]*Original statement:/);
  return unfolded;
}
