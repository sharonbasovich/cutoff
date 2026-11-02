import { validState } from './ui-utils.js';
import { analyzeCase, normalizeZone } from './model.js';

export const MAX_BACKUP_BYTES = 2_000_000;
const allowed = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
function strictState(value) {
  return validState(value) && allowed(value, ['version', 'exampleId', 'modified', 'case']) &&
    allowed(value.case, ['title', 'localZone', 'bufferMinutes', 'sources']) &&
    value.case.sources.every(source => allowed(source, ['id', 'label', 'url', 'quote', 'date', 'time', 'zone', 'weekday', 'resolution']) &&
      (source.resolution == null || allowed(source.resolution, ['zone', 'fold', 'weekday', 'note'])));
}
function validateWorkspace(value) {
  if (!strictState(value)) throw new Error('This is not a supported Cutoff workspace. Check the fields, version and 100-source limit.');
  normalizeZone(value.case.localZone);
  // Invalid source dates/zones remain evidence: the model must mark them unresolved,
  // not silently repair them. No analysis or canExport flag is accepted from a file.
  analyzeCase(value.case);
  return JSON.parse(JSON.stringify(value));
}
export function createBackup(state, createdAt = new Date().toISOString()) {
  const snapshot = { format: 'cutoff-workspace', version: 1, createdAt, workspace: validateWorkspace(state) };
  const text = JSON.stringify(snapshot, null, 2);
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('This workspace exceeds the 2 MB backup limit.');
  return text;
}
export function readBackup(text) {
  if (typeof text !== 'string' || text.length > MAX_BACKUP_BYTES || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('Paste a Cutoff JSON backup no larger than 2 MB.');
  let value;
  try { value = JSON.parse(text, (key, item) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe key');
    return item;
  }); } catch { throw new Error('The backup is not valid JSON or contains unsupported object keys.'); }
  if (!allowed(value, ['format', 'version', 'createdAt', 'workspace']) || value.format !== 'cutoff-workspace' || value.version !== 1 ||
    typeof value.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt) throw new Error('Use a supported Cutoff workspace backup (format version 1).');
  return { createdAt: value.createdAt, workspace: validateWorkspace(value.workspace) };
}
