// Library unit page: stat lines fit the phone width (no sideways scroll), weapons + special rules shown.
const { syncAndCreate } = require('./setup.cjs');
const open = async (page, game, army, unit) => {
  await page.goto('http://localhost:4173/#/games');
  await page.locator('.pick-list.games .pick', { has: page.locator('b', { hasText: game }) }).click();
  await page.goto('http://localhost:4173/#/lib');
  await page.getByPlaceholder('Search armies').fill(army);
  await page.locator('.pick', { hasText: army }).first().click();
  await page.getByPlaceholder('Search units').fill(unit);
  await page.locator('.pick', { has: page.locator('b', { hasText: new RegExp('^' + unit) }) }).first().click();
  await page.waitForSelector('.lib-unit .ov-sec', { timeout: 30000 });
  await page.waitForTimeout(500);
};
module.exports = async (page, ctx, shots) => {
  await syncAndCreate(page, 'sons of horus');
  console.log('nav:', await page.locator('.tabbar a span').allInnerTexts().catch(() => []));
  const cases = [
    [/M40GA/, 'Deathwatch', 'Veterans'],
    [/M40GA/, 'Chaos Space Marines', 'Chaos Land Raider'],
    [/^BlackJack AoD$/, 'Sons of Horus', 'Tactical Squad'],
    [/^BlackJack AoD$/, 'Sons of Horus', 'Praetor'],
  ];
  let i = 40;
  for (const [g, army, unit] of cases) {
    await open(page, g, army, unit);
    const info = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      tablesOverflow: [...document.querySelectorAll('.stattable')].some((t) => t.scrollWidth > t.clientWidth + 1),
      clipped: [...document.querySelectorAll('.stattable td, .stattable th')].filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.textContent).slice(0, 8),
      sections: [...document.querySelectorAll('.ov-sec h3')].map((h) => h.textContent),
      rules: document.querySelectorAll('.lib-unit .rule').length,
      controls: document.querySelectorAll('.stepper, button.check, button.radio, .mini').length,
    }));
    console.log(unit, JSON.stringify(info));
    await page.screenshot({ path: `${shots}/${i++}-${unit.replace(/\W+/g, '-')}.png`, fullPage: true });
    await page.getByRole('tab', { name: 'Rules' }).click();
    console.log('  tabs:', await page.locator('.tabs button').allInnerTexts(), 'rules tab:', await page.locator('.lib-unit .rule').count());
    await page.screenshot({ path: `${shots}/${i++}-${unit.replace(/\W+/g, '-')}-rules.png` });
  }
};
