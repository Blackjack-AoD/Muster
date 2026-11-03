(async () => {
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const svg = readFileSync('public/icon.svg', 'utf8');
const b = await chromium.launch();
const p = await b.newPage();
async function shot(size, out, pad = 0, bg = '#0e0f12') {
  await p.setViewportSize({ width: size, height: size });
  const inner = size - pad * 2;
  await p.setContent(`<html><body style="margin:0;background:${bg}"><div style="padding:${pad}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await p.screenshot({ path: out, omitBackground: false });
}
await shot(192, 'public/icon-192.png');
await shot(512, 'public/icon-512.png');
await shot(512, 'public/icon-maskable-512.png', 56);
await shot(180, 'public/apple-touch-icon.png');
await b.close();
})();
