import { expect, type Page } from '@playwright/test';

/** From a fresh app, builds a 2,000 point list holding a 115 point Centurion, and stays on the list. */
export async function buildList(page: Page): Promise<void> {
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
}
