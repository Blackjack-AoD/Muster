module.exports = async (page, ctx, shots) => {
  await page.goto('http://localhost:4173/');
  await page.screenshot({ path: `${shots}/01-first-run.png` });
  await page.getByRole('link', { name: 'Data' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('synced just now') && !document.body.innerText.includes('Downloading'), null, { timeout: 120000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/02-data.png` });
  await page.getByRole('link', { name: 'Lists' }).click();
  await page.getByRole('button', { name: /New list/ }).click();
  await page.getByRole('button', { name: /BlackJack AoD|Horus/ }).first().click();
  await page.getByPlaceholder('Search armies').fill('sons of horus');
  await page.getByRole('button', { name: /Sons of Horus/ }).click();
  await page.getByRole('button', { name: 'Create list' }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${shots}/03-new-list.png` });
  await page.getByRole('button', { name: 'Create list' }).click();
  await page.waitForSelector('.force', { timeout: 30000 });
  await page.screenshot({ path: `${shots}/04-empty-list.png` });
  console.log('cats:', await page.locator('.cat-name').allInnerTexts());
};
