import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

const BACKEND = 'http://localhost:8080'


const presentAsLocal = (proxy) => {
  proxy.on('proxyReq', (request) => request.setHeader('origin', 'http://localhost:5173'))
  proxy.on('proxyReqWs', (request) => request.setHeader('origin', 'http://localhost:5173'))
}

export default defineConfig(({ mode }) => {
  // `npm run dev:phone`: serve over HTTPS on the local network so a phone on
  // the same Wi-Fi can open the app and use its location.
  const phone = mode === 'phone'
  const https =
    phone && existsSync('certs/dev-key.pem')
      ? { key: readFileSync('certs/dev-key.pem'), cert: readFileSync('certs/dev-cert.pem') }
      : undefined

  return {
    plugins: [react(), tailwindcss()],
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
