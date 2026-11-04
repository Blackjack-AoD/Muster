const { chromium, devices } = require('playwright');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const DATA = { 'Blackjack-AoD/NRData': '../data/NRData', 'Blackjack-AoD/M40GA': '../data/M40GA' };
const tree = (dir) => execSync(`git -C ${dir} ls-tree -r -l HEAD`).toString().trim().split('\n').map(l => { const [meta, path] = l.split('\t'); const [, type, sha, size] = meta.split(/\s+/); return { path, type, sha, size: Number(size) }; });
const shots = process.env.SHOTS || 'shots'; fs.mkdirSync(shots, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 2 });
  await ctx.route('https://api.github.com/**', async (route) => {
    const u = new URL(route.request().url()); const m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)(.*)$/);
    const repo = m[1], rest = m[2], dir = DATA[repo];
    if (!dir) return route.fulfill({ status: 404, body: '{}' });
    const head = execSync(`git -C ${dir} rev-parse HEAD`).toString().trim();
    let body;
    if (!rest) body = { default_branch: 'main' };
    else if (rest.startsWith('/branches/')) body = { commit: { sha: head } };
    else if (rest.startsWith('/git/trees/')) body = { tree: tree(dir) };
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  await ctx.route('https://raw.githubusercontent.com/**', (route) => {
    const u = new URL(route.request().url()); const parts = u.pathname.split('/').map(decodeURIComponent);
    const repo = parts[1] + '/' + parts[2]; const path = parts.slice(4).join('/');
    route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(`${DATA[repo]}/${path}`) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  global.page = page; global.ctx = ctx; global.shots = shots; global.errors = errors;
  try { await require(process.argv[2])(page, ctx, shots); }
  catch (e) { console.log('FAILED:', e.message); await page.screenshot({ path: `${shots}/fail.png` }); }
  console.log('errors:', errors.slice(0, 10));
  await browser.close();
})();
