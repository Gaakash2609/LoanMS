import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
// base: '/app/' only for production builds (matches the /app mount point in
// LoanMS.API/Program.cs). Local dev server keeps serving from root ('/') so
// `npm run dev` at http://localhost:5173 continues to work unchanged.
export default defineConfig(({ command }) => ({
    base: command === 'build' ? '/app/' : '/',
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
                target: 'http://localhost:7070',
                changeOrigin: true,
                secure: false,
            },
            '/health': {
                target: 'http://localhost:7070',
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
}));
