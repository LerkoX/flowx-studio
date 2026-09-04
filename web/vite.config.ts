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
  // vendor 分包：基础库独立 chunk，利于长期缓存；xyflow 仅画布页用到，
  // 配合路由懒加载使首屏不再下载画布渲染库
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'framer-motion': ['framer-motion'],
          xyflow: ['@xyflow/react'],
        },
      },
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
    allowedHosts: true,
    hmr: false,
  },
})
