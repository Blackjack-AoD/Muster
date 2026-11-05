import { expect, test } from '@playwright/test';
import { buildList } from './build-list';
import { fakeGitHub } from './fake-github';

test('downloads data, builds a list and shows its points', async ({ context, page }) => {
  await fakeGitHub(context);
  await buildList(page);

  await expect(page.locator('.sum-bar .pts')).toHaveText('115/2,000pts');
});
