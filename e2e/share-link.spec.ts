import { devices, expect, test } from '@playwright/test';
import { buildList } from './build-list';
import { fakeGitHub } from './fake-github';

test('opens a share link as a read-only copy on a phone with no data', async ({ browser, context, page }) => {
  await fakeGitHub(context);
  // the path a phone takes: desktop browsers may have no navigator.share
  await page.addInitScript(() => {
    navigator.share = (data) => {
      sessionStorage.setItem('shared-link', data?.url ?? '');
      return Promise.resolve();
    };
  });
  await buildList(page);

  await page.getByRole('button', { name: 'List options' }).click();
  await page.getByRole('button', { name: /Army sheet/ }).click();
  await page.getByRole('button', { name: 'Share link' }).click();
  const sharedLink = () => page.evaluate(() => sessionStorage.getItem('shared-link') ?? '');
  await expect.poll(sharedLink).toContain('#/view/');

  const friend = await browser.newContext({ ...devices['Pixel 7'] });
  // the app syncs on first open: refusing it means the link alone must carry the list
  await friend.route(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, (route) => route.abort());
  const friendPage = await friend.newPage();
  await friendPage.goto(await sharedLink());

  await expect(friendPage.getByRole('heading', { name: 'Shared list' })).toBeVisible();
  await expect(friendPage.locator('.as-pts')).toHaveText('115 / 2,000 pts');
  const unit = friendPage.locator('.as-unit');
  await expect(unit).toHaveCount(1);
  await expect(unit.locator('.as-unit-head')).toHaveText('Centurion · HQ115');
  await expect(unit.locator('.as-gear')).toHaveText('Power Fist (15)');

  await expect(friendPage.getByRole('button')).toHaveText(['Open Muster', 'Print / save PDF', 'Share link']);
  await expect(friendPage.locator('input, select, textarea, [contenteditable]')).toHaveCount(0);

  await friend.close();
});
