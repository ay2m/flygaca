import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { FLAVORS, toFlavorId } from './src/flavors/registry.ts';

/**
 * Inject search-engine ownership-verification <meta> tags into the initial HTML,
 * but only when the matching token env var is set — so the shipped index.html
 * stays clean for forks/previews that don't own the Search Console property.
 */
function verificationMeta(env: Record<string, string>): Plugin {
  const tags = [
    ['google-site-verification', env.VITE_GSC_TOKEN],
    ['msvalidate.01', env.VITE_BING_TOKEN],
  ]
    .filter(([, token]) => token)
    .map(([name, token]) => `    <meta name="${name}" content="${token}" />`)
    .join('\n');
  return {
    name: 'flygaca-verification-meta',
    transformIndexHtml(html) {
      return tags ? html.replace('</head>', `${tags}\n  </head>`) : html;
    },
  };
}

// https://vite.dev/config/  (test config lives in vitest.config.ts)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'SUPABASE_']);
  // Standalone prep-app (flavor) builds — set by scripts/build-flavor.mjs. The
  // default web build resolves to `main`, whose registry entry mirrors the
  // manifest literals this file used to inline (tests/flavors.test.ts pins
  // that), so the shipped main manifest is unchanged.
  const flavor = FLAVORS[toFlavorId(env.VITE_APP_FLAVOR) ?? 'main'];
  const isFlavorApp = flavor.id !== 'main';
  return {
    envPrefix: ['VITE_', 'SUPABASE_'],
    // Flavor builds swap the public payload for the staged per-pack slice so
    // the service-worker precache manifest sees only that pack's data.
    publicDir: isFlavorApp ? `.flavor/${flavor.id}/public` : 'public',
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Split the stable framework libraries into their own long-cached
          // chunks so the app chunk stays lean and a release only busts the
          // app bundle, not React/router/i18n.
          // Function form: React 19 moved the renderer into react-dom/client
          // internals, which the object form (package roots only) missed —
          // ~100 kB of renderer fell into the index chunk. Path-matching the
          // whole package directory keeps the split stable across versions.
          // framer-motion is intentionally NOT pinned: it is reached only
          // through lazily-imported components (the home dashboard + WhyBento
          // and lazy routes), so leaving it alone lets Rollup fold it into
          // those async chunks, off the initial path (check:bundle enforces
          // the budget either way).
          // firebase IS pinned: the SDK is dynamic-imported from
          // src/lib/firebase-monitoring.ts, and a named chunk keeps the ~100 kB
          // async payload long-cached across app releases.
          manualChunks(id: string) {
            if (
              /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(
                id,
              )
            ) {
              return 'vendor-react';
            }
            if (
              /node_modules[\\/](i18next|react-i18next|html-parse-stringify|void-elements)[\\/]/.test(
                id,
              )
            ) {
              return 'vendor-i18n';
            }
            if (/node_modules[\\/](firebase|@firebase)[\\/]/.test(id)) {
              return 'vendor-firebase';
            }
          },
        },
      },
    },
    plugins: [
      react(),
      verificationMeta(env),
      VitePWA({
        // 'prompt' so a waiting service worker surfaces an in-app "reload to update"
        // toast (see src/components/pwa/PwaPrompts) instead of swapping silently.
        registerType: 'prompt',
        includeAssets: ['img/favicon.ico', 'img/flygaca-mark.png'],
        manifest: {
          id: '/',
          name: flavor.manifest.name,
          short_name: flavor.manifest.shortName,
          description: flavor.manifest.description,
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: flavor.manifest.themeColor,
          theme_color: flavor.manifest.themeColor,
          lang: 'en',
          dir: 'ltr',
          categories: ['education', 'reference', 'travel'],
          icons: [
            {
              src: 'img/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any maskable',
            },
            {
              src: 'img/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable',
            },
          ],
          // A flavor app IS one study surface — the main app's Library/Chat/
          // Tools shortcuts point at routes that don't exist there.
          shortcuts: isFlavorApp
            ? undefined
            : [
                {
                  name: 'Library',
                  url: '/library',
                  icons: [{ src: 'img/icon-192.png', sizes: '192x192' }],
                },
                {
                  name: 'Captain Adel',
                  url: '/chat',
                  icons: [{ src: 'img/icon-192.png', sizes: '192x192' }],
                },
                {
                  name: 'Flight tools',
                  url: '/tools',
                  icons: [{ src: 'img/icon-192.png', sizes: '192x192' }],
                },
              ],
        },
        workbox: {
          // Main build: the regulatory JSON corpus is large; precache the app
          // shell only and serve data with a network-first runtime strategy so
          // it stays fresh but remains available offline (mirrors the old
          // freshness-aware sw.js). Flavor build: the staged slice is a few MB,
          // so precache EVERYTHING — the prep app must work fully offline from
          // first launch (and the native shell carries the files in-bundle).
          globPatterns: isFlavorApp
            ? [
                '**/*.{js,css,woff2,png,svg,ico,webp}',
                'index.html',
                'data/**/*.{json,html}',
                'study-sheets/*.pdf',
                'manifest-ar.webmanifest',
              ]
            : ['**/*.{js,css,woff2,png,svg,ico,webp}', 'index.html'],
          globIgnores: isFlavorApp ? [] : ['**/data/**'],
          maximumFileSizeToCacheInBytes: (isFlavorApp ? 16 : 4) * 1024 * 1024,
          // Offline navigations to deep client routes (e.g. /library/...) resolve
          // to the precached SPA shell; /api and /data are excluded so the proxy
          // and the network-first data rules below keep handling them.
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/data\//],
          // Purge superseded precaches from earlier releases on activate.
          cleanupOutdatedCaches: true,
          // Two-tier network-first data cache (first match wins). Both stay
          // network-first so online reads are always freshest; the split keeps the
          // few very large/volatile files (the ~19 MB search index, the ~21 MB
          // worldwide airports set, chart JPGs) in their own bounded cache so they
          // can't evict the regulatory docs a pilot explicitly saved for offline.
          runtimeCaching: [
            {
              // Rule A — heavy/volatile assets, isolated so they don't crowd out
              // the regulatory corpus or blow the storage quota. Matches the
              // `/data/<file>` segment anywhere in the path, so it covers both
              // same-origin `/data/…` and an off-host data bucket
              // (`https://…/data/…`, see VITE_DATA_BASE_URL).
              urlPattern: ({ url }) =>
                /\/data\/(library-search\.json|airports(-extra)?\.json|charts\/)/.test(
                  url.pathname,
                ),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'flygaca-data-heavy',
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Rule B — the regulatory corpus: Parts/library/ebook HTML plus the
              // small JSON indexes. Shares the `flygaca-data` cache that
              // offlineCache.saveDoc warms, so explicitly-saved docs, auto-cached
              // bookmarks and incidentally-fetched pages all live together. The
              // entry ceiling is high enough for all 74 GACAR Parts + their index
              // + bookmarks without LRU-evicting a saved doc. `includes('/data/')`
              // (not `startsWith`) so it also matches an off-host data bucket.
              urlPattern: ({ url }) => url.pathname.includes('/data/'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'flygaca-data',
                // Fall back to cache quickly when offline/slow instead of hanging.
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 350, maxAgeSeconds: 60 * 60 * 24 * 30 },
                // Only cache successful (or opaque) responses, never errors.
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
  };
});
