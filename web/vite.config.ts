import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 8089,
    open: false,
    host: '0.0.0.0',
    allowedHosts: ['temp.docker.local', 'localhost', '0.0.0.0', '127.0.0.1'],
    hmr: false,
  },
})
