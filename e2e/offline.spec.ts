import { expect, test } from '@playwright/test';
import { buildList } from './build-list';
import { fakeGitHub } from './fake-github';

test('opens a saved list after reloading offline', async ({ context, page }) => {
  await fakeGitHub(context);
  await buildList(page);
  await page.getByRole('button', { name: 'Back' }).click();

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // the app and the data must come from the phone, so nothing may answer for GitHub now
  await context.unrouteAll();
  await context.setOffline(true);
  await page.reload();

  await page.locator('.roster-card').click();
  await expect(page.locator('.unit-row', { hasText: 'Centurion' })).toContainText('115');
  await expect(page.locator('.sum-bar .pts')).toHaveText('115/2,000pts');
});
