import path from "path"
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createLocalAdapter } from './src/backend/localAdapter'

const localAdapterPlugin = (): Plugin => ({
  name: 'local-adapter',
  configureServer(server) {
    server.middlewares.use(createLocalAdapter());
  }
});

const firebaseMessagingPlugin = (): Plugin => {
  const filename = 'firebase-messaging-sw.js'
  let source: (() => string) | undefined

  return {
    name: 'firebase-messaging-worker',
    configResolved({ env, root }) {
      if (!env.VITE_FIREBASE_API_KEY) return
      const config = {
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'm14u-js.firebaseapp.com',
        projectId: env.VITE_FIREBASE_PROJECT_ID || 'm14u-js',
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'm14u-js.firebasestorage.app',
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '102126601252',
        appId: env.VITE_FIREBASE_APP_ID || '1:102126601252:web:dada5103b4d382e1f604b1',
        measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || 'G-SG98J8L065',
      }
      source = () => readFileSync(path.join(root, 'src', filename), 'utf8')
        .replace('firebase.initializeApp(__FIREBASE_WEB_CONFIG__)', () =>
          `firebase.initializeApp(${JSON.stringify(config)})`)
    },
    configureServer(server) {
      server.middlewares.use(`/${filename}`, (_req, res, next) => {
        if (!source) return next()
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(source())
      })
    },
    generateBundle() {
      if (source) this.emitFile({ type: 'asset', fileName: filename, source: source() })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), localAdapterPlugin(), firebaseMessagingPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // host: false,
    // watch: null,
    // Allow Cloudflare tunnel domains (and any other reverse proxy) to pass
    // Vite's host check. `true` permits all hosts without hardcoding ephemeral URLs.
    allowedHosts: true,
  },
  optimizeDeps: {
    exclude: ['@anthropic-ai/sdk']
  }
})
