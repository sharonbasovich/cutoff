import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertResolvedFoldCalendarExport } from './calendar-export-assertions.js';

const port=Number(process.env.TEST_PORT||4387),base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
let browser;
const results=[]; const consoleErrors=[]; const remoteRequests=[];
const check=async(name,fn)=>{await fn();results.push({name,status:'passed'});console.log(`PASS ${name}`);};
const loadExample=async(page,id)=>{
  await page.locator(`[data-example="${id}"]`).click();
  const confirm=page.locator('#confirm-action');
  if(await confirm.isVisible()) await confirm.click();
  await page.waitForTimeout(60);
};
const stored=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('cutoff.workspace.v1')));
const exportButton=page=>page.locator('[data-action="export"]');
const close=page=>page.keyboard.press('Escape');
const noOverflow=async(page)=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
const axe=async(page,name)=>{
  const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  await writeFile(`evidence/axe-${name}.json`,JSON.stringify({violations:report.violations,incomplete:report.incomplete.map(x=>({id:x.id,impact:x.impact,nodes:x.nodes.map(y=>({target:y.target,failureSummary:y.failureSummary}))}))},null,2));
  assert.deepEqual(report.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),[],`${name} accessibility violations`);
};
try {
  await mkdir('evidence',{recursive:true});
  let ready=false;for(let i=0;i<100;i++){try{const res=await fetch(base);if(res.ok){ready=true;break;}}catch{} await new Promise(r=>setTimeout(r,50));}
  assert.ok(ready,'Preview must be ready');
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
  const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce',acceptDownloads:true});
  const page=await context.newPage();page.setDefaultTimeout(4000);
  page.on('pageerror',e=>consoleErrors.push(e.message));
  page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))remoteRequests.push(r.url());});
  await page.goto(base);
  await check('synthetic conflict renders source evidence, conservative target, and export lock',async()=>{
    await page.locator('h1').waitFor();assert.equal(await page.locator('.source-card').count(),2);assert.match(await page.locator('#verdict-title').textContent(),/disagree/);
    assert.equal(await exportButton(page).isDisabled(),true);assert.equal(await page.locator('.planning-card').count(),1);await noOverflow(page);
    await page.screenshot({path:'evidence/desktop-conflict.png',fullPage:true});
  });
  await check('desktop automated accessibility',()=>axe(page,'desktop'));
  await check('fold is unresolved until explicit occurrence and explanation; raw fields preserved',async()=>{
    await loadExample(page,'fold');assert.equal(await page.locator('.planning-card').count(),0);assert.equal(await exportButton(page).isDisabled(),true);
    const quote=await page.locator('blockquote').textContent();await page.locator('[data-resolve]').click();
    await page.locator('[name="fold"][value="later"]').check();await page.locator('#resolution-form button[type="submit"]').click();assert.match(await page.locator('#resolution-error').textContent(),/note/i);
    await page.locator('#resolution-note').fill('Synthetic organizer explicitly confirmed the second occurrence.');await page.locator('#resolution-form button[type="submit"]').click();
    await page.waitForTimeout(60);assert.equal(await exportButton(page).isEnabled(),true);assert.equal(await page.locator('blockquote').textContent(),quote);
    const s=(await stored(page)).case.sources[0];assert.equal(s.time,'01:30');assert.equal(s.zone,'America/New_York');assert.equal(s.resolution.fold,'later');
    await page.screenshot({path:'evidence/desktop-fold-resolved.png',fullPage:true});
    const dl=page.waitForEvent('download');await exportButton(page).click();const d=await dl;const bytes=await readFile(await d.path());
    await writeFile('evidence/export-example.ics',bytes);assertResolvedFoldCalendarExport(bytes);
  });
  await check('saved clarification survives reload',async()=>{await page.reload();assert.equal((await stored(page)).case.sources[0].resolution.fold,'later');assert.equal(await exportButton(page).isEnabled(),true);});
  await check('edit Cancel and Escape keep state, saving resets stale clarifications',async()=>{
    const before=JSON.stringify(await stored(page));await page.locator('[data-edit]').click();await page.locator('[name="label"]').fill('Discard me');await close(page);assert.equal(JSON.stringify(await stored(page)),before);
    await page.locator('[data-edit]').click();await page.locator('[name="label"]').fill('New notice label');await page.locator('#source-form button[type="submit"]').click();await page.waitForTimeout(60);
    assert.deepEqual((await stored(page)).case.sources[0].resolution,{});assert.equal(await exportButton(page).isDisabled(),true);
  });
  await check('gap remains unresolved without a fabricated shifted instant',async()=>{
    await loadExample(page,'gap');assert.equal(await page.locator('.planning-card').count(),0);assert.match(await page.locator('.source-issues').textContent(),/never occurs|jump/i);assert.equal(await exportButton(page).isDisabled(),true);
  });
  await check('missing-zone clarification preserves missing original zone',async()=>{
    await loadExample(page,'missing-zone');await page.locator('[data-resolve]').click();await page.locator('#resolution-zone').fill('Asia/Kolkata');await page.locator('#resolution-note').fill('Synthetic source clarification: India time.');await page.locator('#resolution-form button[type="submit"]').click();await page.waitForTimeout(60);
    const s=(await stored(page)).case.sources[0];assert.equal(s.zone,'');assert.equal(s.resolution.zone,'Asia/Kolkata');assert.equal(await exportButton(page).isEnabled(),true);
  });
  await check('weekday contradiction requires separate explicit date choice',async()=>{
    await loadExample(page,'weekday');assert.equal(await exportButton(page).isDisabled(),true);await page.locator('[data-resolve]').click();await page.locator('[name="weekday"]').check();await page.locator('#resolution-note').fill('Synthetic organizer confirmed the numeric calendar date.');await page.locator('#resolution-form button[type="submit"]').click();await page.waitForTimeout(60);assert.equal(await exportButton(page).isEnabled(),true);
  });
  await check('display-zone and buffer validation preserves last valid settings',async()=>{
    const before=(await stored(page)).case;await page.locator('#display-zone').fill('CST');await page.locator('#settings-form button').click();assert.match(await page.locator('#settings-error').textContent(),/valid|IANA/);assert.equal((await stored(page)).case.localZone,before.localZone);
    await page.locator('#display-zone').fill('Asia/Tokyo');await page.locator('#settings-form [name="bufferMinutes"]').fill('-1');await page.locator('#settings-form button').click();assert.match(await page.locator('#settings-error').textContent(),/whole/);assert.equal((await stored(page)).case.bufferMinutes,before.bufferMinutes);
    await page.locator('#settings-form [name="bufferMinutes"]').fill('0');await page.locator('#settings-form button').click();assert.equal((await stored(page)).case.localZone,'Asia/Tokyo');assert.equal((await stored(page)).case.bufferMinutes,0);
  });
  await check('reset cancel and Escape preserve data; confirmation clears and persists',async()=>{
    const before=JSON.stringify(await stored(page));await page.locator('[data-action="reset"]').click();await page.locator('#confirm-cancel').click();assert.equal(JSON.stringify(await stored(page)),before);
    await page.locator('[data-action="reset"]').click();await close(page);assert.equal(JSON.stringify(await stored(page)),before);
    await page.locator('[data-action="reset"]').click();await page.locator('#confirm-action').click();await page.waitForTimeout(60);assert.equal(await page.locator('.source-card').count(),0);assert.deepEqual((await stored(page)).case.sources,[]);await page.reload();assert.equal(await page.locator('.source-card').count(),0);
  });
  await check('add source, safe text rendering, repeated edit/remove confirmation and cancel',async()=>{
    await page.locator('#add-source').click();await page.locator('[name="label"]').fill('<img src=x onerror=alert(1)>');await page.locator('[name="quote"]').fill('<script>window.injection=true</script> November 1, 2026 12:00 UTC');await page.locator('[name="date"]').fill('2026-11-01');await page.locator('[name="time"]').fill('12:00');await page.locator('[name="zone"]').fill('UTC');await page.locator('[name="url"]').fill('javascript:alert(1)');await page.locator('#source-form button[type="submit"]').click();assert.match(await page.locator('#source-error').textContent(),/http/);
    await page.locator('[name="url"]').fill('https://example.com/source');await page.locator('#source-form button[type="submit"]').click();await page.waitForTimeout(60);assert.equal(await page.locator('.source-card').count(),1);assert.equal(await page.evaluate(()=>window.injection),undefined);assert.equal(await page.locator('.source-card img').count(),0);
    for(let i=0;i<2;i++) {await page.locator('[data-edit]').click();await page.locator('#source-label').fill(`Keep unsaved draft ${i}`);await page.locator('[data-delete]').click();await page.waitForTimeout(100);assert.equal(await page.locator('#confirm-action').isVisible(),true);await page.locator('#confirm-cancel').click();await page.waitForTimeout(50);assert.equal(await page.locator('.source-card').count(),1);assert.equal(await page.locator('#source-label').inputValue(),`Keep unsaved draft ${i}`);await close(page);await page.waitForTimeout(50);}
    await page.locator('[data-edit]').click();await page.locator('[data-delete]').click();await page.waitForTimeout(60);await page.locator('#confirm-action').click();await page.waitForTimeout(60);assert.equal(await page.locator('.source-card').count(),0);
  });
  await check('agreement export unlocks and modal keyboard focus is contained',async()=>{
    await loadExample(page,'agreement');assert.equal(await exportButton(page).isEnabled(),true);await page.locator('#add-source').click();await axe(page,'modal');
    for(let i=0;i<20;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('dialog')),true);}
    await close(page);await page.waitForTimeout(60);assert.equal(await page.locator('dialog[open]').count(),0);
  });
  await check('mobile 390px and 320px no horizontal overflow; responsive screenshot',async()=>{
    await page.setViewportSize({width:390,height:844});await noOverflow(page);await axe(page,'mobile');await page.screenshot({path:'evidence/mobile-agreement.png',fullPage:true});
    await page.locator('#add-source').click();await noOverflow(page);await page.screenshot({path:'evidence/mobile-source-dialog.png',fullPage:true});await close(page);await page.waitForTimeout(50);
    await page.setViewportSize({width:320,height:740});await noOverflow(page);await page.screenshot({path:'evidence/mobile-320.png',fullPage:true});
  });
  await check('reduced motion is honored',async()=>{assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);const transitions=await page.locator('button').first().evaluate(e=>getComputedStyle(e).transitionDuration);assert.equal(transitions,'0s');});
  await check('corrupt saved data is surfaced, never silently overwritten, and reset recovers',async()=>{
    await page.evaluate(()=>localStorage.setItem('cutoff.workspace.v1','{"version":1,"case":{"sources":[null]}}'));await page.reload();assert.match(await page.locator('.storage-warning').textContent(),/could not be read/);assert.equal(await page.evaluate(()=>localStorage.getItem('cutoff.workspace.v1')),'{"version":1,"case":{"sources":[null]}}');
    await page.locator('[data-action="reset"]').click();await page.locator('#confirm-action').click();await page.waitForTimeout(60);assert.equal(await page.locator('.storage-warning').count(),0);assert.equal((await stored(page)).case.sources.length,0);
  });
  await check('write-blocked storage remains usable and reports unsaved changes',async()=>{
    const blocked=await browser.newContext();await blocked.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Storage blocked','QuotaExceededError');};});const p=await blocked.newPage();await p.goto(base);await p.locator('#display-zone').fill('Asia/Tokyo');await p.locator('#settings-form button').click();assert.match(await p.locator('.storage-warning').textContent(),/could not save/);assert.equal(await p.locator('.source-card').count(),2);await blocked.close();
  });
  await check('no unhandled browser exceptions or outbound app requests',async()=>{assert.deepEqual(consoleErrors,[]);assert.deepEqual(remoteRequests,[]);});
  await writeFile('evidence/ui-results.json',JSON.stringify({testedAt:new Date().toISOString(),browser:await browser.version(),viewportWidths:[1440,390,320],results,consoleErrors,remoteRequests},null,2));
  console.log(`\n${results.length} browser checks passed.`);
} catch(error) {
  await writeFile('evidence/ui-failure.txt',String(error.stack||error));throw error;
} finally {await browser?.close();server.kill('SIGTERM');}
