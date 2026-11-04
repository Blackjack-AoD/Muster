import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  // relative base so it works on GitHub Pages (/<repo>/) or any sub-path
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      // registered in src/update.ts, which also reloads once an update has installed
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Muster: Army Lists',
        short_name: 'Muster',
        description: 'Offline army list builder for BattleScribe / New Recruit data',
        theme_color: '#0e0f12',
        background_color: '#0e0f12',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        // a new version takes over as soon as it has downloaded (src/update.ts then reloads the page once)
        skipWaiting: true,
        clientsClaim: true,
        // data lives in IndexedDB; never cache GitHub responses in the service worker
        runtimeCaching: [],
      },
    }),
  ],
});
