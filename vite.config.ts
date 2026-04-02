import path from "path"
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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), localAdapterPlugin()],
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
  },
  build: {
    sourcemap: true,
    minify: false,
  }
})
