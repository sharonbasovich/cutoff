import { Temporal } from '@js-temporal/polyfill';
import { normalizeZone } from './model.js';

const textWithin = (value, limit, required = false) => typeof value === 'string' && value.length <= limit && (!required || value.length > 0);
const optionalText = (value, limit) => value === undefined || value === null || textWithin(value, limit);

/** Validate persisted data before it reaches presentation or export code. */
export function validSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  if (!textWithin(source.id, 100, true) || !textWithin(source.label, 100) || !textWithin(source.quote, 10000) || !textWithin(source.date, 10) || !textWithin(source.time, 5) || !textWithin(source.zone, 100)) return false;
  if (!optionalText(source.url, 2000) || !optionalText(source.weekday, 9)) return false;
  if (source.resolution === undefined || source.resolution === null) return true;
  const resolution = source.resolution;
  if (typeof resolution !== 'object' || Array.isArray(resolution)) return false;
  if (Object.keys(resolution).some(key => !['zone', 'fold', 'weekday', 'note'].includes(key))) return false;
  if (resolution.zone !== undefined && !textWithin(resolution.zone, 100)) return false;
  if (resolution.note !== undefined && !textWithin(resolution.note, 2000)) return false;
  if (resolution.fold !== undefined && !['earlier', 'later'].includes(resolution.fold)) return false;
  if (resolution.weekday !== undefined && resolution.weekday !== 'date') return false;
  return true;
}

export function validState(value) {
  const data = value?.case;
  return !!(value && typeof value === 'object' && !Array.isArray(value) && value.version === 1 && data &&
    textWithin(data.title, 120) && textWithin(data.localZone, 100, true) &&
    Number.isInteger(data.bufferMinutes) && data.bufferMinutes >= 0 && data.bufferMinutes <= 10080 &&
    Array.isArray(data.sources) && data.sources.length <= 100 && data.sources.every(validSource) &&
    new Set(data.sources.map(source => source.id)).size === data.sources.length &&
    (value.exampleId === undefined || value.exampleId === null || textWithin(value.exampleId, 100)) &&
    (value.modified === undefined || typeof value.modified === 'boolean'));
}

/** Never turn an entered non-HTTP scheme into an actionable source link. */
export function safeURL(url) {
  if (typeof url !== 'string' || url.length > 2000) return null;
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
}

/** UI date fields retain nonzero seconds, including historical-zone offsets. */
export function dateParts(instant, zone) {
  try {
    const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO(normalizeZone(zone));
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const pad = value => String(value).padStart(2, '0');
    const precise = zoned.second || zoned.millisecond || zoned.microsecond || zoned.nanosecond;
    return {
      day: `${months[zoned.month - 1]} ${zoned.day}, ${zoned.year}`,
      time: precise ? zoned.toPlainTime().toString() : `${pad(zoned.hour)}:${pad(zoned.minute)}`,
      weekday: weekdays[zoned.dayOfWeek - 1],
    };
  } catch { return { day: 'Check display zone', time: '—', weekday: '' }; }
}
