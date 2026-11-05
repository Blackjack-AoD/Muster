import type { BrowserContext } from '@playwright/test';

const COMMIT = 'fixture-commit';
const CORS = { 'access-control-allow-origin': '*' };

// The app downloads both default repos on first open, so both must answer.
const REPOS: Readonly<Record<string, readonly string[]>> = {
  'Blackjack-AoD/NRData': ['test-game.gst', 'test-army.cat'],
  'Blackjack-AoD/M40GA': [],
};

function apiResponse(rest: string, files: readonly string[]): unknown {
  if (rest.startsWith('/branches/')) return { commit: { sha: COMMIT } };
  if (rest.startsWith('/git/trees/'))
    return { tree: files.map((path) => ({ path, type: 'blob', sha: path, size: 0 })) };
  return { default_branch: 'main' };
}

/** Answers the calls `syncRepo` makes, from the files in e2e/fixture. A repo it doesn't know is a 404. */
export async function fakeGitHub(context: BrowserContext): Promise<void> {
  await context.route('https://api.github.com/**', (route) => {
    const { pathname } = new URL(route.request().url());
    const [, repo = '', rest = ''] = pathname.match(/^\/repos\/([^/]+\/[^/]+)(.*)$/) ?? [];
    const files = REPOS[repo];
    if (!files) return route.fulfill({ status: 404, headers: CORS, json: {} });
    return route.fulfill({ headers: CORS, json: apiResponse(rest, files) });
  });
  await context.route(`https://raw.githubusercontent.com/*/*/${COMMIT}/*`, (route) => {
    const file = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    // relative to the repo root, where `npm run e2e` starts
    return route.fulfill({ headers: CORS, path: `e2e/fixture/${file}` });
  });
}
