/// <reference lib="webworker" />

import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist, NetworkOnly, NetworkFirst, ExpirationPlugin } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Plugin de auditoria de diagnóstico para navegação offline/online
const navigationDiagnosticPlugin = {
  async cachedResponseWillBeUsed({ cachedResponse, request }: { cachedResponse?: Response | null; request: Request }) {
    if (cachedResponse && (request?.mode === 'navigate' || request?.destination === 'document')) {
      console.info('[PWA NAVIGATION CACHE HIT]', request.url);
    }
    return cachedResponse;
  },
  async handlerDidError({ error, request }: { error: unknown; request: Request }) {
    if (request?.mode === 'navigate' || request?.destination === 'document') {
      console.info('[PWA NAVIGATION NETWORK FALLBACK]', { url: request.url, error: String(error) });
    }
    return undefined;
  },
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    cleanupOutdatedCaches: true,
    concurrency: 10,
    ignoreURLParametersMatching: [/^utm_/, /^fbclid$/],
    navigateFallback: '/',
    navigateFallbackDenylist: [/^\/api\//, /^\/_next\/static\//],
    plugins: [navigationDiagnosticPlugin],
  },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // REGRA CRÍTICA: Supabase NUNCA deve ser cacheado no Cache Storage
    // O banco offline do projeto é única e exclusivamente o IndexedDB
    {
      matcher: ({ url }) => url.hostname.includes('supabase.co'),
      handler: new NetworkOnly(),
    },
    // Navegação Principal (App Shell)
    // Tenta rede primeiro (timeout 3s); se falhar (offline / firewall), usa o App Shell em cache
    {
      matcher: ({ request, url, sameOrigin }) =>
        sameOrigin &&
        (request.mode === 'navigate' || request.destination === 'document') &&
        !url.pathname.startsWith('/api/'),
      handler: new NetworkFirst({
        cacheName: 'app-shell-navigation',
        plugins: [
          new ExpirationPlugin({
            maxEntries: 16,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 dias
          }),
          navigationDiagnosticPlugin,
        ],
        networkTimeoutSeconds: 3,
      }),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: '/',
        matcher({ request }) {
          return request.destination === 'document' || request.mode === 'navigate';
        },
      },
    ],
  },
});

serwist.addEventListeners();

