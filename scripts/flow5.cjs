// Per-model wargear: split one Deathwatch Veteran off, give it a different weapon, check points, merge back.
const { syncAndCreate } = require('./setup.cjs');
module.exports = async (page, ctx, shots) => {
  await syncAndCreate(page, 'deathwatch', /M40GA/);
  await page.getByRole('button', { name: /Add Troops/ }).click();
  await page.getByPlaceholder('Search units').fill('veterans');
  await page.locator('.sheet .pick', { hasText: /^Veterans/ }).first().click();
  await page.waitForSelector('.unit-page .opts', { timeout: 30000 });
  const pts = async () => (await page.locator('.topbar .pts, .topbar [class*=pts]').first().innerText()).trim();
  console.log('start pts:', await pts());
  await page.screenshot({ path: `${shots}/20-veterans.png` });
  const split = page.getByRole('button', { name: 'Split 1' }).first();
  await split.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/21-split-button.png` });
  await split.click();
  await page.waitForTimeout(300);
  console.log('heads after split:', await page.locator('.sub-head span:nth-child(2)').allInnerTexts());
  // the split-off model is the second "Veteran" block: give it a storm shield
  // innermost block whose header reads "1× Veteran"
  const single = page.locator('.subopts', { has: page.locator('.sub-head', { hasText: '1× Veteran' }) }).last();
  const shield = single.locator('.opt', { hasText: 'Storm Shield' }).first();
  await shield.scrollIntoViewIfNeeded();
  await shield.locator('button').first().click();
  await page.waitForTimeout(300);
  console.log('after shield pts:', await pts());
  await single.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/22-split-model.png` });
  // back to the standard kit (shield off, Boltgun & Chainsword on): identical again, so Merge appears
  await shield.locator('button').first().click();
  await page.waitForTimeout(300);
  await single.locator('.opt', { hasText: 'Boltgun & Chainsword' }).first().locator('button').first().click();
  await page.waitForTimeout(300);
  const merge = page.getByRole('button', { name: 'Merge' }).first();
  console.log('merge visible:', await merge.isVisible());
  await merge.click();
  await page.waitForTimeout(300);
  console.log('heads after merge:', await page.locator('.sub-head span:nth-child(2)').allInnerTexts());
  console.log('end pts:', await pts());
  await page.getByRole('button', { name: 'Back' }).click();
  await page.waitForSelector('.unit-row');
  console.log('rows:', await page.locator('.unit-row').allInnerTexts());
  await page.screenshot({ path: `${shots}/23-roster.png` });
};
