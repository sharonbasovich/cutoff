import './styles.css';
import { analyzeCase, analyzeSource, exportCalendar, formatInstant, normalizeZone } from './model.js';
import { examples } from './examples.js';
import { validState, safeURL, dateParts } from './ui-utils.js';
import { createBackup, readBackup } from './backup.js';

const KEY = 'cutoff.workspace.v1';
const app = document.querySelector('#app');
const dialogs = document.querySelector('#dialog-root');
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const zones = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];
const clone = value => JSON.parse(JSON.stringify(value));
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let storageError = '';
let saved = true;
let storageSnapshot = null;
let state = load();
let analysis;
// Unapplied settings stay in this tab until Apply or an intentional case change.
let settingsDraft = null;
let restoreUndo = null;

const paths = {
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  external: '<path d="M14 4h6v6m0-6L10 14M9 4H4v16h16v-5"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1L20 8a3.5 3.5 0 0 0-5-5L4 14v6Z"/>',
  warning: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v.1"/>',
  file: '<path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h6"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 7a8 8 0 0 1 13-2l2 3M4 16l2 3a8 8 0 0 0 13-2"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.clock}</svg>`;

function initialState() { return { version: 1, exampleId: 'disagreement', modified: false, case: clone(examples[0].case) }; }
function load() {
  try {
    const stored = localStorage.getItem(KEY);
    storageSnapshot = stored;
    if (!stored) { saved = false; return initialState(); }
    const parsed = JSON.parse(stored);
    if (!validState(parsed)) throw new Error('invalid');
    return parsed;
  } catch (error) {
    storageError = 'Your saved workspace could not be read. A fresh example is shown; your previous saved data has not been replaced. Start fresh to reset it.';
    saved = false;
    return initialState();
  }
}
function persist({ replaceExisting = false } = {}) {
  if (storageError && !replaceExisting) return;
  try {
    // Compare the bytes this tab last read/wrote before replacing shared storage.
    // This is a stale-write guard, not an atomic multi-tab locking protocol.
    if (!replaceExisting && localStorage.getItem(KEY) !== storageSnapshot) {
      storageError = 'The saved workspace changed outside this tab. Your edits remain here, but are not saved. Reload to use the saved version (discarding these edits), or use Start fresh only if you intend to replace the saved workspace with an empty case.';
      saved = false;
      return;
    }
    const serialized = JSON.stringify(state);
    localStorage.setItem(KEY, serialized);
    storageSnapshot = serialized;
    storageError = '';
    saved = true;
  }
  catch { storageError = 'This browser could not save your workspace. You can keep working, but changes may be lost when this page closes.'; saved = false; }
}
function announce(message) { document.querySelector('#announcer').textContent = message; }
function update(message = '', focusId = null) {
  restoreUndo = null;
  state.modified = true;
  persist(); render();
  if (message) announce(message);
  if (focusId) document.getElementById(focusId)?.focus();
}
function getAnalysis() {
  try { return analyzeCase(state.case); }
  catch { return { results: [], status: 'blocked', canExport: false, issues: [{ message: 'This workspace could not be calculated. Check your source dates, times, and zones.' }] }; }
}
function duration(minutes) {
  const value = Math.round(minutes * 100) / 100;
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60), remainder = value % 60;
  return `${hours} hr${remainder ? ` ${remainder} min` : ''}`;
}
function format(instant, zone = state.case.localZone) {
  try { return formatInstant(instant, zone); } catch { return 'Check time zone'; }
}
function sourceName(result, i) { return result?.label || result?.source?.label || `Source ${i + 1}`; }
function zoneOptions() { return `<datalist id="zone-options">${zones.map(z => `<option value="${z}"></option>`).join('')}</datalist>`; }
function render() {
  analysis = getAnalysis();
  const sources = state.case.sources;
  const settings = settingsDraft || state.case;
  const resolvedCount = analysis.results.filter(r => r.status === 'resolved').length;
  const unresolvedCount = sources.length - resolvedCount;
  const statusLabels = { empty: 'Start with a source', blocked: 'A little clarity needed', conflict: 'The sources disagree', agreement: 'The times line up' };
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#workspace" aria-label="Cutoff workspace"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>cutoff<span class="brand-dot">.</span></a>
      <span class="brand-caption">A CLEARER DEADLINE</span>
      <div class="topbar-right"><button class="button button-small button-quiet" id="backup-button" data-action="backup">${icon('download')} Backup & restore</button><span class="private-label">${icon('shield')} Local. Private. Yours.</span><button class="button button-small button-quiet" id="reset-button" data-action="reset">${icon('refresh')} Start fresh</button></div>
    </header>
    ${restoreUndo ? '<div class="backup-receipt" role="status"><span>Backup restored. Undo is available until your next workspace edit.</span><button class="button button-small button-outline" id="undo-restore" data-action="undo-restore">Undo restore</button></div>' : ''}
    ${storageError ? `<div class="storage-warning" role="alert">${icon('warning')}<span>${escape(storageError)}</span></div>` : ''}
    <main id="workspace" tabindex="-1">
      <section class="intro"><div><p class="eyebrow"><span class="tiny-cross">+</span> THE DEADLINE WORKBENCH</p><h1>Make time <span>make sense.</span></h1><p class="intro-copy">Different sources. Different time zones. One clear view of what’s due, and when.</p></div><div class="intro-note"><span class="note-rule"></span>Keep the evidence.<br>See the uncertainty.<br>Leave yourself room.</div></section>
      <div class="workbench">
        <aside class="sidebar" aria-label="Workspace settings and examples">
          <div class="sidebar-section case-section"><div class="section-eyebrow"><span>01</span> YOUR CASE</div><label class="field-label" for="workspace-title">Case name</label><input id="workspace-title" class="workspace-title" type="text" maxlength="120" value="${escape(state.case.title)}" placeholder="Give this deadline a name"><div class="save-state">${icon(storageError ? 'warning' : 'check')}<span>${storageError ? 'Not saved' : saved ? 'Saved in this browser' : 'Browser-only workspace'}</span></div></div>
          <form id="settings-form" class="sidebar-section" novalidate><div class="section-eyebrow"><span>02</span> YOUR PERSPECTIVE</div><label class="field-label" for="display-zone">Display time zone</label><input id="display-zone" name="localZone" list="zone-options" value="${escape(settings.localZone)}" required aria-describedby="zone-hint settings-draft-status"><p class="field-hint" id="zone-hint">IANA zone, UTC, or ±HH:MM</p><label class="field-label buffer-label" for="buffer-minutes">Planning buffer</label><div class="unit-input"><input id="buffer-minutes" name="bufferMinutes" type="text" inputmode="numeric" pattern="[0-9]+" value="${escape(settings.bufferMinutes)}" required aria-describedby="settings-draft-status"><span>minutes</span></div><p class="field-hint">Time to leave before the earliest source.</p><p class="field-hint" id="settings-draft-status" role="status">${settingsDraft ? escape(settingsDraftMessage()) : ''}</p><p class="field-error" id="settings-error" role="alert"></p><button class="button button-small button-outline full-width" type="submit">Apply settings ${icon('arrow')}</button></form>
          <div class="sidebar-section examples-section"><div class="section-eyebrow"><span>03</span> TRY AN EDGE CASE</div><div class="example-list">${examples.map((example, i) => `<button class="example-button ${state.exampleId === example.id && !state.modified ? 'is-active' : ''}" data-example="${example.id}" aria-pressed="${state.exampleId === example.id && !state.modified}"><span class="example-number">0${i + 1}</span><span><strong>${escape(example.name)}</strong><small>${escape(example.description)}</small></span>${icon('arrow')}</button>`).join('')}</div><p class="sidebar-footnote">All examples are synthetic.<br>No live pages are fetched or verified.</p></div>
        </aside>
        <div class="main-column">
          ${state.exampleId ? `<div class="demo-notice"><span class="demo-tag">SAMPLE CASE</span><span>${state.modified ? 'You’re editing a synthetic example.' : 'Explore the example, or start fresh with your own sources.'}</span></div>` : ''}
          <section class="verdict-section" aria-labelledby="verdict-title"><div class="verdict-top"><div><p class="eyebrow">THE CURRENT PICTURE</p><h2 id="verdict-title" tabindex="-1">${statusLabels[analysis.status] || 'Check your sources'}<span class="heading-dot">.</span></h2></div><span class="status-badge ${analysis.status}">${icon(analysis.status === 'agreement' ? 'check' : analysis.status === 'conflict' || analysis.status === 'blocked' ? 'warning' : 'plus')}${analysis.status === 'agreement' ? 'Exact match' : analysis.status === 'conflict' ? 'Conflict' : analysis.status === 'blocked' ? 'Unresolved' : 'Empty case'}</span></div><p class="verdict-copy">${verdictText(resolvedCount, unresolvedCount)}</p>${analysis.issues?.length ? `<div class="case-issues" role="alert">${analysis.issues.map(issue => `<p>${icon('warning')}<span>${escape(typeof issue === 'string' ? issue : issue.message)}</span></p>`).join('')}</div>` : ''}${renderPlanning()}${renderTimeline()}</section>
          <section class="sources-section" aria-labelledby="sources-heading"><div class="section-heading"><div><p class="eyebrow">KEEP THE RECEIPTS</p><h2 id="sources-heading">Source statements <span class="count">${sources.length}</span></h2></div><button class="button button-dark" id="add-source" data-action="add" ${sources.length >= 100 ? 'disabled aria-describedby="source-limit"' : ''}>${icon('plus')} Add source</button></div>${sources.length >= 100 ? '<p class="source-limit" id="source-limit" tabindex="-1" role="status">This case has reached the 100-source limit. Remove a source before adding another.</p>' : ''}${sources.length ? `<div class="source-list">${sources.map((source, index) => renderSource(source, analysis.results[index], index)).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">${icon('file')}</div><h3>Every deadline starts somewhere.</h3><p>Add the exact wording from a page, email, or brief.<br>Then enter the date, time, and zone it states.</p><button class="button button-outline" data-action="add">Add your first source ${icon('arrow')}</button></div>`}</section>
          <section class="calendar-section" aria-labelledby="calendar-heading"><div class="calendar-icon">${icon('download')}</div><div><h3 id="calendar-heading">A calendar entry you can explain.</h3><p>${analysis.canExport ? `All entered sources agree. Export your planning target, ${duration(state.case.bufferMinutes)} before the agreed instant, as a tentative one-minute calendar marker.` : 'Export unlocks when every source resolves to the same exact instant. A planning target alone is not a verified deadline.'}</p></div><button class="button button-outline" id="export-calendar" data-action="export" ${analysis.canExport ? '' : 'disabled'} aria-describedby="export-status">${icon('download')} Export .ics</button><p class="export-disclosure">The .ics file includes your source quotes, links, and clarification notes. Importing it to a cloud calendar may upload them to that provider. No automatic reminder is set.</p><span class="sr-only" id="export-status">${analysis.canExport ? 'Export is available.' : 'Export is locked until all sources agree.'}</span></section>
          <div class="method-note">${icon('shield')}<p>Structured inputs, transparent results. Cutoff does not read links, parse quotes, or verify a source’s authority. Confirm unclear deadlines with the organizer.</p></div>
        </div>
      </div>
    </main>
    <footer><span class="footer-brand">cutoff.</span><span>A little less uncertainty. A little more time.</span><span>No account. No tracking. On your device.</span></footer>${zoneOptions()}`;
}
function settingsDraftMessage() {
  return `Changes not applied. Comparison still uses ${state.case.localZone} and a ${state.case.bufferMinutes}-minute buffer. Apply settings to use these changes.`;
}
function verdictText(resolvedCount, unresolvedCount) {
  if (analysis.status === 'empty') return 'Add a source statement to compare the time it means, wherever you are.';
  if (analysis.status === 'blocked' && unresolvedCount === 0) return 'The source times resolve, but a workspace issue prevents calendar export. Review the note below.';
  if (analysis.status === 'blocked') return `${unresolvedCount} source${unresolvedCount === 1 ? ' needs' : 's need'} attention before a reliable comparison is possible. Resolve the uncertainty below.`;
  if (analysis.status === 'conflict') return `${state.case.sources.length} source statements point to different instants, ${duration(analysis.spreadMinutes)} apart. The earlier time is the conservative starting point.`;
  return `${state.case.sources.length === 1 ? 'This source resolves' : `All ${state.case.sources.length} sources resolve`} to one exact instant. This confirms the time conversion, not the source’s authority.`;
}
function renderPlanning() {
  if (!analysis.planningInstant || !analysis.allResolved) return `<div class="planning-placeholder">${icon('clock')}<div><strong>${analysis.status === 'empty' ? 'Your planning target will appear here.' : 'Uncertainty first. A target second.'}</strong><p>${analysis.status === 'empty' ? 'Compare sources, then leave a little breathing room.' : 'No planning target is calculated while a source is unresolved or invalid.'}</p></div></div>`;
  const parts = dateParts(analysis.planningInstant, state.case.localZone);
  return `<div class="planning-card"><div class="planning-main"><div class="planning-label"><span class="live-dot"></span> CONSERVATIVE PLANNING TARGET</div><div class="planning-date">${escape(parts.day)} <span class="planning-time">${escape(parts.time)}</span></div><div class="planning-zone">${escape(parts.weekday)} <span aria-hidden="true">·</span> ${escape(state.case.localZone)}</div></div><div class="planning-aside"><span class="buffer-value">${duration(state.case.bufferMinutes)}</span><span>before the earliest<br>source deadline</span></div><div class="planning-disclaimer">${icon('clock')} Your personal target. It does not replace any source statement.</div></div>`;
}
function renderTimeline() {
  const results = analysis.results.filter(r => r.status === 'resolved');
  if (!results.length) return '';
  const instants = results.map(r => r.epochMs);
  const min = Math.min(...instants, ...(analysis.planningInstant ? [new Date(analysis.planningInstant).getTime()] : []));
  const max = Math.max(...instants);
  const span = max - min || 60000;
  const grouped = [];
  results.forEach((result, index) => {
    let existing = grouped.find(item => item.epochMs === result.epochMs);
    if (existing) existing.labels.push(sourceName(result, index));
    else grouped.push({ epochMs: result.epochMs, instant: result.instant, labels: [sourceName(result, index)] });
  });
  grouped.sort((a, b) => a.epochMs - b.epochMs);
  const displayedInstants = [...grouped.map(item => item.instant), ...(analysis.planningInstant ? [analysis.planningInstant] : [])];
  const showDates = new Set(displayedInstants.map(instant => dateParts(instant, state.case.localZone).day)).size > 1;
  const timelineDate = instant => showDates ? `<small class="timeline-date">${escape(dateParts(instant, state.case.localZone).day)}</small>` : '';
  return `<div class="timeline" role="group" aria-label="Source timeline"><div class="timeline-header"><span class="eyebrow">ON ONE TIMELINE</span><span>${escape(state.case.localZone)}</span></div><div class="timeline-track" aria-hidden="true"><div class="timeline-line"></div>${analysis.planningInstant ? '<span class="timeline-marker planning-marker" style="left:8%"></span>' : ''}${grouped.map(item => `<span class="timeline-marker source-marker" style="left:${8 + (item.epochMs - min) / span * 84}%"></span>`).join('')}</div><div class="timeline-legend">${analysis.planningInstant ? `<div><span class="legend-dot planning-legend"></span><span><strong>${escape(dateParts(analysis.planningInstant, state.case.localZone).time)}</strong>${timelineDate(analysis.planningInstant)}<small>Your planning target</small></span></div>` : ''}${grouped.map(item => `<div><span class="legend-dot"></span><span><strong>${escape(dateParts(item.instant, state.case.localZone).time)}</strong>${timelineDate(item.instant)}<small>${item.labels.map(escape).join(' + ')}</small></span></div>`).join('')}</div><p class="timeline-caption">${analysis.status === 'blocked' ? 'Only resolved sources appear here. No planning target yet.' : 'Relative spacing shows time between instants. Full dates appear in each source below.'}</p></div>`;
}
function renderSource(source, result, index) {
  if (!result) return `<article class="source-card"><h3>${escape(source.label)}</h3><p role="alert">This source could not be analyzed.</p><button class="button button-outline" data-action="edit-source" data-id="${escape(source.id)}" data-edit="${escape(source.id)}">Edit source</button></article>`;
  const link = safeURL(source.url);
  const resolved = result.status === 'resolved';
  const resolution = source.resolution || {};
  const hasResolution = Object.keys(resolution).some(key => resolution[key]);
  return `<article class="source-card ${resolved ? 'source-resolved' : 'source-unresolved'}" aria-labelledby="source-title-${escape(source.id)}"><div class="source-header"><div class="source-index">${String(index + 1).padStart(2, '0')}</div><div class="source-heading"><h3 id="source-title-${escape(source.id)}">${escape(source.label)}</h3><span class="source-origin">${link ? `<a href="${escape(link)}" target="_blank" rel="noopener noreferrer">${escape(new URL(link).hostname)} ${icon('external')}<span class="sr-only"> (opens in a new tab)</span></a>` : source.url ? 'Source URL is not a valid HTTP or HTTPS link' : 'No source link provided'}</span></div><span class="source-status ${resolved ? 'is-resolved' : 'is-unresolved'}">${icon(resolved ? 'check' : 'warning')}${resolved ? 'Resolved' : result.status === 'invalid' ? 'Invalid input' : 'Needs clarity'}</span><button class="icon-button source-edit" data-action="edit-source" data-id="${escape(source.id)}" data-edit="${escape(source.id)}" aria-label="Edit ${escape(source.label)}" title="Edit source">${icon('edit')}</button></div><div class="quote-section"><span class="micro-label">ORIGINAL WORDING · PRESERVED AS ENTERED</span><blockquote>${escape(source.quote || 'No quote entered.')}</blockquote></div><div class="source-facts"><div><span class="micro-label">ENTERED SOURCE TIME</span><strong>${escape(source.date)} <span>${escape(source.time)}</span></strong><small>${escape(source.zone || 'No time zone stated')}${source.weekday ? ` · ${escape(source.weekday)} stated` : ''}</small></div><div><span class="micro-label">${resolved ? 'IN YOUR DISPLAY ZONE' : 'INTERPRETATION'}</span><strong class="${resolved ? '' : 'unresolved-text'}">${resolved ? escape(dateParts(result.instant, state.case.localZone).day) + ' <span>' + escape(dateParts(result.instant, state.case.localZone).time) + '</span>' : 'No single instant yet'}</strong><small>${resolved ? escape(state.case.localZone) : 'See the issue below'}</small></div></div>${resolved ? `<div class="utc-line"><span>UTC</span><time datetime="${escape(result.instant)}">${escape(result.instant)}</time>${result.offset ? `<span class="offset-label">Source offset ${escape(result.offset)}</span>` : ''}</div>` : ''}${result.issues?.length ? `<div class="source-issues">${result.issues.map(issue => `<p class="issue-${issue.severity === 'info' ? 'info' : 'error'}">${icon(issue.severity === 'info' ? 'check' : 'warning')}<span>${escape(issue.message)}</span></p>`).join('')}</div>` : ''}${hasResolution ? `<div class="resolution-note">${icon('check')}<div><strong>User clarification</strong><p>${resolution.zone ? `Zone clarified as ${escape(resolution.zone)}. ` : ''}${resolution.fold ? `${resolution.fold === 'earlier' ? 'Earlier' : 'Later'} occurrence selected. ` : ''}${resolution.weekday === 'date' ? 'Calendar date explicitly kept over the stated weekday. ' : ''}${resolution.note ? escape(resolution.note) : ''}</p><small>The original source fields are unchanged.</small></div></div>` : ''}<div class="source-actions"><span>${result.issues?.some(issue => issue.code === 'dst-gap') ? 'A missing clock time needs a corrected source.' : 'Clarifications are your decisions, not source verification.'}</span><button class="button button-small button-outline" data-resolve="${escape(source.id)}">${hasResolution ? 'Review clarification' : 'Clarify source'} ${icon('arrow')}</button></div></article>`;
}

const dismissHandlers = new WeakMap();
function requestDialogClose(dialog = dialogs.querySelector('dialog')) {
  if (!dialog) return;
  const handler = dismissHandlers.get(dialog);
  if (handler) handler(); else dialog.close();
}
function protectDialogDraft(dialog, form, savedValues = null) {
  const snapshot = () => JSON.stringify([...new FormData(form)]);
  const baseline = savedValues ? JSON.stringify([...new FormData(form)].map(([name, value]) => [name, savedValues[name] ?? ''])) : snapshot();
  let prompt = null, field = form.querySelector('input, textarea, select');
  form.addEventListener('focusin', event => { if (event.target.matches('input, textarea, select')) field = event.target; });
  const keep = () => {
    prompt?.remove(); prompt = null;
    form.hidden = false; form.inert = false;
    dialog.setAttribute('aria-labelledby', 'dialog-title');
    field?.focus();
  };
  dismissHandlers.set(dialog, () => {
    if (prompt) return keep();
    // Native date/time segments can contain edits while their submitted value is empty.
    const incompleteNativeInput = [...form.querySelectorAll('input[type="date"], input[type="time"]')].some(input => input.validity.badInput);
    if (!incompleteNativeInput && snapshot() === baseline) return dialog.close();
    form.hidden = true; form.inert = true;
    prompt = document.createElement('section');
    prompt.className = 'draft-discard-prompt';
    prompt.innerHTML = `<p class="eyebrow">UNSAVED EDITS</p><h2 id="discard-title">Discard unsaved edits?</h2><p class="dialog-description">Your edits have not been saved or applied to the comparison. Keep editing to finish, or discard them to return to the saved case.</p><div class="dialog-footer"><button type="button" class="button button-outline" id="keep-editing">Keep editing</button><button type="button" class="button button-danger" id="discard-edits">Discard changes</button></div>`;
    dialog.append(prompt); dialog.setAttribute('aria-labelledby', 'discard-title');
    prompt.querySelector('#keep-editing').addEventListener('click', keep);
    prompt.querySelector('#discard-edits').addEventListener('click', () => dialog.close());
    prompt.querySelector('#keep-editing').focus();
  });
}
function openDialog(html, initialFocus) {
  const previousFocus = document.activeElement;
  dialogs.innerHTML = `<dialog class="dialog">${html}</dialog>`;
  const dialog = dialogs.querySelector('dialog');
  dialog.addEventListener('close', () => {
    if (!dialogs.contains(dialog)) return;
    dialog.remove();
    if (document.activeElement === document.body || document.activeElement === dialog) {
      if (previousFocus?.isConnected) previousFocus.focus();
      else document.querySelector('#add-source')?.focus();
    }
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) requestDialogClose(dialog); } });
  dialog.addEventListener('cancel', event => { event.preventDefault(); requestDialogClose(dialog); });
  dialog.addEventListener('keydown', event => {
    // Handle Escape before native CloseWatcher can force a repeated dismissal.
    if (event.key === 'Escape' && !event.defaultPrevented && dialog.open && !event.altKey && !event.ctrlKey && !event.metaKey) { event.preventDefault(); requestDialogClose(dialog); return; }
    if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !dialog.open) return;
    // Keep the app's tab cycle inside the modal; leave native interior controls alone.
    const tabbable = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]')].filter(element =>
      element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[hidden], [inert]') &&
      element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible');
    const first = tabbable[0], last = tabbable.at(-1), active = document.activeElement;
    if (!first) {
      event.preventDefault();
      dialog.focus();
    } else if ((!event.shiftKey && active === last) || (event.shiftKey && active === first) || active === dialog || !dialog.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  });
  dialog.showModal();
  (initialFocus ? dialog.querySelector(initialFocus) : dialog.querySelector('input,button'))?.focus();
  return dialog;
}
function closeDialog() { dialogs.querySelector('dialog')?.close(); }
function dialogHeader(eyebrow, title, description) {
  return `<div class="dialog-header"><div><p class="eyebrow">${eyebrow}</p><h2 id="dialog-title">${title}</h2></div><button class="icon-button" type="button" data-action="close" aria-label="Close dialog">${icon('close')}</button></div><p class="dialog-description" id="dialog-description">${description}</p>`;
}
function sourceDialog(id, draftValues = null) {
  const existing = state.case.sources.find(s => s.id === id);
  if (!existing && state.case.sources.length >= 100) {
    announce('The 100-source limit has been reached. Remove a source before adding another.');
    document.querySelector('#source-limit')?.focus();
    return;
  }
  const source = draftValues ? { ...existing, ...draftValues } : existing || { label: '', url: '', quote: '', date: '', time: '', zone: '', weekday: '' };
  const dialog = openDialog(`<form id="source-form" aria-labelledby="dialog-title" aria-describedby="dialog-description">${dialogHeader(existing ? 'EDIT THE EVIDENCE' : 'ADD TO YOUR CASE', existing ? 'Edit source statement' : 'Add a source statement', 'Copy the wording exactly, then enter its date, time, and zone yourself. Quotes and links are never automatically parsed or verified.')}<div class="form-grid"><div class="form-field"><label for="source-label">Source label <span>required</span></label><input id="source-label" name="label" required maxlength="100" placeholder="e.g. Competition rules" value="${escape(source.label)}"></div><div class="form-field"><label for="source-url">Source URL <span>optional</span></label><input id="source-url" name="url" type="url" maxlength="2000" placeholder="https://…" value="${escape(source.url)}"></div><div class="form-field span-two"><label for="source-quote">Original wording <span>required</span></label><textarea id="source-quote" name="quote" required rows="3" maxlength="10000" placeholder="Paste the exact deadline statement…">${escape(source.quote)}</textarea></div><div class="form-field"><label for="source-date">Stated calendar date <span>required</span></label><input id="source-date" name="date" type="date" min="0001-01-01" max="9999-12-31" required value="${escape(source.date)}"></div><div class="form-field"><label for="source-time">Stated clock time <span>required</span></label><input id="source-time" name="time" type="time" required value="${escape(source.time)}"></div><div class="form-field"><label for="source-zone">Stated time zone <span>if given</span></label><input id="source-zone" name="zone" list="zone-options" maxlength="100" placeholder="e.g. America/Los_Angeles" value="${escape(source.zone)}" aria-describedby="source-zone-hint"><p class="field-hint" id="source-zone-hint">IANA zone, UTC, or ±HH:MM. Leave blank if the source is silent.</p></div><div class="form-field"><label for="source-weekday">Stated weekday <span>optional</span></label><select id="source-weekday" name="weekday"><option value="">Not stated</option>${weekdays.map(day => `<option ${source.weekday === day ? 'selected' : ''}>${day}</option>`).join('')}</select><p class="field-hint">Only choose one if the source names a day.</p></div></div>${existing && Object.values(existing.resolution || {}).some(Boolean) ? '<p class="edit-warning">Saving an edit clears previous clarifications so they can be reviewed against the new statement.</p>' : ''}<p class="field-error" id="source-error" role="alert"></p><div class="dialog-footer">${existing ? `<button class="text-button delete-button" type="button" data-delete="${escape(existing.id)}">Remove source</button>` : '<span class="dialog-private">Stored only in this browser</span>'}<div><button class="button button-outline" type="button" data-action="close">Cancel</button><button class="button button-dark" type="submit">${existing ? 'Save source' : 'Add source'} ${icon('arrow')}</button></div></div></form>`, '#source-label');
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  dialog.id = 'source-dialog';
  protectDialogDraft(dialog, dialog.querySelector('form'), draftValues ? existing : null);
  dialog.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    if (data.url && !safeURL(data.url)) { form.querySelector('#source-error').textContent = 'Use a complete http:// or https:// source URL, or leave the field blank.'; form.querySelector('#source-url').focus(); return; }
    if (!data.label.trim() || !data.quote.trim()) { form.querySelector('#source-error').textContent = 'Add a source label and its original wording.'; return; }
    if (!existing && state.case.sources.length >= 100) { form.querySelector('#source-error').textContent = 'The 100-source limit has been reached. Remove a source before adding another.'; return; }
    const newSource = { ...data, id: existing?.id || `source-${crypto.randomUUID?.() || Date.now().toString(36)}`, label: data.label.trim(), resolution: {} };
    if (existing) state.case.sources = state.case.sources.map(s => s.id === existing.id ? newSource : s);
    else state.case.sources.push(newSource);
    closeDialog(); update(existing ? 'Source updated. Previous clarifications were cleared.' : 'Source added. Comparison updated.');
  });
}
function clarificationDialog(id) {
  const source = state.case.sources.find(s => s.id === id);
  if (!source) return;
  const result = analyzeSource(source, state.case.localZone);
  const rawResult = analyzeSource({ ...source, resolution: { ...source.resolution, fold: undefined, weekday: undefined } }, state.case.localZone);
  const resolution = source.resolution || {};
  const candidates = rawResult.candidates || result.candidates || [];
  const isFold = candidates.length > 1 || result.issues.some(i => i.code === 'dst-fold');
  const isWeekday = !!source.weekday && (resolution.weekday || rawResult.issues.some(i => i.code === 'weekday-conflict'));
  const dialog = openDialog(`<form id="resolution-form" aria-labelledby="dialog-title">${dialogHeader('MAKE THE ASSUMPTION VISIBLE', 'Clarify this source', 'Use information you have confirmed separately. Your original source wording, date, time, and zone will stay unchanged.')}<div class="clarification-source"><strong>${escape(source.label)}</strong><p>${escape(source.date)} · ${escape(source.time)} · ${escape(source.zone || 'No zone stated')}</p></div><div class="form-field"><label for="resolution-zone">Clarified time zone <span>optional</span></label><input id="resolution-zone" name="zone" list="zone-options" maxlength="100" value="${escape(resolution.zone || '')}" placeholder="e.g. America/New_York"><p class="field-hint">Leave blank to keep the source’s stated zone. Use a complete IANA zone, UTC, or ±HH:MM.</p></div>${isFold ? `<fieldset class="choice-fieldset"><legend>Which occurrence was intended?</legend><p>This clock time occurs twice. Choose only if you have clarified which one applies.</p><label class="radio-choice"><input type="radio" name="fold" value="" ${!resolution.fold ? 'checked' : ''}><span>Leave unresolved</span></label>${['earlier', 'later'].map((value, i) => `<label class="radio-choice"><input type="radio" name="fold" value="${value}" ${resolution.fold === value ? 'checked' : ''}><span>${value === 'earlier' ? 'Earlier' : 'Later'} occurrence${candidates[i] ? `<small>${escape(candidates[i].instant)} · offset ${escape(candidates[i].offset)}</small>` : ''}</span></label>`).join('')}</fieldset>` : ''}${isWeekday ? `<fieldset class="choice-fieldset"><legend>Calendar date and weekday disagree</legend><label class="radio-choice"><input type="checkbox" name="weekday" value="date" ${resolution.weekday === 'date' ? 'checked' : ''}><span>I explicitly choose the entered calendar date over “${escape(source.weekday)}”.<small>The discrepancy remains visible in the source.</small></span></label></fieldset>` : ''}<p class="zone-change-notice" id="zone-change-notice" role="status" hidden>Save this zone clarification first, then reopen the source to review occurrence or weekday choices for the new zone. Previous choices are cleared.</p><div class="form-field clarification-note"><label for="resolution-note">Clarification note <span>required when applying a decision</span></label><textarea id="resolution-note" name="note" rows="3" maxlength="2000" placeholder="What did you confirm, and with whom?">${escape(resolution.note || '')}</textarea><p class="field-hint">This is your note, not independent verification by Cutoff.</p></div><p class="field-error" id="resolution-error" role="alert"></p><div class="dialog-footer"><span></span><div><button class="button button-outline" type="button" data-action="close">Cancel</button><button class="button button-dark" type="submit">Save clarification ${icon('arrow')}</button></div></div></form>`, '#resolution-zone');
  dialog.setAttribute('aria-labelledby', 'dialog-title'); dialog.id = 'resolution-dialog';
  protectDialogDraft(dialog, dialog.querySelector('form'));
  const zoneInput = dialog.querySelector('#resolution-zone');
  zoneInput.addEventListener('input', () => {
    const changed = zoneInput.value.trim() !== (resolution.zone || '').trim();
    for (const fieldset of dialog.querySelectorAll('.choice-fieldset')) {
      fieldset.disabled = changed;
      if (changed) for (const input of fieldset.querySelectorAll('input')) input.checked = input.type === 'radio' && input.value === '';
    }
    dialog.querySelector('#zone-change-notice').hidden = !changed;
    dialog.querySelector('button[type="submit"]').textContent = changed ? 'Save zone clarification' : 'Save clarification';
  });
  dialog.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const zone = (data.zone || '').trim();
    const note = (data.note || '').trim();
    const error = dialog.querySelector('#resolution-error');
    if (zone && !validZone(zone)) { error.textContent = 'Enter a valid IANA time zone, UTC, or fixed offset such as +05:30.'; dialog.querySelector('#resolution-zone').focus(); return; }
    if ((zone || data.fold || data.weekday) && !note) { error.textContent = 'Add a note explaining the clarification before applying it.'; dialog.querySelector('#resolution-note').focus(); return; }
    source.resolution = { ...(zone ? { zone } : {}), ...(data.fold ? { fold: data.fold } : {}), ...(data.weekday ? { weekday: 'date' } : {}), ...(note ? { note } : {}) };
    closeDialog(); update('Clarification saved. Original source fields are unchanged.');
  });
}
function confirmDialog({ title, description, actionLabel, action, destructive = false, onCancel = null }) {
  let confirmed = false;
  const dialog = openDialog(`${dialogHeader('BEFORE YOU CONTINUE', escape(title), escape(description))}<div class="dialog-footer"><span></span><div><button class="button button-outline" data-action="close" id="confirm-cancel">Cancel</button><button class="button ${destructive ? 'button-danger' : 'button-dark'}" id="confirm-action">${escape(actionLabel)}</button></div></div>`, '#confirm-cancel');
  dialog.classList.add('dialog-compact'); dialog.setAttribute('aria-labelledby', 'dialog-title'); dialog.id = 'reset-dialog';
  dialog.addEventListener('close', () => { if (!confirmed && onCancel) onCancel(); });
  dialog.querySelector('#confirm-action').addEventListener('click', () => { confirmed = true; closeDialog(); action(); });
}
function backupDialog() {
  const dialog = openDialog(`${dialogHeader('KEEP YOUR WORK', 'Backup & restore', 'Save a portable copy even when deadlines disagree or remain unresolved. Everything is processed in this browser; Cutoff does not upload it.')}<section class="backup-section"><h3>Save this workspace</h3><p>The JSON file includes source quotes, links and clarification notes. Keep it private. It contains applied settings only—not unapplied settings or unsaved dialog edits. Browser storage itself is not a backup.</p><button class="button button-outline" id="download-backup">${icon('download')} Download JSON backup</button><p id="backup-download-status" role="status"></p></section><section class="backup-section"><h3>Restore a saved copy</h3><label class="field-label" for="backup-json">Paste the contents of a Cutoff JSON backup</label><textarea id="backup-json" rows="6" maxlength="2000000" spellcheck="false" aria-describedby="backup-limit"></textarea><p class="field-hint" id="backup-limit">Open your downloaded .json file as text and paste it here. Maximum 2 MB / 100 sources. A review comes before replacement.</p><p class="field-error" id="backup-error" role="alert"></p><button class="button button-outline" id="review-backup">Review pasted backup</button><div id="backup-preview" hidden tabindex="-1"></div></section><div class="dialog-footer"><span></span><button class="button button-outline" data-action="close">Cancel</button></div>`, '#download-backup');
  dialog.id = 'backup-dialog'; dialog.setAttribute('aria-labelledby', 'dialog-title');
  let reviewed = null;
  dialog.querySelector('#download-backup').addEventListener('click', () => {
    try {
      const text = createBackup(state);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'cutoff-workspace.json';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      dialog.querySelector('#backup-download-status').textContent = 'Download requested. Check that the JSON file was saved; keep it somewhere you can recover.';
    } catch (error) { dialog.querySelector('#backup-error').textContent = error.message; }
  });
  const input = dialog.querySelector('#backup-json'), preview = dialog.querySelector('#backup-preview');
  input.addEventListener('input', () => { reviewed = null; preview.hidden = true; preview.innerHTML = ''; dialog.querySelector('#backup-error').textContent = ''; });
  dialog.querySelector('#review-backup').addEventListener('click', () => {
    try {
      reviewed = readBackup(input.value);
      const result = analyzeCase(reviewed.workspace.case);
      const labels = { empty: 'Empty case', blocked: 'Unresolved — calendar export locked', conflict: 'Conflicting deadlines — calendar export locked', agreement: 'Entered instants agree — not independently verified' };
      preview.innerHTML = `<h3>Review before replacing</h3><p><strong>${escape(reviewed.workspace.case.title || 'Untitled case')}</strong> · ${reviewed.workspace.case.sources.length} sources</p><p>Backup created ${escape(reviewed.createdAt)}. This timestamp is not source verification.</p><p>${escape(labels[result.status] || 'Check sources')}</p><p>Display zone: ${escape(reviewed.workspace.case.localZone)} · buffer: ${reviewed.workspace.case.bufferMinutes} minutes.</p><p>This replaces the current workspace and discards unapplied settings. Source facts and clarifications are preserved as entered and recalculated, not verified. Undo is available until the next edit. If browser storage is unavailable or changed elsewhere, the restored copy stays in this tab only.</p><button class="button button-dark" id="confirm-restore">Replace with this backup</button>`;
      preview.hidden = false; dialog.querySelector('#backup-error').textContent = ''; preview.focus();
      preview.querySelector('#confirm-restore').addEventListener('click', () => {
        if (!reviewed) return;
        restoreUndo = { state: clone(state), settingsDraft: settingsDraft ? clone(settingsDraft) : null };
        state = clone(reviewed.workspace); state.modified = true; settingsDraft = null;
        closeDialog(); persist(); render(); announce(storageError ? 'Backup restored in this tab only. Browser storage was not overwritten. Download a backup before closing.' : 'Backup restored and comparison recalculated. Undo restore is available.');
        document.querySelector('#undo-restore')?.focus();
      });
    } catch (error) { reviewed = null; preview.hidden = true; preview.innerHTML = ''; dialog.querySelector('#backup-error').textContent = error.message; input.focus(); }
  });
}
function validZone(value) {
  try { normalizeZone(value); return true; } catch { return false; }
}
function loadExample(id) {
  const example = examples.find(e => e.id === id);
  if (!example) return;
  const action = () => { restoreUndo = null; settingsDraft = null; state = { version: 1, exampleId: id, modified: false, case: clone(example.case) }; persist(); render(); announce(`${example.name} example loaded.`); document.querySelector('#verdict-title')?.focus({ preventScroll: true }); document.querySelector('#verdict-title')?.scrollIntoView({ block: 'nearest' }); };
  if (settingsDraft || state.modified) confirmDialog({ title: 'Replace this case with an example?', description: 'Your current case title, source statements, clarifications, and settings will be replaced in this browser. This cannot be undone.', actionLabel: 'Load example', action });
  else action();
}
document.addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.example) return loadExample(target.dataset.example);
  if (target.dataset.edit) return sourceDialog(target.dataset.edit);
  if (target.dataset.resolve) return clarificationDialog(target.dataset.resolve);
  if (target.dataset.delete) {
    const id = target.dataset.delete;
    const form = dialogs.querySelector('#source-form');
    const incomplete = [...form.querySelectorAll('input[type="date"], input[type="time"]')].find(input => input.validity.badInput);
    if (incomplete) {
      form.querySelector('#source-error').textContent = 'Finish or clear the partially entered date or time before opening removal confirmation. Your edits are still here.';
      incomplete.focus();
      return;
    }
    const draftValues = Object.fromEntries(new FormData(form));
    closeDialog();
    return confirmDialog({ title: 'Remove this source?', description: 'The source statement and its clarification will be removed from this browser’s case. This cannot be undone.', actionLabel: 'Remove source', destructive: true, onCancel: () => sourceDialog(id, draftValues), action: () => { state.case.sources = state.case.sources.filter(s => s.id !== id); update('Source removed. Comparison updated.'); } });
  }
  if (target.dataset.action === 'backup') return backupDialog();
  if (target.dataset.action === 'undo-restore' && restoreUndo) {
    const previous = restoreUndo; restoreUndo = null; state = previous.state; settingsDraft = previous.settingsDraft;
    persist(); render(); announce(storageError ? 'Previous workspace and unapplied settings restored in this tab only. Browser storage was not overwritten; download a backup before closing.' : 'Previous workspace and unapplied settings restored.'); document.querySelector('#backup-button')?.focus(); return;
  }
  if (target.dataset.action === 'close') requestDialogClose();
  if (target.dataset.action === 'add') sourceDialog();
  if (target.dataset.action === 'reset') confirmDialog({ title: 'Start with a clean slate?', description: 'This replaces the workspace saved in this browser, including changes from another tab, with an empty case. Your current source statements, clarifications, and unapplied settings will be removed. This cannot be undone.', actionLabel: 'Start fresh', destructive: true, action: () => {
    restoreUndo = null; settingsDraft = null;
    state = { version: 1, exampleId: null, modified: false, case: { title: '', localZone: state.case.localZone || 'UTC', bufferMinutes: 60, sources: [] } };
    persist({ replaceExisting: true }); render(); announce('Workspace cleared. Add your first source when you’re ready.'); document.querySelector('#workspace-title')?.focus();
  } });
  if (target.dataset.action === 'export') {
    if (!getAnalysis().canExport) return;
    try {
      const calendar = exportCalendar(state.case);
      const url = URL.createObjectURL(new Blob([calendar], { type: 'text/calendar;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `${(state.case.title || 'cutoff-plan').replace(/[^\p{L}\p{N}-]+/gu, '-').slice(0, 80)}.ics`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      announce('Calendar file downloaded. It contains your planning target before the agreed deadline.');
    } catch (error) { announce('Calendar export failed. Check that all sources resolve to one instant.'); target.insertAdjacentHTML('afterend', '<p role="alert" class="field-error">Export failed. Review the source details and try again.</p>'); }
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'workspace-title') { restoreUndo = null; document.querySelector('.backup-receipt')?.remove(); }
  if (!['display-zone', 'buffer-minutes'].includes(event.target.id)) return;
  restoreUndo = null; document.querySelector('.backup-receipt')?.remove();
  const form = document.querySelector('#settings-form');
  const localZone = form.elements.localZone.value;
  const bufferMinutes = form.elements.bufferMinutes.value;
  settingsDraft = localZone === state.case.localZone && bufferMinutes === String(state.case.bufferMinutes) ? null : { localZone, bufferMinutes };
  document.querySelector('#settings-draft-status').textContent = settingsDraft ? settingsDraftMessage() : '';
});
document.addEventListener('change', event => {
  if (event.target.id === 'workspace-title') { restoreUndo = null; document.querySelector('.backup-receipt')?.remove(); state.case.title = event.target.value.trim(); state.modified = true; persist(); if (storageError) render(); }
});
document.addEventListener('submit', event => {
  if (event.target.id !== 'settings-form') return;
  event.preventDefault();
  const form = event.target;
  const zone = form.elements.localZone.value.trim();
  // Text input preserves incomplete drafts (for example "1e") through rerenders.
  const rawBuffer = form.elements.bufferMinutes.value;
  const buffer = Number(rawBuffer);
  const error = form.querySelector('#settings-error');
  if (!validZone(zone)) { error.textContent = 'Use a valid IANA zone, UTC, or ±HH:MM.'; form.elements.localZone.focus(); return; }
  if (!/^\d+$/.test(rawBuffer) || !Number.isInteger(buffer) || buffer < 0 || buffer > 10080) { error.textContent = 'Enter a whole-number buffer from 0 to 10,080 minutes.'; form.elements.bufferMinutes.focus(); return; }
  settingsDraft = null;
  state.case.localZone = zone; state.case.bufferMinutes = buffer; update('Display zone and planning buffer updated.', 'display-zone');
});
render();



