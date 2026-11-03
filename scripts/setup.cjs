module.exports.syncAndCreate = async (page, army, game = /BlackJack AoD|Horus/) => {
  await page.goto('http://localhost:4173/');
  await page.waitForFunction(() => document.body.innerText.includes('No lists yet') && document.querySelector('.fab, .btn.primary'), null, { timeout: 120000 });
  // wait until both repos are on the phone
  await page.getByRole('link', { name: 'Data' }).click();
  await page.waitForFunction(() => (document.body.innerText.match(/synced just now/g) || []).length >= 2, null, { timeout: 180000 });
  await page.getByRole('link', { name: 'Lists' }).click();
  await page.getByRole('button', { name: /New list/ }).click();
  await page.getByRole('button', { name: game }).first().click();
  await page.getByPlaceholder('Search armies').fill(army);
  await page.locator('.sheet .pick').first().click();
  await page.getByRole('button', { name: 'Create list' }).click({ timeout: 30000 });
  await page.waitForSelector('.force', { timeout: 30000 });
};
