// List-building unit page: stat lines fit the width, empty groups hidden.
const { syncAndCreate } = require('./setup.cjs');
module.exports = async (page, ctx, shots) => {
  await syncAndCreate(page, 'iron warriors');
  const check = async (label) => {
    const info = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      wideTables: [...document.querySelectorAll('.unit-page table')].filter((t) => t.scrollWidth > t.clientWidth + 1).length,
      groups: [...document.querySelectorAll('.g-name')].map((g) => g.textContent),
    }));
    console.log(label, JSON.stringify(info));
  };
  for (const [btn, q, re] of [['Add Heavy Support', 'deathstorm', /Deathstorm/], ['Add Troops', 'tactical', /^Tactical Squad$/]]) {
    await page.getByRole('button', { name: new RegExp('^' + btn) }).click();
    await page.getByPlaceholder('Search units').fill(q);
    await page.locator('.sheet .pick', { has: page.locator('b', { hasText: re }) }).first().click();
    await page.waitForSelector('.unit-page .opts');
    await page.waitForTimeout(300);
    await check(q + ' options:');
    await page.screenshot({ path: `${shots}/90-${q}.png`, fullPage: true });
    await page.getByRole('tab', { name: 'Profiles' }).click();
    await check(q + ' profiles:');
    await page.screenshot({ path: `${shots}/91-${q}-profiles.png`, fullPage: true });
    await page.goBack(); await page.waitForSelector('.force');
  }
};
