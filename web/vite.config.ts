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
  optimizeDeps: {
    include: ['react', 'react-dom', 'zustand', 'framer-motion', '@xyflow/react'],
    force: true,
  },
  server: {
    port: 8089,
    open: false,
    host: '0.0.0.0',
    allowedHosts: ['temp.docker.local', 'localhost', '0.0.0.0', '127.0.0.1', '5ba5992d.r5.cpolar.top'],
    hmr: false,
  },
})
