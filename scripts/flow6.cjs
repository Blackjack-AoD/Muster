// Games tab filters Lists + Library; Library unit page is read-only; rules compendium search.
const { syncAndCreate } = require('./setup.cjs');
module.exports = async (page, ctx, shots) => {
  await syncAndCreate(page, 'sons of horus');
  await page.getByRole('button', { name: 'Back' }).click().catch(() => {});
  await page.goto('http://localhost:4173/#/games');
  await page.waitForSelector('.pick-list.games');
  await page.screenshot({ path: `${shots}/30-games.png` });
  console.log('games:', await page.locator('.pick-list.games .pick b').allInnerTexts());
  await page.locator('.pick-list.games .pick', { hasText: 'M40GA' }).click();
  await page.waitForSelector('.topbar');
  await page.waitForTimeout(400);
  console.log('lists sub:', await page.locator('.topbar .sub').innerText(), '| cards:', await page.locator('.roster-card').count(), '|', await page.locator('p.center').allInnerTexts());
  await page.screenshot({ path: `${shots}/31-lists-40k.png` });
  // Library: only 40k armies
  await page.getByRole('link', { name: 'Library' }).click();
  await page.waitForSelector('.pick-list .pick');
  console.log('armies:', await page.locator('.pick-list .pick').count(), 'labels:', await page.locator('.list-label').count());
  await page.getByPlaceholder('Search armies').fill('deathwatch');
  await page.locator('.pick', { hasText: 'Deathwatch' }).first().click();
  await page.getByPlaceholder('Search units').fill('veterans');
  await page.locator('.pick', { hasText: /^Veterans/ }).first().click();
  await page.waitForSelector('.overview', { timeout: 30000 });
  console.log('controls on library unit page:', await page.locator('.unit-page .stepper, .unit-page button.check, .unit-page button.radio, .mini').count());
  console.log('loadout:', (await page.locator('.loadout li').allInnerTexts()).slice(0, 6));
  await page.screenshot({ path: `${shots}/32-lib-unit.png` });
  await page.screenshot({ path: `${shots}/33-lib-unit-full.png`, fullPage: true });
  await page.getByRole('tab', { name: 'Rules' }).click();
  console.log('unit rules:', await page.locator('.rule summary').count());
  // compendium
  await page.goto('http://localhost:4173/#/lib-rules');
  await page.waitForSelector('.rule summary', { timeout: 60000 });
  console.log('placeholder:', await page.locator('.sticky-search input').getAttribute('placeholder'));
  await page.locator('.sticky-search input').fill('feel no pain');
  await page.waitForTimeout(300);
  console.log('fnp:', await page.locator('p.muted.small').first().innerText(), (await page.locator('.rule summary').allInnerTexts()).slice(0, 5));
  await page.locator('.rule summary').first().click();
  await page.screenshot({ path: `${shots}/34-compendium.png` });
  // switch to HH and search there
  await page.goto('http://localhost:4173/#/games');
  await page.locator('.pick-list.games .pick', { has: page.locator('b', { hasText: /^BlackJack AoD$/ }) }).click();
  await page.waitForTimeout(300);
  console.log('HH cards:', await page.locator('.roster-card').count());
  await page.goto('http://localhost:4173/#/lib-rules');
  await page.waitForSelector('.rule summary', { timeout: 60000 });
  await page.locator('.sticky-search input').fill('duellist');
  await page.waitForTimeout(300);
  console.log('hh duellist:', (await page.locator('.rule summary').allInnerTexts()).slice(0, 5));
  await page.screenshot({ path: `${shots}/35-compendium-hh.png` });
  // reload keeps the chosen game
  await page.reload(); await page.waitForSelector('.topbar .sub');
  console.log('after reload:', await page.locator('.topbar .sub').innerText());
};
