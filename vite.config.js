import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const BACKEND = 'http://localhost:8080'


// Installable app (PWA): manifest, icons and offline caching.
const pwa = VitePWA({
  registerType: 'autoUpdate',
  includeAssets: ['brand/logo.svg', 'brand/icon-180.png'],
  manifest: {
    name: 'COS Indoor Navigation',
    short_name: 'COS Nav',
    description: 'Find your way around the College of Science, KNUST.',
    lang: 'en',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b6e3b',
    theme_color: '#0b6e3b',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/brand/logo.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  },
  workbox: {
    // The app itself is saved on the phone; the floor plans are cached on
    // first view and refreshed in the background.
    globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
    // mine.png is the full-size original of owner-logo.png; the app never loads it.
    globIgnores: ['maps/**', 'brand/mine.png'],
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/api\//],
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.pathname.startsWith('/maps/'),
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'floor-plans', expiration: { maxEntries: 20 } },
      },
      {
        // Room search: live when online, last results when the signal drops.
        urlPattern: ({ url }) => url.pathname.endsWith('/rooms/search') || url.pathname.endsWith('/rooms/nearest'),
        handler: 'NetworkFirst',
        options: { cacheName: 'room-search', networkTimeoutSeconds: 4, expiration: { maxEntries: 100, maxAgeSeconds: 7 * 24 * 3600 } },
      },
      // Navigation and the journey websocket are always live (not cached).
    ],
  },
})

const presentAsLocal = (proxy) => {
  proxy.on('proxyReq', (request) => request.setHeader('origin', 'http://localhost:5173'))
  proxy.on('proxyReqWs', (request) => request.setHeader('origin', 'http://localhost:5173'))
}

export default defineConfig(({ mode }) => {

  const phone = mode === 'phone'
  const https =
    phone && existsSync('certs/dev-key.pem')
      ? { key: readFileSync('certs/dev-key.pem'), cert: readFileSync('certs/dev-cert.pem') }
      : undefined

  return {
    plugins: [react(), tailwindcss(), pwa],
    server: {
      host: phone ? true : undefined,
      https,
      // The app calls /api on its own origin; the dev server forwards it to
      // the Go backend, so the phone never needs to reach port 8080 itself.
      proxy: {
        '/api': {
          target: BACKEND,
          changeOrigin: true,
          ws: true,
          configure: presentAsLocal,
        },
      },
    },
  }
})
