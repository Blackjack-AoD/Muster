import { vi } from 'vitest';

interface Remote {
  tree: { path: string; sha: string; type?: string; size?: number }[];
  bodies: Record<string, string | Uint8Array>;
}

/** A stand-in for GitHub that records each URL asked for. `fail` maps a URL part to a response status. */
export function github(remote: Remote, fail: Record<string, number> = {}) {
  const calls: string[] = [];
  const f = vi.fn(async (url: string) => {
    calls.push(url);
    for (const [part, status] of Object.entries(fail)) if (url.includes(part)) return new Response('', { status });
    const u = new URL(url);
    if (u.hostname === 'raw.githubusercontent.com') {
      const path = u.pathname.split('/').slice(4).map(decodeURIComponent).join('/');
      return new Response(remote.bodies[path] as BodyInit);
    }
    if (u.pathname.endsWith('/branches/main')) return Response.json({ commit: { sha: 'c1' } });
    if (u.pathname.includes('/git/trees/'))
      return Response.json({ tree: remote.tree.map((t) => ({ type: 'blob', size: 0, ...t })) });
    return Response.json({ default_branch: 'main' });
  });
  vi.stubGlobal('fetch', f);
  return calls;
}
