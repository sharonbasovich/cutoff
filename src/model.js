import { Temporal } from '@js-temporal/polyfill';

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');
const issue = (code, message, severity = 'error') => ({ code, message, severity });

/** Accept explicit numeric UTC offsets and region identifiers, never abbreviations like CST. */
export function normalizeZone(value) {
  if (typeof value !== 'string') throw new RangeError('Use a named region such as America/Toronto, UTC, or a numeric offset such as +05:30.');
  const zone = value.trim();
  if (/^(UTC|Etc\/UTC|Z)$/i.test(zone)) return 'UTC';
  if (!/^[+-]\d{2}:\d{2}$/.test(zone) && !/^[A-Za-z][A-Za-z0-9._+-]*(\/[A-Za-z0-9._+-]+)+$/.test(zone)) {
    throw new RangeError('Use a named region such as America/Toronto, UTC, or a numeric offset such as +05:30. Abbreviations like CST are ambiguous.');
  }
  // Validation uses Temporal and the runtime's time-zone database; no network lookup.
  return Temporal.Instant.from('2026-01-01T00:00Z').toZonedDateTimeISO(zone).timeZoneId;
}

export function formatInstant(instant, zone = 'UTC') {
  const z = Temporal.Instant.from(instant).toZonedDateTimeISO(normalizeZone(zone));
  const time = z.second || z.millisecond || z.microsecond || z.nanosecond ? z.toPlainTime().toString() : `${pad(z.hour)}:${pad(z.minute)}`;
  return `${weekdays[z.dayOfWeek - 1].slice(0, 3)}, ${months[z.month - 1]} ${z.day}, ${z.year}, ${time} · ${z.timeZoneId} (UTC${z.offset === '+00:00' ? '+00:00' : z.offset})`;
}

function candidate(z, displayZone) {
  const instant = z.toInstant().toString();
  return { instant, epochMs: z.epochMilliseconds, offset: z.offset, sourceLocal: formatInstant(instant, z.timeZoneId), displayLocal: formatInstant(instant, displayZone) };
}

