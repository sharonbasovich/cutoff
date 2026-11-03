import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertResolvedFoldCalendarExport } from './calendar-export-assertions.js';

const port=Number(process.env.TEST_PORT||4387),base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
let browser;
const results=[]; const consoleErrors=[]; const remoteRequests=[]; const focusTrace=[];
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
const recordDialogFocus=async(page,stage,direction=null,step=null)=>{
  const state=await page.evaluate(()=>{
    const active=document.activeElement,dialog=active?.closest('dialog[open]');
    return {tag:active?.tagName||null,id:active?.id||null,openDialog:dialog?.id||null,insideOpenDialog:!!dialog,hasFocus:document.hasFocus()};
  });
  const entry={stage,direction,step,...state};focusTrace.push(entry);return entry;
};
const assertDialogBoundary=async(page,dialogSelector,lastSelector,stage)=>{
  const first=page.locator(`${dialogSelector} [aria-label="Close dialog"]`),last=page.locator(lastSelector);
  await first.focus();await page.keyboard.press('Shift+Tab');
  const reverse=await recordDialogFocus(page,stage,'Shift+Tab','first-to-last');
  assert.equal(await last.evaluate(element=>document.activeElement===element),true,JSON.stringify(reverse));
  await page.keyboard.press('Tab');
  const forward=await recordDialogFocus(page,stage,'Tab','last-to-first');
  assert.equal(await first.evaluate(element=>document.activeElement===element),true,JSON.stringify(forward));
};
const noOverflow=async(page)=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
const captureModalEvidence=async(page)=>{
  const layout=await page.evaluate(()=>{
    const identify=element=>({tag:element.tagName.toLowerCase(),id:element.id,classes:element.className,for:element.getAttribute('for')});
    const rect=value=>({x:value.x,y:value.y,top:value.top,right:value.right,bottom:value.bottom,left:value.left,width:value.width,height:value.height});
    const properties=['color','backgroundColor','fontFamily','fontSize','fontWeight','lineHeight','display','position','zIndex','opacity','overflowX','overflowY','boxSizing','paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginRight','marginBottom','marginLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','whiteSpace','transform'];
    const describe=element=>{
      const style=getComputedStyle(element),bounds=element.getBoundingClientRect();
      const value={...identify(element),bounds:rect(bounds),clientRects:[...element.getClientRects()].map(rect),
        scroll:{left:element.scrollLeft,top:element.scrollTop,width:element.scrollWidth,height:element.scrollHeight,clientWidth:element.clientWidth,clientHeight:element.clientHeight},
        style:Object.fromEntries(properties.map(name=>[name,style[name]]))};
      if(element.matches('input,textarea')){
        const placeholder=getComputedStyle(element,'::placeholder');
        value.placeholderStyle=Object.fromEntries(['color','backgroundColor','fontFamily','fontSize','fontWeight','lineHeight','opacity'].map(name=>[name,placeholder[name]]));
      }
      return value;
    };
    const dialog=document.querySelector('dialog[open]');
    const nearby=new Set([document.body,document.querySelector('#source-form'),document.querySelector('#source-form .form-grid'),document.querySelector('#source-form .dialog-footer')]);
    const targets=['#source-quote','#source-zone-hint'].map(selector=>{
      const element=document.querySelector(selector);
      if(!element)return {selector,missing:true};
      const field=element.closest('.form-field');
      for(const neighbor of [field?.previousElementSibling,field,field?.nextElementSibling]){
        if(!neighbor)continue;nearby.add(neighbor);
        for(const child of neighbor.querySelectorAll('label,label span,input,textarea,select,.field-hint'))nearby.add(child);
      }
      const bounds=element.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(element);
      const points=[[bounds.left+1,bounds.top+1],[bounds.right-1,bounds.top+1],[(bounds.left+bounds.right)/2,(bounds.top+bounds.bottom)/2],[bounds.left+1,bounds.bottom-1],[bounds.right-1,bounds.bottom-1]];
      const hitTests=points.map(([x,y])=>{
        if(x<0||x>=innerWidth||y<0||y>=innerHeight)return {x,y,outsideViewport:true};
        const hits=document.elementsFromPoint(x,y).slice(0,5);for(const hit of hits)nearby.add(hit);
        return {x,y,elementsFrontToBack:hits.map(identify)};
      });
      return {selector,...describe(element),contentRects:[...range.getClientRects()].map(rect),hitTests};
    });
    return {viewport:{width:innerWidth,height:innerHeight,devicePixelRatio,scrollX,scrollY,visualViewport:window.visualViewport?{width:visualViewport.width,height:visualViewport.height,offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop,scale:visualViewport.scale}:null},
      document:describe(document.documentElement),dialog:dialog?describe(dialog):null,activeElement:document.activeElement?identify(document.activeElement):null,
      targets,nearby:[...nearby].filter(Boolean).map(describe)};
  });
  await writeFile('evidence/modal-layout.json',JSON.stringify(layout,null,2));
  await page.screenshot({path:'evidence/desktop-source-dialog.png',fullPage:true});
};
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
  await check('unapplied settings survive source saves and validation; only Apply changes the comparison', async()=>{
    const draftPage = await context.newPage();await draftPage.goto(base);
    const before = await draftPage.locator('.planning-card').textContent();
    await draftPage.locator('#display-zone').fill('Asia/Tokyo');await draftPage.locator('#buffer-minutes').fill('120');
    assert.match(await draftPage.locator('#settings-draft-status').textContent(), /Changes not applied/);
    await draftPage.locator('[data-edit]').first().click();await draftPage.locator('#source-form button[type="submit"]').click();
    assert.equal(await draftPage.locator('#display-zone').inputValue(), 'Asia/Tokyo');
    assert.equal(await draftPage.locator('#buffer-minutes').inputValue(), '120');
    assert.equal(await draftPage.locator('.planning-card').textContent(), before);
    const applied = (await stored(draftPage)).case;
    assert.notEqual(applied.localZone, 'Asia/Tokyo');assert.notEqual(applied.bufferMinutes, 120);
    await draftPage.locator('#buffer-minutes').fill('-1');await draftPage.locator('#settings-form button').click();
    assert.match(await draftPage.locator('#settings-error').textContent(), /whole/);
    await draftPage.locator('[data-edit]').first().click();await draftPage.locator('#source-form button[type="submit"]').click();
    assert.equal(await draftPage.locator('#buffer-minutes').inputValue(), '-1');
    await draftPage.locator('#buffer-minutes').fill('120');
    await draftPage.setViewportSize({width:390,height:844});await noOverflow(draftPage);
    await draftPage.locator('#settings-form').scrollIntoViewIfNeeded();
    await draftPage.screenshot({path:'evidence/mobile-pending-settings.png',fullPage:true});
    await axe(draftPage, 'pending-settings');
    await draftPage.locator('#settings-form button').click();
    assert.equal((await stored(draftPage)).case.bufferMinutes, 120);
    assert.equal((await stored(draftPage)).case.localZone, 'Asia/Tokyo');
    assert.equal(await draftPage.locator('#settings-draft-status').textContent(), '');
    await draftPage.locator('#buffer-minutes').fill('180');
    await draftPage.locator('[data-example="gap"]').click();await draftPage.locator('#confirm-cancel').click();
    assert.equal(await draftPage.locator('#buffer-minutes').inputValue(), '180');
    await draftPage.reload();assert.equal(await draftPage.locator('#buffer-minutes').inputValue(), '120');
    await draftPage.locator('#buffer-minutes').fill('180');
    await draftPage.locator('[data-example="gap"]').click();await draftPage.locator('#confirm-action').click();
    assert.equal(await draftPage.locator('#settings-draft-status').textContent(), '');
    await draftPage.locator('#buffer-minutes').fill('180');
    await draftPage.locator('[data-action="reset"]').click();await draftPage.locator('#confirm-cancel').click();
    assert.equal(await draftPage.locator('#buffer-minutes').inputValue(), '180');
    await draftPage.locator('[data-action="reset"]').click();await draftPage.locator('#confirm-action').click();
    assert.equal(await draftPage.locator('#buffer-minutes').inputValue(), '60');
    assert.equal(await draftPage.locator('#settings-draft-status').textContent(), '');
    await draftPage.close();await page.reload();
  });

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
    const before=JSON.stringify(await stored(page));await page.locator('[data-edit]').click();await page.locator('[name="label"]').fill('Discard me');await close(page);await page.locator('#discard-edits').click();assert.equal(JSON.stringify(await stored(page)),before);
    await page.locator('[data-edit]').click();await page.locator('[name="label"]').fill('New notice label');await page.locator('#source-form button[type="submit"]').click();await page.waitForTimeout(60);
    assert.deepEqual((await stored(page)).case.sources[0].resolution,{});assert.equal(await exportButton(page).isDisabled(),true);
  });
  await check('dirty source dismissal protects quotes, restores focus and never autosaves',async()=>{
    await loadExample(page,'fold');const before=JSON.stringify(await stored(page));
    await page.locator('[data-edit]').click();const original=await page.locator('#source-quote').inputValue();
    await page.locator('#source-quote').fill('Unsaved synthetic evidence');await close(page);
    assert.equal(await page.locator('#keep-editing').isVisible(),true);
    assert.equal(await page.locator('#keep-editing').evaluate(e=>e===document.activeElement),true);
    assert.equal(JSON.stringify(await stored(page)),before);
    await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('#discard-edits').evaluate(e=>e===document.activeElement),true);
    await page.keyboard.press('Tab');assert.equal(await page.locator('#keep-editing').evaluate(e=>e===document.activeElement),true);
    await axe(page,'draft-guard');await page.screenshot({path:'evidence/draft-guard-desktop.png',fullPage:true});
    await close(page);assert.equal(await page.locator('#source-quote').inputValue(),'Unsaved synthetic evidence');
    assert.equal(await page.locator('#source-quote').evaluate(e=>e===document.activeElement),true);
    await page.locator('#source-form [data-action="close"]').last().click();await page.locator('#keep-editing').click();
    await page.locator('#source-form [aria-label="Close dialog"]').click();await page.locator('#keep-editing').click();
    await page.mouse.click(1,1);assert.equal(await page.locator('#discard-edits').isVisible(),true);await page.locator('#keep-editing').click();
    await page.locator('#source-quote').fill(original);await close(page);assert.equal(await page.locator('dialog[open]').count(),0);
    await page.locator('#add-source').click();await page.locator('#source-quote').fill('Incomplete draft, no date');await close(page);
    await page.setViewportSize({width:320,height:740});await noOverflow(page);await axe(page,'draft-guard-mobile');
    await page.screenshot({path:'evidence/draft-guard-mobile.png',fullPage:true});await page.locator('#discard-edits').click();
    assert.equal(JSON.stringify(await stored(page)),before);await page.setViewportSize({width:1440,height:1000});
  });
  await check('clarification choices and notes survive dismissal; explicit discard leaves saved decisions untouched',async()=>{
    const before=JSON.stringify(await stored(page));await page.locator('[data-resolve]').click();
    await page.locator('[name="fold"][value="later"]').check();await page.locator('#resolution-note').fill('Unfinished synthetic confirmation');await close(page);
    await page.locator('#keep-editing').click();assert.equal(await page.locator('[name="fold"][value="later"]').isChecked(),true);
    assert.equal(await page.locator('#resolution-note').inputValue(),'Unfinished synthetic confirmation');
    await page.locator('#resolution-zone').fill('UTC');await close(page);await page.locator('#keep-editing').click();
    assert.equal(await page.locator('#resolution-zone').inputValue(),'UTC');assert.equal(await page.locator('[name="fold"][value="later"]').isDisabled(),true);
    await close(page);await page.locator('#discard-edits').click();assert.equal(JSON.stringify(await stored(page)),before);
  });
  await check('canceling source removal retains dirty protection against the actual saved source',async()=>{
    const before=JSON.stringify(await stored(page));await page.locator('[data-edit]').click();await page.locator('#source-quote').fill('Still unsaved after canceled removal');
    await page.locator('[data-delete]').click();await page.locator('#confirm-cancel').click();
    assert.equal(await page.locator('#source-quote').inputValue(),'Still unsaved after canceled removal');await close(page);
    assert.equal(await page.locator('#discard-edits').isVisible(),true);await page.locator('#discard-edits').click();assert.equal(JSON.stringify(await stored(page)),before);
  });
  await check('partial native date and time survive every dismissal without another changed field',async()=>{
    const before=JSON.stringify(await stored(page));
    for(const selector of ['#source-date','#source-time']) for(const action of ['Escape','Cancel','Close','backdrop']) {
      await page.locator('#add-source').click();const input=page.locator(selector);await input.focus();await page.keyboard.press('1');
      assert.deepEqual(await input.evaluate(e=>({value:e.value,badInput:e.validity.badInput})),{value:'',badInput:true},`${selector} must establish an incomplete native segment`);
      if(action==='Escape') await page.keyboard.press('Escape');
      else if(action==='Cancel') await page.locator('#source-form .dialog-footer [data-action="close"]').click();
      else if(action==='Close') await page.locator('#source-form [aria-label="Close dialog"]').click();
      else await page.mouse.click(1,1);
      assert.equal(await page.locator('#keep-editing').isVisible(),true,`${selector}/${action}`);
      await page.locator('#keep-editing').click();assert.equal(await input.evaluate(e=>e.validity.badInput),true);
      assert.equal(await input.evaluate(e=>e===document.activeElement),true);assert.equal(JSON.stringify(await stored(page)),before);
      await page.keyboard.press('Escape');await page.locator('#discard-edits').click();
    }
    await page.locator('#add-source').click();await page.locator('#source-date').focus();await page.keyboard.press('1');
    await page.locator('#source-date').fill('');assert.equal(await page.locator('#source-date').evaluate(e=>e.validity.badInput),false);
    await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0,'Fully cleared empty form closes without false warning');
  });
  await check('partial native input is not serialized away by opening removal confirmation',async()=>{
    const before=JSON.stringify(await stored(page));
    for(const selector of ['#source-date','#source-time']) {
      await page.locator('[data-edit]').click();const input=page.locator(selector);await input.fill('');await input.focus();await page.keyboard.press('1');
      assert.equal(await input.evaluate(e=>e.validity.badInput),true);await page.locator('[data-delete]').click();
      assert.equal(await page.locator('#reset-dialog').count(),0);assert.match(await page.locator('#source-error').textContent(),/Finish or clear/);
      assert.equal(await input.evaluate(e=>e.validity.badInput && e===document.activeElement),true);
      assert.equal(JSON.stringify(await stored(page)),before);await page.keyboard.press('Escape');await page.locator('#discard-edits').click();
    }
  });
  await check('four consecutive Escapes preserve dirty source and clarification drafts and focus',async()=>{
    for(const [opener,field] of [['[data-edit]','#source-quote'],['[data-resolve]','#resolution-note']]) {
      const before=JSON.stringify(await stored(page));await page.locator(opener).click();await page.locator(field).fill('Four-Escape regression draft');
      for(let i=0;i<4;i++) {
        await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),1);
        assert.equal(await page.locator(field).inputValue(),'Four-Escape regression draft');
        assert.equal(await page.evaluate(()=>!!document.activeElement.closest('dialog[open]')),true);
        assert.equal(await page.locator(i%2===0?'#keep-editing':field).evaluate(e=>e===document.activeElement),true);
        assert.equal(JSON.stringify(await stored(page)),before);
      }
      await page.keyboard.press('Escape');await page.locator('#discard-edits').click();
    }
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
    for(let i=0;i<2;i++) {await page.locator('[data-edit]').click();await page.locator('#source-label').fill(`Keep unsaved draft ${i}`);await page.locator('[data-delete]').click();await page.waitForTimeout(100);assert.equal(await page.locator('#confirm-action').isVisible(),true);await assertDialogBoundary(page,'#reset-dialog','#confirm-action',`remove-confirm-${i}`);await page.locator('#confirm-cancel').click();await page.waitForTimeout(50);assert.equal(await page.locator('.source-card').count(),1);assert.equal(await page.locator('#source-label').inputValue(),`Keep unsaved draft ${i}`);assert.equal(await page.locator('#source-label').evaluate(element=>document.activeElement===element),true,JSON.stringify(await recordDialogFocus(page,`restored-edit-${i}`)));await assertDialogBoundary(page,'#source-dialog','#source-form button[type="submit"]',`restored-edit-${i}`);await close(page);await page.locator('#discard-edits').click();await page.waitForTimeout(50);}
    await page.locator('[data-edit]').click();await page.locator('[data-delete]').click();await page.waitForTimeout(60);await page.locator('#confirm-action').click();await page.waitForTimeout(60);assert.equal(await page.locator('.source-card').count(),0);
  });
  await check('agreement export unlocks and modal keyboard focus is contained',async()=>{
    await loadExample(page,'agreement');assert.equal(await exportButton(page).isEnabled(),true);await page.locator('#add-source').click();await captureModalEvidence(page);
    assert.equal((await recordDialogFocus(page,'before-modal-axe')).id,'source-label');await axe(page,'modal');
    const afterAxe=await recordDialogFocus(page,'after-modal-axe');assert.equal(afterAxe.insideOpenDialog,true,JSON.stringify(afterAxe));
    for(let i=0;i<20;i++){await page.keyboard.press('Tab');const focus=await recordDialogFocus(page,'source-dialog-traversal','Tab',i+1);assert.equal(await page.evaluate(()=>!!document.activeElement.closest('dialog')),true,JSON.stringify(focus));assert.equal(focus.insideOpenDialog,true,JSON.stringify(focus));}
    for(let i=0;i<20;i++){await page.keyboard.press('Shift+Tab');const focus=await recordDialogFocus(page,'source-dialog-traversal','Shift+Tab',i+1);assert.equal(await page.evaluate(()=>!!document.activeElement.closest('dialog')),true,JSON.stringify(focus));assert.equal(focus.insideOpenDialog,true,JSON.stringify(focus));}
    await assertDialogBoundary(page,'#source-dialog','#source-form button[type="submit"]','add-source-boundaries');
    await close(page);await page.waitForTimeout(60);assert.equal(await page.locator('dialog[open]').count(),0);
    assert.equal(await page.locator('#add-source').evaluate(element=>document.activeElement===element),true,JSON.stringify(await recordDialogFocus(page,'after-source-escape')));
    await page.locator('#add-source').click();await page.locator('#source-form .dialog-footer [data-action="close"]').click();await page.waitForTimeout(60);assert.equal(await page.locator('dialog[open]').count(),0);
    assert.equal(await page.locator('#add-source').evaluate(element=>document.activeElement===element),true,JSON.stringify(await recordDialogFocus(page,'after-source-cancel')));
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
  await check('stale tabs cannot overwrite newer work; cancellation, export and explicit reset remain usable',async()=>{
    const tabs=await browser.newContext({acceptDownloads:true});
    try {
      const a=await tabs.newPage();a.setDefaultTimeout(4000);a.on('pageerror',e=>consoleErrors.push(e.message));
      await a.goto(base);await loadExample(a,'agreement');
      const b=await tabs.newPage();b.setDefaultTimeout(4000);b.on('pageerror',e=>consoleErrors.push(e.message));await b.goto(base);
      await b.locator('#workspace-title').fill('Newer saved case');await b.locator('#display-zone').focus();
      await a.locator('#workspace-title').fill('Retained local case');await a.locator('#display-zone').focus();
      assert.match(await a.locator('.storage-warning').textContent(),/changed outside this tab/);
      assert.equal((await stored(a)).case.title,'Newer saved case');
      assert.equal(await a.locator('#workspace-title').inputValue(),'Retained local case');
      await a.locator('[data-action="reset"]').click();await a.locator('#confirm-cancel').click();
      assert.equal((await stored(a)).case.title,'Newer saved case');
      assert.equal(await a.locator('#workspace-title').inputValue(),'Retained local case');
      const pending=a.waitForEvent('download');await exportButton(a).click();const download=await pending;
      const calendar=await readFile(await download.path(),'utf8');
      assert.match(calendar,/SUMMARY:Planning target: Retained local case/);
      assert.equal((await stored(a)).case.title,'Newer saved case','Export must not overwrite storage');
      await a.locator('[data-action="reset"]').click();assert.match(await a.locator('#dialog-description').textContent(),/including changes from another tab/);await a.locator('#confirm-action').click();
      assert.equal((await stored(a)).case.sources.length,0);assert.equal(await a.locator('.storage-warning').count(),0);
      await a.locator('#workspace-title').fill('New empty case');await a.locator('#display-zone').focus();
      assert.equal((await stored(a)).case.title,'New empty case');
      await b.locator('#workspace-title').fill('Stale after reset');await b.locator('#display-zone').focus();
      assert.match(await b.locator('.storage-warning').textContent(),/changed outside this tab/);
      assert.equal((await stored(b)).case.title,'New empty case');
      await b.reload();assert.equal(await b.locator('#workspace-title').inputValue(),'New empty case');assert.equal(await b.locator('.storage-warning').count(),0);
    } finally { await tabs.close(); }
  });
  await check('portable backup review, cancellation, unresolved recovery, Undo and draft preservation',async()=>{
    await page.setViewportSize({width:1280,height:900});await loadExample(page,'disagreement');
    const original=await stored(page);await page.locator('#buffer-minutes').fill('77');
    await page.locator('#backup-button').click();
    const pending=page.waitForEvent('download');await page.locator('#download-backup').click();const download=await pending;
    const text=await readFile(await download.path(),'utf8'),backup=JSON.parse(text);
    assert.deepEqual(backup.workspace,original);assert.notEqual(backup.workspace.case.bufferMinutes,77);
    await page.locator('#backup-json').fill(text);await page.locator('#review-backup').click();assert.match(await page.locator('#backup-preview').textContent(),/Conflicting deadlines/);
    await close(page);assert.deepEqual(await stored(page),original);assert.equal(await page.locator('#buffer-minutes').inputValue(),'77');
    await page.locator('#backup-button').click();await page.locator('#backup-json').fill(text);await page.locator('#review-backup').click();
    await page.locator('#backup-json').fill('{');assert.equal(await page.locator('#confirm-restore').count(),0);await page.locator('#review-backup').click();assert.match(await page.locator('#backup-error').textContent(),/not valid JSON/);assert.deepEqual(await stored(page),original);
    backup.workspace.case.title='Recovered conflicting evidence';await page.locator('#backup-json').fill(JSON.stringify(backup));await page.locator('#review-backup').click();await page.locator('#confirm-restore').click();
    assert.equal(await page.locator('#workspace-title').inputValue(),'Recovered conflicting evidence');assert.equal(await exportButton(page).isDisabled(),true);assert.equal((await stored(page)).modified,true);
    await page.locator('[data-example="agreement"]').click();assert.equal(await page.locator('#confirm-action').isVisible(),true);await page.locator('#confirm-cancel').click();
    await page.locator('#undo-restore').click();assert.deepEqual(await stored(page),original);assert.equal(await page.locator('#buffer-minutes').inputValue(),'77');
    await page.locator('#backup-button').click();await page.locator('#backup-json').fill(text);await page.locator('#review-backup').click();await page.locator('#confirm-restore').click();
    await page.locator('#workspace-title').fill('Later edit');await page.keyboard.press('Tab');assert.equal(await page.locator('#undo-restore').count(),0);await page.locator('#backup-button').click();
    await page.setViewportSize({width:320,height:740});await noOverflow(page);await axe(page,'backup-mobile');await page.screenshot({path:'evidence/mobile-backup-dialog.png',fullPage:true});
    await page.locator('#backup-json').fill(text);await page.locator('#review-backup').click();assert.equal(await page.locator('#confirm-restore').isVisible(),true);await noOverflow(page);await axe(page,'backup-preview-mobile');await page.screenshot({path:'evidence/mobile-backup-preview.png',fullPage:true});await close(page);
  });
  await check('backup restore and Undo never overwrite externally changed storage',async()=>{
    const isolated=await browser.newContext();try {
      const p=await isolated.newPage();await p.goto(base);await loadExample(p,'agreement');const before=await stored(p);
      const backup={format:'cutoff-workspace',version:1,createdAt:'2026-11-02T20:00:00.000Z',workspace:structuredClone(before)};backup.workspace.case.title='Restored tab copy';
      await p.locator('#backup-button').click();await p.locator('#backup-json').fill(JSON.stringify(backup));await p.locator('#review-backup').click();
      const newer=structuredClone(before);newer.case.title='Newer saved elsewhere';await p.evaluate(v=>localStorage.setItem('cutoff.workspace.v1',JSON.stringify(v)),newer);
      await p.locator('#confirm-restore').click();assert.equal(await p.locator('#workspace-title').inputValue(),'Restored tab copy');assert.deepEqual(await stored(p),newer);assert.match(await p.locator('.storage-warning').textContent(),/changed outside this tab/);
      await p.locator('#undo-restore').click();assert.equal(await p.locator('#workspace-title').inputValue(),before.case.title);assert.deepEqual(await stored(p),newer);assert.match(await p.locator('#announcer').textContent(),/this tab only/);
    }finally{await isolated.close();}
  });
  await check('multi-date timelines keep day context at desktop and mobile widths',async()=>{
    const data={version:1,exampleId:null,modified:true,case:{title:'Synthetic multi-day comparison',localZone:'UTC',bufferMinutes:60,sources:['2026-12-31','2027-01-01'].map((date,index)=>({id:`date-${index}`,label:`Synthetic source ${index+1}`,quote:'Synthetic test deadline',date,time:'12:00',zone:'UTC'}))}};
    await page.evaluate(value=>localStorage.setItem('cutoff.workspace.v1',JSON.stringify(value)),data);await page.reload();
    for(const width of [1440,390,320]){
      await page.setViewportSize({width,height:900});await noOverflow(page);
      assert.deepEqual(await page.locator('.timeline-date').allTextContents(),['Dec 31, 2026','Dec 31, 2026','Jan 1, 2027']);
      assert.deepEqual(await page.locator('.timeline-legend strong').allTextContents(),['11:00','12:00','12:00']);
      assert.equal(await exportButton(page).isDisabled(),true);
      for(const node of await page.locator('.timeline-date').all()) assert.equal(await node.isVisible(),true);
      await page.screenshot({path:`evidence/timeline-dates-${width}.png`,fullPage:true});
    }
    await page.locator('#buffer-minutes').fill('0');await page.locator('#settings-form button').click();
    assert.equal(await page.locator('.timeline-date').count(),3);
    await loadExample(page,'agreement');assert.equal(await page.locator('.timeline-date').count(),0);
    data.case.sources=[{id:'midnight',label:'Synthetic midnight',quote:'Synthetic deadline',date:'2027-01-01',time:'00:30',zone:'UTC'}];
    await page.evaluate(value=>localStorage.setItem('cutoff.workspace.v1',JSON.stringify(value)),data);await page.reload();
    assert.deepEqual(await page.locator('.timeline-date').allTextContents(),['Dec 31, 2026','Jan 1, 2027']);
    assert.equal(await exportButton(page).isEnabled(),true);
    await page.locator('#display-zone').fill('America/New_York');await page.locator('#settings-form button').click();
    assert.equal(await page.locator('.timeline-date').count(),0);
    await page.locator('#display-zone').fill('UTC');await page.locator('#settings-form button').click();
    assert.equal(await page.locator('.timeline-date').count(),2);
    await page.screenshot({path:'evidence/timeline-midnight-320.png',fullPage:true});
    await page.emulateMedia({media:'print'});assert.equal(await page.locator('.timeline-date').count(),2);await page.emulateMedia({media:'screen'});
  });
  await check('no unhandled browser exceptions or outbound app requests',async()=>{assert.deepEqual(consoleErrors,[]);assert.deepEqual(remoteRequests,[]);});
  await writeFile('evidence/ui-results.json',JSON.stringify({testedAt:new Date().toISOString(),browser:await browser.version(),viewportWidths:[1440,390,320],results,consoleErrors,remoteRequests,focusTrace},null,2));
  console.log(`\n${results.length} browser checks passed.`);
} catch(error) {
  await writeFile('evidence/ui-failure.txt',`${String(error.stack||error)}\n\nFocus trace (synthetic test controls only):\n${JSON.stringify(focusTrace,null,2)}`);throw error;
} finally {await browser?.close();server.kill('SIGTERM');}



