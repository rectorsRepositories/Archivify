import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const apiTarget = `http://127.0.0.1:${process.env.PORT || '3000'}`

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': apiTarget,
    },
  },
  preview: {
    host: '127.0.0.1',
    proxy: {
      '/api': apiTarget,
    },
  },
})
