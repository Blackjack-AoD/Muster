import { defineConfig, devices } from '@playwright/test';

// vite preview's own default port
const PORT = 4173;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: '.',
  use: { ...devices['Pixel 7'], baseURL },
  // the built site, so a failure can't come from a leftover server or the dev build
  webServer: { command: `npm run preview -- --port ${PORT} --strictPort`, url: baseURL },
});
