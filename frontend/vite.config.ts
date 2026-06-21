import { defineConfig, type UserConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      // 后端 API 代理（含 WebSocket，支持 /api/ws/status 等端点）
      '/api': {
        target: 'http://localhost:9988',
        changeOrigin: true,
        ws: true,
      },
      // ComfyUI WebSocket 代理（/ws?clientId=xxx）
      '/ws': {
        target: 'http://127.0.0.1:8188',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    // 生产环境禁止 source map
    sourcemap: false,
    // 代码分割：将大型依赖拆分为独立 chunk
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/vue') || id.includes('node_modules/pinia')) {
            return 'vendor-vue';
          }
          if (id.includes('node_modules/lodash') || id.includes('node_modules/crypto-js')) {
            return 'vendor-utils';
          }
        },
      },
    },
  },
  // 生产构建时移除 console 和 debugger
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  } as UserConfig['esbuild'],
})
