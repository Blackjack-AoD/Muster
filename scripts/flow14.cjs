// Add-unit list: swipe right adds with standard options, stays open, shows ×N until closed.
const { syncAndCreate } = require('./setup.cjs');
module.exports = async (page, ctx, shots) => {
  await syncAndCreate(page, 'iron warriors');
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (loc, dx) => {
    const b = await loc.boundingBox(); const y = b.y + b.height / 2, x = b.x + 40;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 8, y: y + 1 }] }); await page.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(500);
  };
  await page.getByRole('button', { name: /^Add Fast Attack/ }).click();
  await page.waitForSelector('.sheet .pick');
  const row = () => page.locator('.sheet .pick', { has: page.locator('b', { hasText: /Javelin Squadron/ }) }).first();
  await swipe(row(), 160);
  await swipe(row(), 160);
  console.log('row after 2 swipes:', (await row().innerText()).replace(/\n/g, ' '), '| sheet open:', await page.locator('.sheet').count(), '| url:', page.url().replace(/^.*#/, '#'));
  await page.screenshot({ path: `${shots}/95-quick-add.png` });
  await page.getByRole('button', { name: 'Close' }).click(); await page.waitForTimeout(300);
  console.log('fast attack rows:', await page.locator('.unit-row', { hasText: 'Javelin' }).count(), '| pts:', await page.locator('.sum-bar .pts').innerText());
  await page.getByRole('button', { name: /^Add Fast Attack/ }).click();
  await page.waitForSelector('.sheet .pick');
  console.log('reopened, counter shown:', await page.locator('.pick-added').count());
  await row().click(); await page.waitForTimeout(400);
  console.log('tap still opens unit:', page.url().includes('/u/'));
};
