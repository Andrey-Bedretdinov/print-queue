import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5273, strictPort: true },
  plugins: [
    react(),
    // PQ_WEB=1 serves only the renderer, with src/lib/mock.ts standing in for
    // the preload bridge — handy for pure UI work in a browser.
    ...(process.env.PQ_WEB ? [] : [electron({
      main: {
        entry: 'electron/main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: { external: ['electron'] },
          },
        },
      },
      preload: {
        input: 'electron/preload/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            rollupOptions: {
              external: ['electron'],
              output: { format: 'cjs', entryFileNames: 'index.js' },
            },
          },
        },
      },
    })]),
  ],
})
