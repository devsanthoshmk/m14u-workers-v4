import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
})
