const { syncAndCreate } = require('./setup.cjs');
module.exports = async (page, ctx, shots) => {
  await syncAndCreate(page, 'sons of horus');
  await page.getByRole('button', { name: 'Add HQ' }).click();
  await page.screenshot({ path: `${shots}/10-add-hq.png` });
  await page.getByPlaceholder('Search units').fill('centurion');
  await page.locator('.sheet .pick', { hasText: /^Centurion/ }).first().click();
  await page.waitForSelector('.unit-page .group', { timeout: 30000 });
  await page.screenshot({ path: `${shots}/11-centurion.png` });
  // choose a power fist in the weapon group via stepper / check
  const fist = page.locator('.opt', { hasText: 'Power Fist' }).first();
  await fist.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/12-weapons.png` });
  await page.getByRole('tab', { name: 'Profiles' }).click();
  await page.screenshot({ path: `${shots}/13-profiles.png` });
  await page.getByRole('tab', { name: 'Rules' }).click();
  await page.screenshot({ path: `${shots}/14-rules.png` });
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Add Troops' }).click();
  await page.getByPlaceholder('Search units').fill('tactical');
  await page.locator('.sheet .pick', { hasText: /Tactical Squad/ }).first().click();
  await page.waitForSelector('.unit-page .opts', { timeout: 30000 });
  await page.screenshot({ path: `${shots}/15-tactical.png` });
  await page.getByRole('button', { name: 'Back' }).click();
  await page.waitForSelector('.unit-row');
  await page.screenshot({ path: `${shots}/16-roster.png`, fullPage: true });
  console.log('rows:', await page.locator('.unit-row').allInnerTexts());
  console.log('total:', await page.locator('.sum-bar .pts').innerText());
};
