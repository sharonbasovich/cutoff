/**
 * Interface source-contract checks. These execute actual app helper/render/storage
 * code in Node vm with explicit document/storage stubs. They DO NOT run a
 * browser, parse HTML, validate native forms, or prove accessibility. The CSS
 * regression checks literal colors, not computed styles or the rendered cascade.
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
  return { sandbox, writes, listeners, nodes, evaluate: text => vm.runInContext(text, sandbox), stored: () => stored, externalWrite: value => { stored = value; } };
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


test('interface: source-index badge colors retain at least 5:1 contrast for small text', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const badgeRule = css.match(/\.source-index\s*\{([^}]+)\}/)?.[1];
  assert.ok(badgeRule, 'The source-index base rule must exist');
  const color = property => {
    const value = badgeRule.match(new RegExp(`(?:^|;)${property}:\\s*(#[0-9a-f]{6})(?=;|$)`, 'i'))?.[1];
    assert.ok(value, `The badge ${property} must have a literal six-digit hex color`);
    return value;
  };
  const luminance = hex => {
    const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const [red, green, blue] = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const contrast = (foreground, background) => {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  assert.equal(contrast('#000000', '#ffffff'), 21);
  assert.ok(contrast('#6a775c', '#f0f2e9') < 4.5, 'The original failing pair is a negative control');
  const ratio = contrast(color('color'), color('background'));
  assert.ok(ratio >= 5, `Badge contrast ${ratio.toFixed(2)}:1 must retain margin above the 4.5:1 requirement`);
});


test('interface: modal description retains at least 5:1 contrast for normal text', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const descriptionRule = css.match(/\.dialog-description\s*\{([^}]+)\}/)?.[1];
  const dialogRule = css.match(/\.dialog\s*\{([^}]+)\}/)?.[1];
  const rootRule = css.match(/:root\s*\{([^}]+)\}/)?.[1];
  assert.ok(descriptionRule && dialogRule && rootRule, 'The modal description, dialog and root rules must exist');
  assert.match(dialogRule, /(?:^|;)background:\s*var\(--paper\)(?=;|$)/);
  const foreground = descriptionRule.match(/(?:^|;)color:\s*(#[0-9a-f]{6})(?=;|$)/i)?.[1];
  const background = rootRule.match(/(?:^|;)--paper:\s*(#[0-9a-f]{6})(?=;|$)/i)?.[1];
  assert.ok(foreground && background, 'The modal description and paper token must have literal six-digit hex colors');
  const luminance = hex => {
    const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const [red, green, blue] = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const contrast = (foreground, background) => {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  assert.equal(contrast('#000000', '#ffffff'), 21);
  assert.ok(contrast('#69755d', '#f6f5f0') < 4.5, 'The original modal description pair is a negative control');
  const ratio = contrast(foreground, background);
  assert.ok(ratio >= 5, `Modal description contrast ${ratio.toFixed(2)}:1 must retain margin above the 4.5:1 requirement`);
});


function declaredColorContrast(foreground, background) {
  const luminance = hex => {
    const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const [red, green, blue] = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('interface: source count keeps its meaningful digit visible with at least 5:1 contrast', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const rule = css.match(/\.count\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule, 'The source count base rule must exist');
  const foreground = rule.match(/(?:^|;)color:\s*(#[0-9a-f]{6})(?=;|$)/i)?.[1];
  const background = rule.match(/(?:^|;)background:\s*(#[0-9a-f]{6})(?=;|$)/i)?.[1];
  assert.ok(foreground && background, 'The source count must have literal six-digit hex colors');
  assert.equal(declaredColorContrast('#000000', '#ffffff'), 21);
  assert.ok(declaredColorContrast('#68735c', '#e7eade') < 4.5, 'The original count pair is a negative control');
  const ratio = declaredColorContrast(foreground, background);
  assert.ok(ratio >= 5, `Source count contrast ${ratio.toFixed(2)}:1 must retain margin above 4.5:1`);
  const data = stateFrom();
  const html = harness({ stored: JSON.stringify(data) }).nodes.get('#app').innerHTML;
  assert.match(html, new RegExp(`<span class="count">${data.case.sources.length}</span>`));
});

test('interface: source timeline renders as a named group', () => {
  for (const id of ['agreement', 'disagreement']) {
    const h = harness({ stored: JSON.stringify(stateFrom(id)) });
    assert.match(h.evaluate('renderTimeline()'), /^<div class="timeline" role="group" aria-label="Source timeline">/, id);
  }
  const partial = stateFrom();
  partial.case.sources[0].zone = '';
  const h = harness({ stored: JSON.stringify(partial) });
  assert.match(h.evaluate('renderTimeline()'), /^<div class="timeline" role="group" aria-label="Source timeline">/);
  assert.match(h.evaluate('renderTimeline()'), /Only resolved sources appear here/);
});

test('interface: planning separator alone is decorative and inherits readable text color', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const separatorRule = css.match(/\.planning-zone>span\s*\{([^}]+)\}/)?.[1];
  const zoneRule = css.match(/\.planning-zone\s*\{([^}]+)\}/)?.[1];
  const cardRule = css.match(/\.planning-card\s*\{([^}]+)\}/)?.[1];
  const rootRule = css.match(/:root\s*\{([^}]+)\}/)?.[1];
  assert.ok(separatorRule && zoneRule && cardRule && rootRule, 'The planning color rules must exist');
  assert.match(separatorRule, /(?:^|;)color:\s*inherit(?=;|$)/);
  assert.match(cardRule, /(?:^|;)background:\s*var\(--blue\)(?=;|$)/);
  const foreground = zoneRule.match(/(?:^|;)color:\s*(#[0-9a-f]{6})(?=;|$)/i)?.[1];
  const background = rootRule.match(/(?:^|;)--blue:\s*(#[0-9a-f]{6})(?=;|$)/i)?.[1];
  assert.ok(foreground && background, 'The planning zone and blue token must have literal six-digit hex colors');
  assert.ok(declaredColorContrast('#99b0ff', '#254bd9') < 4.5, 'The original separator pair is a negative control');
  const ratio = declaredColorContrast(foreground, background);
  assert.ok(ratio >= 5, `Planning separator contrast ${ratio.toFixed(2)}:1 must retain margin above 4.5:1`);
  for (const id of ['agreement', 'disagreement']) {
    const data = stateFrom(id);
    const h = harness({ stored: JSON.stringify(data) });
    const html = h.evaluate('renderPlanning()');
    const zone = html.match(/<div class="planning-zone">([^]*?)<\/div>/)?.[1];
    const parts = ui.dateParts(model.analyzeCase(data.case).planningInstant, data.case.localZone);
    assert.equal(zone, `${parts.weekday} <span aria-hidden="true">·</span> ${data.case.localZone}`);
  }
});

// These explicit DOM/event stubs exercise the app's real dialog handlers in Node.
// They do not simulate native browser focus order, date/time internals or Escape.
function dialogEventHarness() {
  const h = harness();
  const doc = h.sandbox.document;
  const root = h.nodes.get('#dialog-root');
  doc.body = { id: 'body' };
  const opener = { id: 'opener', isConnected: true, focus() { doc.activeElement = this; } };
  const fallback = { id: 'add-source', isConnected: true, focus() { doc.activeElement = this; } };
  h.nodes.set('#add-source', fallback);
  doc.activeElement = opener;
  h.sandbox.getComputedStyle = node => ({ visibility: node.visibility || 'visible' });
  let current;
  root.querySelector = () => current;
  root.contains = dialog => dialog === current && dialog.isConnected;
  const makeControl = (id, options = {}) => ({
    id, tabIndex: 0, isConnected: true, visibility: 'visible', ...options,
    matches(selector) { assert.equal(selector, ':disabled'); return !!this.disabled; },
    closest(selector) { assert.equal(selector, '[hidden], [inert]'); return this.hiddenAncestor || this.inert ? {} : null; },
    getClientRects() { return this.noLayout ? [] : [{}]; },
    focus() { doc.activeElement = this; },
  });
  const open = (controls, initial = controls[0]) => {
    const listeners = new Map();
    current = {
      open: false, isConnected: true, controls,
      addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler); },
      querySelectorAll() { return this.controls; },
      querySelector(selector) { return this.controls.find(node => `#${node.id}` === selector) || this.controls[0]; },
      contains(node) { return node === this || this.controls.includes(node); },
      showModal() { this.open = true; },
      focus() { doc.activeElement = this; },
      remove() { this.isConnected = false; this.controls.forEach(node => { node.isConnected = false; }); },
      close() { this.open = false; doc.activeElement = doc.body; this.dispatch('close', {}); },
      dispatch(type, event) { for (const listener of listeners.get(type) || []) listener(event); },
    };
    h.evaluate(`openDialog('Synthetic dialog fixture', ${JSON.stringify(initial ? `#${initial.id}` : null)})`);
    return current;
  };
  const press = (dialog, active, options = {}) => {
    doc.activeElement = active;
    const event = { key: 'Tab', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, defaultPrevented: false, ...options,
      preventDefault() { this.defaultPrevented = true; } };
    dialog.dispatch('keydown', event);
    return event;
  };
  return { h, doc, opener, fallback, makeControl, open, press };
}

test('interface: dialog Tab and Shift+Tab wrap only at the active boundary', () => {
  const h = dialogEventHarness();
  const first = h.makeControl('close'), middle = h.makeControl('source-date'), last = h.makeControl('submit');
  const dialog = h.open([first, middle, last], middle);
  assert.equal(h.doc.activeElement, middle, 'Explicit initial focus is retained');
  assert.equal(h.press(dialog, last).defaultPrevented, true);
  assert.equal(h.doc.activeElement, first);
  assert.equal(h.press(dialog, first, { shiftKey: true }).defaultPrevented, true);
  assert.equal(h.doc.activeElement, last);
  for (const options of [{}, { shiftKey: true }]) {
    assert.equal(h.press(dialog, middle, options).defaultPrevented, false, 'Interior native date/time traversal is untouched');
    assert.equal(h.doc.activeElement, middle);
  }
});

test('interface: dialog boundary recalculates enabled visible tabbables after changes', () => {
  const h = dialogEventHarness();
  const excluded = [h.makeControl('disabled-fieldset-child', { disabled: true }), h.makeControl('negative', { tabIndex: -1 }),
    h.makeControl('hidden', { hiddenAncestor: true }), h.makeControl('inert', { inert: true }),
    h.makeControl('no-layout', { noLayout: true }), h.makeControl('invisible', { visibility: 'hidden' })];
  const first = h.makeControl('close'), last = h.makeControl('submit');
  const dialog = h.open([...excluded, first, last, ...excluded]);
  assert.equal(h.press(dialog, last).defaultPrevented, true);
  assert.equal(h.doc.activeElement, first);
  last.disabled = true;
  assert.equal(h.press(dialog, first).defaultPrevented, true, 'A single remaining control wraps to itself');
  assert.equal(h.doc.activeElement, first);
  const newer = h.makeControl('newly-enabled'); dialog.controls.push(newer);
  assert.equal(h.press(dialog, first, { shiftKey: true }).defaultPrevented, true);
  assert.equal(h.doc.activeElement, newer);
});

test('interface: dialog key handling preserves Escape, browser shortcuts and handled events', () => {
  const h = dialogEventHarness();
  const first = h.makeControl('close'), last = h.makeControl('submit');
  const dialog = h.open([first, last]);
  for (const options of [{ key: 'Escape' }, { key: 'Enter' }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
    assert.equal(h.press(dialog, last, options).defaultPrevented, false);
    assert.equal(h.doc.activeElement, last);
  }
  h.press(dialog, last, { defaultPrevented: true });
  assert.equal(h.doc.activeElement, last);
  dialog.open = false;
  assert.equal(h.press(dialog, last).defaultPrevented, false);
});

test('interface: dialog focus fallback and close restoration remain local to each dialog', () => {
  const h = dialogEventHarness();
  const first = h.makeControl('close'), last = h.makeControl('submit');
  const dialog = h.open([first, last]);
  assert.equal(h.press(dialog, dialog).defaultPrevented, true);
  assert.equal(h.doc.activeElement, first);
  assert.equal(h.press(dialog, h.doc.body, { shiftKey: true }).defaultPrevented, true);
  assert.equal(h.doc.activeElement, last);
  dialog.close();
  assert.equal(h.doc.activeElement, h.opener);
  const second = h.open([h.makeControl('confirm-cancel'), h.makeControl('confirm-action')]);
  assert.equal(h.press(dialog, first).defaultPrevented, false, 'A closed replaced dialog cannot intercept Tab');
  const secondLast = second.controls.at(-1);
  assert.equal(h.press(second, secondLast).defaultPrevented, true);
  assert.equal(h.doc.activeElement, second.controls[0]);
  h.opener.isConnected = false;
  second.close();
  assert.equal(h.doc.activeElement, h.fallback, 'Disconnected opener uses the existing add-source fallback');
});

test('interface: empty dialog prevents Tab escape without adding tabindex to native dialog', () => {
  const h = dialogEventHarness();
  const dialog = h.open([]);
  assert.equal(h.press(dialog, dialog).defaultPrevented, true);
  assert.equal(h.doc.activeElement, dialog);
  assert.equal(Object.hasOwn(dialog, 'tabIndex'), false);
});


test('interface: save-state text retains at least 5:1 contrast on desktop and mobile backgrounds', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const rule = css.match(/\.save-state\s*\{([^}]+)\}/)?.[1];
  const rootRule = css.match(/:root\s*\{([^}]+)\}/)?.[1];
  const sidebarBackgrounds = [...css.matchAll(/\.sidebar\s*\{([^}]+)\}/g)]
    .map(match => match[1].match(/(?:^|;)background:\s*(#[0-9a-f]{6})(?=;|$)/i)?.[1]).filter(Boolean);
  assert.ok(rule && rootRule, 'The save-state and root rules must exist');
  assert.equal(sidebarBackgrounds.length, 1, 'The mobile sidebar must have one explicit background');
  const foreground = rule.match(/(?:^|;)color:\s*(#[0-9a-f]{6})(?=;|$)/i)?.[1];
  const paper = rootRule.match(/(?:^|;)--paper:\s*(#[0-9a-f]{6})(?=;|$)/i)?.[1];
  assert.ok(foreground && paper, 'The save-state and paper token must have literal six-digit hex colors');
  assert.ok(declaredColorContrast('#6a735f', '#f0f1e9') < 4.5, 'The original mobile pair is a negative control');
  for (const [name, background] of [['mobile', sidebarBackgrounds[0]], ['desktop', paper]]) {
    const ratio = declaredColorContrast(foreground, background);
    assert.ok(ratio >= 5, `Save-state ${name} contrast ${ratio.toFixed(2)}:1 must retain margin above 4.5:1`);
  }
});


test('interface: stale tabs preserve newer saved data and keep their own edits in memory', () => {
  const original = JSON.stringify(stateFrom());
  const newer = stateFrom(); newer.case.title = 'Saved by tab B';
  const h = harness({ stored: original });
  h.externalWrite(JSON.stringify(newer));
  h.evaluate('state.case.title = "Unsaved tab A edit"; persist(); render()');
  assert.equal(h.writes.length, 0);
  assert.equal(JSON.parse(h.stored()).case.title, 'Saved by tab B');
  assert.equal(h.evaluate('state.case.title'), 'Unsaved tab A edit');
  assert.match(h.nodes.get('#app').innerHTML, /changed outside this tab/);
  assert.match(h.nodes.get('#app').innerHTML, /Not saved/);
  h.evaluate('persist()');
  assert.equal(h.writes.length, 0, 'Repeated edits remain blocked');
});

test('interface: storage removal, corruption, and new data in another fresh tab block stale writes', () => {
  const original = JSON.stringify(stateFrom());
  for (const [initial, external] of [[original, null], [original, '{broken'], [null, original]]) {
    const h = harness({ stored: initial });
    h.externalWrite(external);
    h.evaluate('state.case.title = "Local edit"; persist(); render()');
    assert.equal(h.writes.length, 0);
    assert.equal(h.stored(), external);
    assert.match(h.nodes.get('#app').innerHTML, /changed outside this tab/);
  }
});

test('interface: own consecutive saves advance the snapshot without false conflicts', () => {
  for (const initial of [null, JSON.stringify(stateFrom())]) {
    const h = harness({ stored: initial });
    h.evaluate('state.case.title = "First"; persist(); state.case.title = "Second"; persist(); render()');
    assert.equal(h.writes.length, 2);
    assert.equal(JSON.parse(h.stored()).case.title, 'Second');
    assert.doesNotMatch(h.nodes.get('#app').innerHTML, /Not saved/);
  }
});

test('review: stale-save conflict preserves in-memory calendar export without replacing saved evidence', () => {
  const h = harness({ stored: JSON.stringify(stateFrom()) });
  const external = JSON.stringify({ ...stateFrom(), modified: true });
  h.externalWrite(external);
  h.evaluate('state.case.title = "Local planning evidence"; persist(); render()');
  assert.equal(h.evaluate('getAnalysis().canExport'), true);
  const calendar = h.evaluate('exportCalendar(state.case)');
  assert.match(calendar, /SUMMARY:Planning target: Local planning evidence/);
  assert.equal(h.stored(), external);
  assert.equal(h.writes.length, 0);
});

test('review: a read failure during save preserves memory and does not attempt a write', () => {
  const h = harness({ stored: JSON.stringify(stateFrom()) });
  h.sandbox.localStorage.getItem = () => { throw new Error('Storage became inaccessible'); };
  h.evaluate('state.case.title = "Retained edit"; persist(); render()');
  assert.equal(h.writes.length, 0);
  assert.equal(h.evaluate('state.case.title'), 'Retained edit');
  assert.match(h.nodes.get('#app').innerHTML, /could not save/);
});

test('review: Start fresh is explicit, cancellation preserves both cases, and confirmation resumes saves', () => {
  const h = harness({ stored: JSON.stringify(stateFrom()) });
  const external = JSON.stringify({ ...stateFrom(), modified: true });
  h.externalWrite(external);
  h.evaluate('state.case.title = "Retained local edit"; persist(); render()');
  h.evaluate('confirmDialog = options => { globalThis.pendingConfirm = options; }');
  const target = { dataset: { action: 'reset' } };
  for (const listener of h.listeners.click) listener({ target: { closest: () => target } });
  assert.match(h.sandbox.pendingConfirm.description, /including changes from another tab/);
  assert.equal(h.sandbox.pendingConfirm.destructive, true);
  assert.equal(h.stored(), external, 'Opening or cancelling the confirmation cannot reset storage');
  assert.equal(h.evaluate('state.case.title'), 'Retained local edit');
  assert.equal(h.writes.length, 0);
  h.sandbox.pendingConfirm.action();
  assert.equal(h.writes.length, 1);
  assert.equal(JSON.parse(h.stored()).case.sources.length, 0);
  assert.equal(h.evaluate('storageError'), '');
  h.evaluate('state.case.title = "New case"; persist(); render()');
  assert.equal(h.writes.length, 2);
  assert.equal(JSON.parse(h.stored()).case.title, 'New case');
});

test('review: failed explicit reset retains a visible storage warning and never claims a save', () => {
  const h = harness({ stored: JSON.stringify(stateFrom()), writeBlocked: true });
  h.evaluate('persist({ replaceExisting: true }); render()');
  assert.equal(h.writes.length, 0);
  assert.equal(h.evaluate('saved'), false);
  assert.match(h.nodes.get('#app').innerHTML, /could not save/);
  assert.match(h.nodes.get('#app').innerHTML, /Not saved/);
});