/** Interpret structured fields, not prose. Never changes the caller's source or its resolution. */
export function analyzeSource(source = {}, localZone = 'UTC') {
  const validSource = source !== null && typeof source === 'object' && !Array.isArray(source);
  if (!validSource) source = {};
  const result = {
    id: typeof source.id === 'string' ? source.id : '',
    label: typeof source.label === 'string' && source.label.trim() ? source.label.trim() : 'Untitled source',
    source, status: 'invalid', issues: [], candidates: [], instant: null, epochMs: null,
    displayLocal: null, sourceLocal: null, offset: null,
  };
  if (!validSource) { result.issues.push(issue('invalid-source', 'This saved source is not a structured source statement.')); return result; }
  let displayZone;
  try { displayZone = normalizeZone(localZone); }
  catch { result.issues.push(issue('invalid-display-zone', 'Choose a valid display time zone.')); return result; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source.date || '') || !/^\d{2}:\d{2}$/.test(source.time || '')) {
    result.issues.push(issue('invalid-date-time', 'Enter a full calendar date and a 24-hour time, including minutes.')); return result;
  }
  let plain;
  try {
    const [year, month, day] = source.date.split('-').map(Number);
    const [hour, minute] = source.time.split(':').map(Number);
    if (year < 1 || year > 9999) throw new RangeError();
    plain = Temporal.PlainDateTime.from({ year, month, day, hour, minute }, { overflow: 'reject' });
  } catch {
    result.issues.push(issue('invalid-date-time', 'This calendar date or time does not exist. Use 00:00 for midnight, with the intended date.')); return result;
  }
  const resolution = source.resolution && typeof source.resolution === 'object' ? source.resolution : {};
  const sourceZone = typeof source.zone === 'string' ? source.zone.trim() : '';
  const clarifiedZone = typeof resolution.zone === 'string' ? resolution.zone.trim() : '';
  let zone;
  if (!sourceZone && !clarifiedZone) {
    result.status = 'unresolved';
    result.issues.push(issue('missing-zone', 'The source has no time zone. Add an explicit clarification; your device zone is never assumed.')); return result;
  }
  try { zone = normalizeZone(clarifiedZone || sourceZone); }
  catch (e) { result.issues.push(issue('invalid-zone', e.message)); return result; }
  if (clarifiedZone) result.issues.push(issue('zone-clarified', `Your clarification uses ${zone}. The original source zone remains ${sourceZone || 'unspecified'}.`, 'info'));

  let weekdayBlocked = false;
  if (source.weekday) {
    const entered = weekdays.find(x => x.toLowerCase() === String(source.weekday).toLowerCase());
    if (!entered) {
      weekdayBlocked = true;
      result.issues.push(issue('invalid-weekday', 'Use a full weekday name or leave the weekday empty.'));
    } else if (entered !== weekdays[plain.dayOfWeek - 1]) {
      if (resolution.weekday === 'date') {
        result.issues.push(issue('weekday-resolved', `You chose the entered calendar date (${weekdays[plain.dayOfWeek - 1]}) over the source weekday (${entered}). The mismatch is retained.`, 'info'));
      } else {
        weekdayBlocked = true;
        result.issues.push(issue('weekday-conflict', `${source.date} is a ${weekdays[plain.dayOfWeek - 1]}, but the source says ${entered}. Choose which statement to trust before exporting.`));
      }
    }
  }
  const fields = { year: plain.year, month: plain.month, day: plain.day, hour: plain.hour, minute: plain.minute, timeZone: zone };
  let earlier, later;
  try {
    earlier = Temporal.ZonedDateTime.from(fields, { disambiguation: 'earlier', overflow: 'reject' });
    later = Temporal.ZonedDateTime.from(fields, { disambiguation: 'later', overflow: 'reject' });
  } catch {
    result.issues.push(issue('unsupported-time', 'This date and zone cannot be interpreted by this browser.')); return result;
  }
  const earlierMatches = earlier.toPlainDateTime().equals(plain);
  const laterMatches = later.toPlainDateTime().equals(plain);
  if (!earlierMatches || !laterMatches) {
    result.status = 'unresolved';
    result.issues.push(issue('dst-gap', 'This wall-clock time never occurs in this zone because the clock jumps forward. Confirm a corrected time with the source. Cutoff will not shift it automatically.'));
    return result;
  }
  const folded = earlier.epochNanoseconds !== later.epochNanoseconds;
  result.candidates = folded ? [candidate(earlier, displayZone), candidate(later, displayZone)] : [candidate(earlier, displayZone)];
  let chosen;
  if (folded) {
    if (resolution.fold === 'earlier' || resolution.fold === 'later') {
      chosen = result.candidates[resolution.fold === 'earlier' ? 0 : 1];
      result.issues.push(issue('fold-resolved', `You chose the ${resolution.fold} occurrence (${chosen.offset}). The original repeated time is retained.`, 'info'));
    } else {
      result.status = 'unresolved';
      result.issues.push(issue('dst-fold', 'This wall-clock time occurs twice when the clock moves backward. Select an occurrence explicitly; neither is assumed.'));
    }
  } else chosen = result.candidates[0];
  if (weekdayBlocked || !chosen) { result.status = 'unresolved'; return result; }
  result.status = 'resolved';
  Object.assign(result, chosen);
  return result;
}

export function analyzeCase(caseData = {}) {
  if (!caseData || typeof caseData !== 'object' || Array.isArray(caseData)) caseData = {};
  const sources = Array.isArray(caseData.sources) ? caseData.sources : [];
  const results = Array.from(sources, s => analyzeSource(s, caseData.localZone || 'UTC'));
  const rawBuffer = caseData.bufferMinutes === undefined ? 60 : caseData.bufferMinutes;
  const numericBuffer = typeof rawBuffer === 'number' || (typeof rawBuffer === 'string' && /^\d+$/.test(rawBuffer));
  const bufferMinutes = numericBuffer ? Number(rawBuffer) : NaN;
  const validBuffer = numericBuffer && Number.isInteger(bufferMinutes) && bufferMinutes >= 0 && bufferMinutes <= 10080;
  const allResolved = results.length > 0 && results.every(r => r.status === 'resolved');
  const sorted = results.filter(r => r.status === 'resolved').sort((a,b) => a.epochMs - b.epochMs);
  const earliest = sorted[0] || null;
  const latest = sorted.at(-1) || null;
  const spreadMinutes = earliest && latest ? (latest.epochMs - earliest.epochMs) / 60000 : 0;
  const conflict = allResolved && spreadMinutes !== 0;
  const issues = validBuffer ? [] : [issue('invalid-buffer', 'Choose a whole-minute planning buffer from 0 to 10,080 minutes (one week).')];
  let status = !sources.length ? 'empty' : !allResolved || !validBuffer ? 'blocked' : conflict ? 'conflict' : 'agreement';
  const planningInstant = allResolved && validBuffer ? Temporal.Instant.from(earliest.instant).subtract({ minutes: bufferMinutes }).toString() : null;
  const calendarRange = planningInstant ? [Temporal.Instant.from(planningInstant), Temporal.Instant.from(planningInstant).add({minutes:1})].every(i => { const y = i.toZonedDateTimeISO('UTC').year; return y >= 1 && y <= 9999; }) : false;
  if (planningInstant && !calendarRange) { issues.push(issue('calendar-range', 'The planning marker falls outside calendar export’s supported UTC years 0001–9999.')); status = 'blocked'; }
  return {
    results, allResolved, conflict, status, earliest, latest, spreadMinutes,
    planningInstant, planningLocal: planningInstant ? formatInstant(planningInstant, caseData.localZone || 'UTC') : null,
    bufferMinutes, canExport: status === 'agreement' && calendarRange, issues,
  };
}

