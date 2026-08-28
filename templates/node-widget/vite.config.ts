import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 构建产物为单文件 ESM bundle（dist/node-widget.js），
// React 等依赖直接打入 bundle（自挂载契约，与 Studio 无共享依赖）。
// 在节点包 flowx.json 中声明： "ui": { "entry": "ui/node-widget.js" }
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: 'src/index.tsx',
      formats: ['es'],
      fileName: () => 'node-widget.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
    outDir: 'dist',
    minify: 'esbuild',
  },
})
