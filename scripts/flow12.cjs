const { syncAndCreate } = require('./setup.cjs');
module.exports = async (page, ctx, shots) => {
  await syncAndCreate(page, 'iron warriors');
  for (const b of ['Add HQ', 'Add Troops']) {
    await page.getByRole('button', { name: new RegExp('^' + b) }).click();
    await page.waitForSelector('.sheet .pick');
    const rows = await page.locator('.sheet .pick').allInnerTexts();
    console.log(b + ':', rows.slice(0, 7).map((r) => r.replace(/\n/g, ' ')).join(' | '));
    await page.screenshot({ path: `${shots}/80-${b.replace(' ', '-')}.png` });
    await page.goBack(); await page.waitForTimeout(300);
  }
};
