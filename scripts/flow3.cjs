const { syncAndCreate } = require('./setup.cjs');
module.exports = async (page, ctx, shots) => {
  await syncAndCreate(page, 'sons of horus');
  await page.getByRole('button', { name: 'Add HQ' }).click();
  await page.getByPlaceholder('Search units').fill('centurion');
  await page.locator('.sheet .pick', { hasText: /^Centurion/ }).first().click();
  await page.waitForSelector('.unit-page .group');
  await page.getByRole('button', { name: 'More Power Fist' }).click();
  await page.waitForTimeout(300);
  console.log('pts after fist:', await page.locator('.topbar .pts').innerText());
  const checked = await page.locator('.opt .check.on .o-name, .stepper-row:has(.count.on) .o-name').allInnerTexts();
  console.log('weapons now:', checked.filter(t => /Pistol|Chainsword|Fist/.test(t)));
  await page.locator('.opt', { hasText: 'Power Fist' }).first().screenshot({ path: `${shots}/20-fist.png` });
  await page.getByRole('button', { name: 'Back' }).click();
  console.log('cats:', (await page.locator('.cat-head').allInnerTexts()).map(t=>t.replace(/\n/g,' ')).filter(t=>/HQ/.test(t)));
  // offline reload keeps everything
  await page.waitForTimeout(1500);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.unit-row', { timeout: 30000 });
  console.log('offline reload ok, rows:', await page.locator('.unit-row').count());
  await page.screenshot({ path: `${shots}/21-offline.png` });
  // library works offline
  await page.goto('http://localhost:4173/#/lib');
  await page.getByPlaceholder('Search armies').fill('space marines: codex');
  await page.locator('.pick', { hasText: /^Space Marines: Codex/ }).first().click();
  await page.getByPlaceholder('Search units').fill('tactical');
  await page.locator('.pick', { hasText: 'Tactical Squad' }).first().click();
  await page.waitForSelector('.lib-unit .ov-sec', { timeout: 30000 });
  console.log('40k preview pts:', await page.locator('.topbar .pts').innerText());
  await page.screenshot({ path: `${shots}/22-lib-40k.png` });
};
