import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { createRefreshHandler } from './server/api.mjs'
import { createRosterHandler } from './server/roster.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))

// Adds POST /api/refresh and the roster endpoints (/api/roster, /api/users/search) to the dev server. Credentials come from .env and never reach the browser.
function jiraRefreshApi() {
  return {
    name: 'jira-refresh-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, root, '')
      server.middlewares.use(createRefreshHandler({ root, env }))
      server.middlewares.use(createRosterHandler({ root, env }))
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), jiraRefreshApi()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, host: '127.0.0.1' },
  test: { environment: 'node', globals: true },
})
