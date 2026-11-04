// Army sheet: print to PDF, share link opens in a fresh browser with no data.
const { syncAndCreate } = require('./setup.cjs');
const fs = require('node:fs');
module.exports = async (page, ctx, shots) => {
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:4173' });
  await syncAndCreate(page, 'sons of horus');
  for (const [btn, q, re] of [['Add HQ', 'praetor', /^Praetor$/], ['Add Troops', 'tactical', /Tactical Squad/]]) {
    await page.getByRole('button', { name: new RegExp('^' + btn) }).click();
    await page.getByPlaceholder('Search units').fill(q);
    await page.locator('.sheet .pick', { has: page.locator('b', { hasText: re }) }).first().click();
    await page.waitForSelector('.unit-page'); await page.goBack(); await page.waitForSelector('.force');
  }
  await page.getByRole('button', { name: 'List options' }).click();
  await page.getByRole('button', { name: /Army sheet/ }).click();
  await page.waitForSelector('.army-sheet', { timeout: 30000 });
  console.log('units on sheet:', await page.locator('.as-unit-head b').allInnerTexts());
  console.log('rules reference entries:', await page.locator('.as-rule').count());
  await page.screenshot({ path: `${shots}/60-sheet.png`, fullPage: true });
  // print to PDF the way the browser's "Save as PDF" would
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ path: `${shots}/army-sheet.pdf`, format: 'A4', printBackground: true });
  console.log('pdf bytes:', pdf.length, 'pages:', (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length);
  await page.emulateMedia({ media: 'screen' });
  // share link
  await page.evaluate(() => { delete navigator.share; });
  await page.getByRole('button', { name: 'Share link' }).click();
  await page.waitForTimeout(800);
  const url = await page.evaluate(() => navigator.clipboard.readText());
  console.log('link length:', url.length, '| toast:', await page.locator('.toast').innerText().catch(() => ''));
  fs.writeFileSync(`${shots}/link.txt`, url);
  // open it where Muster has never been used (no data, no lists)
  const fresh = await page.context().browser().newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await fresh.route('https://api.github.com/**', (r) => r.abort());
  await fresh.route('https://raw.githubusercontent.com/**', (r) => r.abort());
  const p2 = await fresh.newPage();
  await p2.goto(url);
  await p2.waitForSelector('.army-sheet', { timeout: 30000 });
  console.log('fresh browser sees:', await p2.locator('.as-head h1').innerText(), '|', await p2.locator('.as-unit-head b').allInnerTexts(), '| rules:', await p2.locator('.as-rule').count(), '| tabbar:', await p2.locator('.tabbar').count());
  await p2.screenshot({ path: `${shots}/61-shared-view.png`, fullPage: true });
  await fresh.close();
};
