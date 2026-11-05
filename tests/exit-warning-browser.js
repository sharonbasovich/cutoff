import assert from 'node:assert/strict';

// Browser dispatch checks exercise the production listener without navigation.
const warned = page => page.evaluate(() => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
});
export async function acceptReload(page) {
  const pending = page.waitForEvent('dialog');
  const navigation = page.reload();
  const dialog = await pending;
  assert.equal(dialog.type(), 'beforeunload');
  await dialog.accept();
  await navigation;
}
async function declineReload(page) {
  const marker = await page.evaluate(() => (globalThis.__exitTestDocument = crypto.randomUUID()));
  const pending = page.waitForEvent('dialog');
  const navigation = page.reload({ timeout: 1000 }).then(() => 'loaded', error => error.message);
  const dialog = await pending;
  assert.equal(dialog.type(), 'beforeunload');
  await dialog.dismiss();
  await navigation; // Chromium may leave the cancelled navigation waiting until timeout.
  assert.equal(await page.evaluate(() => globalThis.__exitTestDocument), marker, 'Keeping the page retains the same document');
}
export async function verifyExitWarnings(browser, base, consoleErrors) {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();page.setDefaultTimeout(5000);
    page.on('pageerror', error => consoleErrors.push(error.message));
    try {
      await page.goto(base);await page.locator('h1').click();
      assert.equal(await warned(page), false, 'Untouched sample needs no warning');
      await page.locator('#add-source').click();
      assert.equal(await warned(page), false, 'Untouched blank form needs no warning');
      await page.locator('#source-label').fill('Unsaved synthetic evidence');
      assert.equal(await warned(page), true);
      await declineReload(page);
      assert.equal(await page.locator('#source-label').inputValue(), 'Unsaved synthetic evidence');
      await page.screenshot({ path: `evidence/exit-warning-${width}.png`, fullPage: true });
      await page.locator('#source-form button[type="submit"]').click();
      assert.equal(await warned(page), true, 'Invalid submission retains protection');
      await page.keyboard.press('Escape');
      assert.equal(await warned(page), true, 'Discard prompt still owns the draft');
      await page.locator('#keep-editing').click();
      await page.locator('#source-label').fill('');
      assert.equal(await warned(page), false, 'Reverting fields clears warning');
      for (const selector of ['#source-date', '#source-time']) {
        await page.locator(selector).focus();await page.keyboard.press('1');
        assert.equal(await page.locator(selector).evaluate(input => input.validity.badInput), true);
        assert.equal(await warned(page), true, 'Incomplete native input remains protected');
        await page.locator(selector).fill('');
        assert.equal(await warned(page), false);
      }
      await page.keyboard.press('Escape');
      await page.locator('[data-edit]').first().click();
      assert.equal(await warned(page), false, 'Opening a stored source is not an edit');
      const original = await page.locator('#source-quote').inputValue();
      await page.locator('#source-quote').fill('Synthetic edited source');
      await page.locator('[data-delete]').click();
      assert.equal(await warned(page), true, 'Removal confirmation retains captured unsaved edits');
      await declineReload(page);
      await page.locator('#confirm-cancel').click();
      assert.equal(await page.locator('#source-quote').inputValue(), 'Synthetic edited source');
      assert.equal(await warned(page), true);
      await page.locator('#source-quote').fill(original);
      assert.equal(await warned(page), false);
      await page.locator('#source-quote').fill('Synthetic saved source');
      await page.locator('#source-form button[type="submit"]').click();
      assert.equal(await warned(page), false, 'Successful source save clears warning');
      await page.locator('[data-resolve]').first().click();
      assert.equal(await warned(page), false);
      await page.locator('#resolution-note').fill('Synthetic clarification note');
      assert.equal(await warned(page), true);
      await page.keyboard.press('Escape');await page.locator('#discard-edits').click();
      assert.equal(await warned(page), false, 'Explicit draft discard clears warning');
      await page.locator('[data-resolve]').first().click();
      await page.locator('#resolution-note').fill('Synthetic saved note');
      await page.locator('#resolution-form button[type="submit"]').click();
      assert.equal(await warned(page), false, 'Successful clarification save clears warning');
      const previousTitle = await page.locator('#workspace-title').inputValue();
      await page.locator('#workspace-title').fill('Focused title draft');
      assert.equal(await warned(page), true, 'Input before change is protected');
      await page.locator('#display-zone').focus();
      assert.equal(await warned(page), false, 'Title change is stored normally');
      await page.locator('#workspace-title').fill(previousTitle);
      assert.equal(await warned(page), true, 'Returning to the pre-save title is another unsaved edit');
      await page.locator('#display-zone').focus();
      assert.equal(await warned(page), false);
      await page.locator('#buffer-minutes').fill('1e');
      assert.equal(await warned(page), true);
      await declineReload(page);
      assert.equal(await page.locator('#buffer-minutes').inputValue(), '1e');
      await page.locator('#settings-form button').click();
      assert.equal(await warned(page), true);
      await page.locator('#buffer-minutes').fill('120');await page.locator('#settings-form button').click();
      assert.equal(await warned(page), false);
      await page.locator('#buffer-minutes').fill('180');
      await acceptReload(page);
      assert.equal(await page.locator('#buffer-minutes').inputValue(), '120', 'Accepted exit discards only pending settings');
      assert.equal(await warned(page), false);
      await page.locator('#buffer-minutes').fill('180');
      await page.locator('[data-action="reset"]').click();await page.locator('#confirm-cancel').click();
      assert.equal(await warned(page), true, 'Cancelled reset preserves pending settings');
      await page.locator('[data-action="reset"]').click();await page.locator('#confirm-action').click();
      assert.equal(await warned(page), false, 'Accepted reset clears warning');
    } finally { await context.close(); }
  }
  const context = await browser.newContext();
  await context.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Synthetic blocked storage', 'QuotaExceededError'); }; });
  const page = await context.newPage();page.setDefaultTimeout(5000);
  page.on('pageerror', error => consoleErrors.push(error.message));
  try {
    await page.goto(base);assert.equal(await warned(page), false);
    await page.locator('#workspace-title').fill('Synthetic unsaved case');await page.locator('#display-zone').focus();
    assert.equal(await warned(page), true);
    assert.match(await page.locator('.storage-warning').textContent(), /could not save/);
    await declineReload(page);
    assert.equal(await page.locator('#workspace-title').inputValue(), 'Synthetic unsaved case');
    await page.locator('#backup-button').click();await page.keyboard.press('Escape');
    assert.equal(await warned(page), true, 'Opening backup does not imply durable save');
  } finally { await context.close(); }
}
