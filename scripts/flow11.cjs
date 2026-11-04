// App update: open the app, publish a newer build behind it, press "Check for updates", expect the new version.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
module.exports = async (page, ctx, shots) => {
  await page.goto('http://localhost:4173/#/data');
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 30000 }).catch(() => {});
  await page.reload(); // now controlled by the service worker, like an installed app
  await page.waitForSelector('text=Check for updates');
  const ver = async () => (await page.locator('p.muted.small', { hasText: /^Muster / }).innerText()).split('.').slice(0, 3).join('.');
  console.log('controlled:', await page.evaluate(() => !!navigator.serviceWorker.controller), '| before:', await ver());
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await page.waitForTimeout(1500);
  console.log('no new build yet:', (await page.locator('p.muted.small', { hasText: /^Muster / }).innerText()).replace(/^.*\. /, ''));
  // publish a newer version
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const old = pkg.version;
  fs.writeFileSync('package.json', JSON.stringify({ ...pkg, version: old + '-test' }, null, 2) + '\n');
  try { execSync('npx vite build', { stdio: 'ignore' }); } finally { fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n'); }
  // without pressing anything: reopening the app shouldn't switch version (weekly check already done)
  for (let i = 0; i < 2; i++) { await page.reload(); await page.waitForSelector('text=Check for updates'); await page.waitForTimeout(6000); }
  console.log('after reopening twice, no button press:', await ver());
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await page.waitForTimeout(400);
  console.log('status:', (await page.locator('p.muted.small', { hasText: /^Muster / }).innerText().catch(() => '(reloading)')).replace(/^.*?\. /, ''));
  await page.waitForTimeout(5000);
  await page.waitForSelector('text=Check for updates');
  console.log('after:', await ver());
  await page.screenshot({ path: `${shots}/70-data-app.png`, fullPage: true });
  execSync('npx vite build', { stdio: 'ignore' }); // put the real build back
};
