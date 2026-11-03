const { syncAndCreate } = require('./setup.cjs');
module.exports = async (page, ctx, shots) => {
  page.on('console', m => console.log('console:', m.type(), m.text().slice(0, 200)));
  await syncAndCreate(page, 'sons of horus');
  await page.waitForTimeout(1500);
  console.log('sw controlled:', await page.evaluate(() => !!navigator.serviceWorker.controller));
  for (let i = 0; i < 5; i++) {
    await ctx.setOffline(true);
    const t0 = Date.now();
    await page.reload();
    const ok = await page.waitForSelector('.force', { timeout: 15000 }).then(() => true).catch(() => false);
    console.log('reload', i, ok, Date.now() - t0, 'ms');
    if (!ok) {
      const r = await page.evaluate(() => new Promise(res => { const q = indexedDB.open('muster'); q.onsuccess = () => res('open ok'); q.onerror = () => res('err ' + q.error); q.onblocked = () => res('blocked'); setTimeout(() => res('timeout'), 4000); }));
      console.log('idb probe:', r); console.log('url', page.url()); console.log('dom', (await page.evaluate(() => document.getElementById('app').innerHTML)).slice(0, 600));
    }
    await ctx.setOffline(false);
  }
};
