// Phone back button: steps back one screen at a time.
const { syncAndCreate } = require('./setup.cjs');
module.exports = async (page, ctx, shots) => {
  await syncAndCreate(page, 'sons of horus');
  const where = async (label) => { await page.waitForTimeout(400); console.log(label.padEnd(28), page.url().replace(/^.*#/, '#'), '| sheet:', await page.locator('.sheet').count()); };
  await where('roster');
  await page.getByRole('button', { name: /^Add HQ/ }).click();
  await where('add HQ sheet open');
  await page.goBack(); await where('back (should close sheet)');
  await page.getByRole('button', { name: /^Add HQ/ }).click();
  await page.getByPlaceholder('Search units').fill('centurion');
  await page.locator('.sheet .pick', { hasText: /^Centurion/ }).first().click();
  await where('unit page');
  await page.goBack(); await where('back (should be roster)');
  await page.goBack(); await where('back again (lists)');
  await page.goForward(); await where('forward (roster)');
  await page.locator('.unit-row').first().click(); await where('unit page via row');
  await page.getByRole('button', { name: 'Back' }).first().click(); await where('app back button (roster)');
  await page.getByRole('button', { name: 'List options' }).click(); await where('menu sheet');
  await page.getByRole('button', { name: 'Close' }).click(); await where('closed with X (roster)');
  await page.goBack(); await where('phone back (lists)');
};