function escapeText(text) {
  return String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

/** RFC 5545 line folding counts UTF-8 octets, including the continuation space. */
export function foldCalendarLine(line) {
  const lines = []; let part = ''; let bytes = 0;
  for (const character of line) {
    const length = new TextEncoder().encode(character).length;
    if (bytes + length > 75) { lines.push(part); part = ' '; bytes = 1; }
    part += character; bytes += length;
  }
  lines.push(part);
  return lines.join('\r\n');
}
function calendarTime(instant) {
  return Temporal.Instant.from(instant).toString({ smallestUnit: 'second' }).replace(/[-:]/g, '');
}
function stableId(str) {
  // FNV-1a-128 over UTF-8 keeps repeat exports stable without the readily
  // colliding 32-bit UID space. This is an identity fingerprint, not a security hash.
  let h = 0x6c62272e07bb014262b821756295c58dn;
  const prime = (1n << 88n) + 0x13bn;
  for (const byte of new TextEncoder().encode(str)) h = BigInt.asUintN(128, (h ^ BigInt(byte)) * prime);
  return h.toString(16).padStart(32, '0');
}

/** Export a clearly labeled planning marker only after every source resolves and agrees. */
export function exportCalendar(caseData, { now = Temporal.Now.instant().toString() } = {}) {
  const result = analyzeCase(caseData);
  if (!result.canExport) throw new RangeError('Calendar export is locked until all source statements resolve to the same instant and the planning buffer is valid.');
  const title = typeof caseData.title === 'string' && caseData.title.trim() ? caseData.title.trim() : 'Deadline';
  const description = [
    'This is a personal planning target, not an official deadline.',
    `Agreed source instant: ${result.earliest.instant}`,
    `Planning buffer: ${result.bufferMinutes} minutes before the agreed instant.`,
    'Source statements were entered manually and have not been verified by Cutoff.',
    ...result.results.map(r => [
      `SOURCE: ${r.label}`, `Original statement: ${r.source.quote || '(not provided)'}`,
      `Entered date/time: ${r.source.date} ${r.source.time}; zone: ${r.source.zone || '(missing)'}; weekday: ${r.source.weekday || '(not stated)'}`,
      `URL: ${r.source.url || '(not provided)'}`, `Interpreted instant: ${r.instant}`,
      ...r.issues.map(i => i.message), r.source.resolution?.note ? `Your note: ${r.source.resolution.note}` : '',
    ].filter(Boolean).join('\n')),
  ].join('\n\n');
  const identity = JSON.stringify({ title, sources: caseData.sources, target: result.planningInstant });
  const end = Temporal.Instant.from(result.planningInstant).add({ minutes: 1 }).toString();
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cutoff//Deadline comparison 0.1//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:cutoff-${stableId(identity)}@local.invalid`, `DTSTAMP:${calendarTime(now)}`,
    `DTSTART:${calendarTime(result.planningInstant)}`, `DTEND:${calendarTime(end)}`,
    `SUMMARY:${escapeText(`Planning target: ${title}`)}`, `DESCRIPTION:${escapeText(description)}`,
    'STATUS:TENTATIVE', 'TRANSP:TRANSPARENT', 'END:VEVENT', 'END:VCALENDAR',
  ].map(foldCalendarLine).join('\r\n') + '\r\n';
}
