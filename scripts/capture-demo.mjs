// Isolated own-project CI capture; never attach to a desktop/user browser.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assertResolvedFoldCalendarExport } from '../tests/calendar-export-assertions.js';

const source = '75892892b0045692e1c966cef792393943bd0279';
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'This capture runs only in the reviewed GitHub Actions job');
assert.equal(process.platform, 'linux', 'Use the isolated Linux runner, not the user desktop');
// The harness may change; the recorded application and locked dependencies may not.
execFileSync('git', ['diff', '--exit-code', source, '--', 'src', 'public', 'index.html',
  'package.json', 'package-lock.json', 'scripts/build.mjs', 'scripts/serve.mjs',
  'tests/calendar-export-assertions.js'], { stdio: 'inherit' });
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const output = resolve('evidence/cutoff-recording');
await mkdir(output, { recursive: false }); // Never overwrite an earlier take.
const size = { width: 1440, height: 1000 };
const port = 4391, origin = `http://127.0.0.1:${port}`;
const started = Date.now();
const events = [], pageErrors = [], externalRequests = [], serverErrors = [];
let server, browser, context, video, failure;
const record = (name, details = {}) => events.push({ atMs: Date.now() - started, name, ...details });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const check = async (name, action) => {
  record(name, { status: 'started' });
  await action();
  record(name, { status: 'passed' });
};
// These are deliberate real-time reading pauses, not simulated footage or edits.
const dwell = async seconds => { record('reading pause', { seconds }); await delay(seconds * 1000); };
try {
  server = spawn(process.execPath, ['scripts/serve.mjs'], {
    env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', data => serverErrors.push(String(data)));
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Loopback server did not become ready')), 10000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
    server.stdout.on('data', data => {
      if (String(data).includes(origin)) { clearTimeout(timer); done(); }
    });
  });
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: size, recordVideo: { dir: output, size }, acceptDownloads: true,
    serviceWorkers: 'block', permissions: [], locale: 'en-US', timezoneId: 'UTC',
  });
  // A fresh context has no user's cookies, local storage, accounts or extensions.
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (new URL(url).origin === origin) await route.continue();
    else { externalRequests.push(url); await route.abort('blockedbyclient'); }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => pageErrors.push(error.message));
  video = page.video();
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Make time make sense.' }).waitFor();
  record('app loaded', { appSource: source, viewport: size });
  const load = async id => {
    await page.locator(`[data-example="${id}"]`).click();
    if (await page.locator('#confirm-action').isVisible()) await page.locator('#confirm-action').click();
    await page.locator('#workspace-title').scrollIntoViewIfNeeded();
  };
  const exported = page.locator('#export-calendar');
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('cutoff.workspace.v1')));

  await check('conflict example and locked export', async () => {
    await load('disagreement');
    assert.equal((await saved()).case.sources.length, 2);
    assert.equal(await exported.isDisabled(), true);
    assert.equal(await page.locator('.planning-card').count(), 1);
  });
  await dwell(15);
  await page.locator('.source-card').first().scrollIntoViewIfNeeded();
  await check('conflicting exact instants remain visible', async () => {
    const utc = await page.locator('.utc-line').allTextContents();
    assert.ok(utc.some(text => text.includes('2026-10-31T06:00:00Z')));
    assert.ok(utc.some(text => text.includes('2026-10-31T06:59:00Z')));
  });
  await dwell(15);
  await exported.scrollIntoViewIfNeeded();
  await dwell(10);

  await check('repeated hour starts unresolved', async () => {
    await load('fold');
    assert.equal(await page.locator('.planning-card').count(), 0);
    assert.equal(await exported.isDisabled(), true);
    await page.locator('[data-resolve]').click();
    const dialog = await page.locator('#resolution-form').innerText();
    assert.match(dialog, /2026-11-01T05:30:00Z/);
    assert.match(dialog, /2026-11-01T06:30:00Z/);
    assert.equal(await page.locator('[name="fold"][value=""]').isChecked(), true);
  });
  await dwell(20);
  const originalQuote = await page.locator('blockquote').textContent();
  await check('explicit synthetic clarification requires a note', async () => {
    await page.locator('[name="fold"][value="later"]').check();
    await page.locator('#resolution-form button[type="submit"]').click();
    assert.match(await page.locator('#resolution-error').textContent(), /note/i);
  });
  await dwell(5);
  await page.locator('#resolution-note').fill('Synthetic demonstration only: assume later occurrence was confirmed separately. No real organizer confirmation occurred.');
  await dwell(10);
  await check('save clarification without rewriting evidence', async () => {
    await page.locator('#resolution-form button[type="submit"]').click();
    assert.equal(await page.locator('blockquote').textContent(), originalQuote);
    const item = (await saved()).case.sources[0];
    assert.equal(item.time, '01:30');
    assert.equal(item.zone, 'America/New_York');
    assert.equal(item.resolution.fold, 'later');
    assert.equal(await exported.isEnabled(), true);
    await page.locator('.resolution-note').scrollIntoViewIfNeeded();
  });
  await dwell(15);
  await check('real clarified-hour calendar download', async () => {
    const pending = page.waitForEvent('download');
    await exported.click();
    const download = await pending;
    const bytes = await readFile(await download.path());
    assertResolvedFoldCalendarExport(bytes);
    await writeFile(`${output}/clarified-hour.ics`, bytes);
    record('clarified-hour.ics retained', { bytes: bytes.length, sha256: sha256(bytes) });
  });
  await dwell(5);

  await check('agreement unlocks export with both original sources', async () => {
    await load('agreement');
    assert.equal(await exported.isEnabled(), true);
    const utc = await page.locator('.utc-line').allTextContents();
    assert.equal(utc.length, 2);
    assert.ok(utc.every(text => text.includes('2026-10-31T06:59:00Z')));
  });
  await dwell(15);
  await page.locator('.source-card').first().scrollIntoViewIfNeeded();
  await dwell(10);
  await check('real agreement download has safe planning semantics', async () => {
    const pending = page.waitForEvent('download');
    await exported.click();
    const download = await pending;
    const bytes = await readFile(await download.path());
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n[ \t]/g, '');
    for (const line of ['DTSTART:20261031T055900Z', 'DTEND:20261031T060000Z', 'STATUS:TENTATIVE', 'TRANSP:TRANSPARENT']) assert.ok(text.includes(`\r\n${line}\r\n`), line);
    assert.ok(!text.includes('BEGIN:VALARM'));
    assert.ok(text.includes('Original statement:'));
    await writeFile(`${output}/agreement.ics`, bytes);
    record('agreement.ics retained', { bytes: bytes.length, sha256: sha256(bytes) });
  });
  await dwell(10);
  await page.locator('footer').scrollIntoViewIfNeeded();
  await dwell(10);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(serverErrors, []);
  record('capture assertions complete');
} catch (error) {
  failure = String(error.stack || error);
  record('capture failed', { error: failure });
} finally {
  try {
    if (context) await context.close(); // Finalizes the original continuous video.
    if (video) {
      const path = await video.path();
      await rename(path, `${output}/raw-browser.webm`);
      record('raw video finalized', { sha256: sha256(await readFile(`${output}/raw-browser.webm`)) });
    }
  } catch (error) { failure ||= String(error.stack || error); }
  await browser?.close();
  server?.kill('SIGTERM');
  await writeFile(`${output}/assertions.json`, JSON.stringify({
    status: failure ? 'failed' : 'passed', failure: failure || null,
    appSource: source, harnessCommit: revision, playwright: '1.56.1', viewport: size,
    origin, format: 'Continuous Playwright viewport recording of real UI interactions; no montage, overlays, microphone or desktop capture',
    isolatedSyntheticContext: true, pageErrors, externalRequests, serverErrors, events,
  }, null, 2) + '\n');
}
if (failure) throw new Error(failure);
