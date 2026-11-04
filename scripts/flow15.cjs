// Praetor gets Master of the Legion, which unlocks Rite of War; Rules tab shows category + army-wide rules.
const { syncAndCreate } = require('./setup.cjs');
module.exports = async (page, ctx, shots) => {
  await syncAndCreate(page, 'iron warriors');
  await page.getByRole('button', { name: /^Add HQ/ }).click();
  await page.getByPlaceholder('Search units').fill('praetor');
  await page.locator('.sheet .pick', { has: page.locator('b', { hasText: /^Praetor$/ }) }).first().click();
  await page.waitForSelector('.unit-page');
  console.log('master of the legion ticked:', await page.locator('.opt button.check.on', { hasText: 'Master of the Legion' }).count());
  await page.getByRole('tab', { name: 'Rules' }).click();
  console.log('unit rules:', (await page.locator('.rules > details summary').allInnerTexts()).join(', '));
  console.log('army-wide heading:', await page.locator('.rules-head').count());
  await page.screenshot({ path: `${shots}/96-praetor-rules.png`, fullPage: true });
  await page.goBack(); await page.waitForSelector('.force');
  await page.locator('.unit-row', { hasText: 'Rite of War' }).click();
  await page.waitForSelector('.unit-page');
  console.log('rite options:', (await page.locator('.unit-page .radio .o-name, .unit-page .check .o-name').allInnerTexts()).slice(0, 6).join(', '));
  await page.screenshot({ path: `${shots}/97-rite.png` });
  await page.goBack(); await page.waitForSelector('.force');
  await page.locator('.sum-bar .chip').click();
  console.log('issues:', (await page.locator('.issues li').allInnerTexts()).join(' | '));
};
