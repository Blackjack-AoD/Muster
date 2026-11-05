import type { BrowserContext } from '@playwright/test';

export async function fakeGitHub(context: BrowserContext): Promise<void> {
  await context.route('https://api.github.com/**', (route) =>
    route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, json: {} }),
  );
}
