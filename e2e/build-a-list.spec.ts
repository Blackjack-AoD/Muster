import { expect, test } from '@playwright/test';
import { fakeGitHub } from './fake-github';

test('downloads data, builds a list and shows its points', async ({ context, page }) => {
  await fakeGitHub(context);
  await page.goto('/');

  const newList = page.getByRole('button', { name: 'New list' });
  await expect(newList).toBeVisible();
  await newList.click();
  await page.getByRole('button', { name: 'Test Army' }).click();
  await page.getByRole('button', { name: 'Create list' }).click();

  await page.getByRole('button', { name: 'Add HQ' }).click();
  await page.getByRole('button', { name: /Centurion/ }).click();
  await expect(page.getByRole('heading', { name: 'Centurion' })).toBeVisible();
  await expect(page.locator('.topbar .pts')).toHaveText('100pts');

  await page.getByRole('checkbox', { name: /Power Fist/ }).click();
  await expect(page.locator('.topbar .pts')).toHaveText('115pts');

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.unit-row', { hasText: 'Centurion' })).toContainText('115');
  await expect(page.locator('.sum-bar .pts')).toHaveText('115/2,000pts');
});
