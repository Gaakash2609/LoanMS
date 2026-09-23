import { defineConfig } from 'vitest/config'
import path from 'path'

// Dedicated Vitest config (kept separate from vite.config.ts so the production
// build config is untouched). Reuses the same `@` → src alias the app uses.
// Environment is Node — the RBAC tests exercise pure permission logic/data, no
// DOM — with a tiny localStorage shim (see src/test/setup.ts) so importing the
// permission hook's module graph (which transitively pulls the zustand auth
// store) is safe under Node.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
