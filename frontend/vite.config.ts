import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// ROOT CUTOVER: base is '/' for every command now. The React app is served
// from the site root by LoanMS.API/Program.cs (it used to be mounted under
// /app, with the legacy vanilla shell holding '/'), so built asset URLs must
// be /assets/* rather than /app/assets/*. `import.meta.env.BASE_URL` follows
// this value automatically, which is what keeps the logo <img> paths in
// LoginPage/ForgotPasswordPage/ResetPasswordPage correct without touching
// them. Dev server behaviour at http://localhost:5173 is unchanged.
// Dev-only API proxy target. The backend's usual dev port is 7070, but that
// port collides with common local software (e.g. AnyDesk listens on 7070 by
// default), and when it is taken the .NET API cannot bind it *and* every
// `/api` call from `npm run dev` silently proxies to whatever else holds the
// port — so the React app renders with no auth and no data and looks nothing
// like the real thing. Make the target overridable so a colliding machine can
// point dev at a free port without editing this file:
//   VITE_API_TARGET=http://localhost:5099 npm run dev
// (and run the API on that same port). Falls back to 5099 when unset, since
// the API's own dev port was moved off 7070 for the same AnyDesk-collision
// reason described above.
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:5099'

export default defineConfig(() => ({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        secure: false,
      },
      '/health': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../LoanMS.API/wwwroot/react',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
          query: ['@tanstack/react-query'],
          ui: ['lucide-react'],
        },
      },
    },
  },
}))
