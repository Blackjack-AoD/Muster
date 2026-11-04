// HH list set-up: Legion hidden, Allegiance by lore as a 2-way choice, Expanded Army Lists as switches; swipe rows.
const { syncAndCreate } = require('./setup.cjs');
module.exports = async (page, ctx, shots) => {
  await syncAndCreate(page, 'sons of horus');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/50-new-hh-list.png`, fullPage: true });
  const cats = await page.locator('.cat-head').allInnerTexts();
  console.log('sections:', cats.slice(0, 6).map((c) => c.replace(/\n/g, ' ')));
  console.log('rows:', await page.locator('.unit-row .ur-name').allInnerTexts());
  console.log('allegiance:', await page.locator('.choice-row button').allInnerTexts(), 'on:', await page.locator('.choice-row button.on').innerText());
  console.log('issues chip:', await page.locator('.sum-bar .chip').innerText());
  await page.locator('.choice-row button', { hasText: 'Loyalist' }).click();
  await page.waitForTimeout(300);
  console.log('after tap, on:', await page.locator('.choice-row button.on').innerText());
  // Expanded Army Lists: tap to open, switches only, no tabs
  await page.locator('.unit-row', { hasText: 'Expanded Army List' }).click();
  await page.waitForSelector('.toggle-row');
  console.log('tabs on expanded page:', await page.locator('.unit-page .tabs').count(), '| switches:', await page.locator('.toggle-row').count(), '| on:', await page.locator('.toggle-row.on').count(), '| steppers:', await page.locator('.stepper').count());
  await page.locator('.toggle-row', { hasText: '3rd Edition' }).click();
  await page.waitForTimeout(300);
  console.log('after switching one off, on:', await page.locator('.toggle-row.on').count());
  await page.screenshot({ path: `${shots}/51-expanded.png`, fullPage: true });
  await page.goBack();
  await page.waitForSelector('.force');
  // add two units, then swipe
  await page.getByRole('button', { name: /^Add HQ/ }).click();
  await page.getByPlaceholder('Search units').fill('centurion');
  await page.locator('.sheet .pick', { hasText: /^Centurion/ }).first().click();
  await page.waitForSelector('.unit-page');
  await page.goBack();
  await page.waitForSelector('.force');
  const row = () => page.locator('.swipe .unit-row', { hasText: 'Centurion' }).first();
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (dx) => {
    const b = await row().boundingBox();
    const y = b.y + b.height / 2, x = b.x + b.width / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 8, y: y + 1 }] }); await page.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
  };
  console.log('centurions before:', await page.locator('.swipe .unit-row', { hasText: 'Centurion' }).count(), '| url:', page.url().replace(/^.*#/, '#'));
  await swipe(150);
  console.log('after swipe right:', await page.locator('.swipe .unit-row', { hasText: 'Centurion' }).count(), '| url:', page.url().replace(/^.*#/, '#'));
  await swipe(-150);
  console.log('after swipe left:', await page.locator('.swipe .unit-row', { hasText: 'Centurion' }).count(), '| toast:', await page.locator('.toast').innerText().catch(() => ''));
  await page.screenshot({ path: `${shots}/52-after-delete.png` });
  await page.locator('.toast button', { hasText: 'Undo' }).click();
  await page.waitForTimeout(300);
  console.log('after undo:', await page.locator('.swipe .unit-row', { hasText: 'Centurion' }).count());
  // a plain tap still opens the unit
  await row().click(); await page.waitForTimeout(300);
  console.log('tap opens:', page.url().includes('/u/'));
  await page.goBack(); await page.waitForSelector('.force');
  await page.screenshot({ path: `${shots}/53-roster.png`, fullPage: true });
};
