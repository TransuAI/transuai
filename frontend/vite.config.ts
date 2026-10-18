import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      // Job 狀態的 WebSocket（notification-service），跟正式環境的 nginx 一樣走同一個網站
      '/ws': {
        target: 'ws://localhost:8085',
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    // 測試資料的時間是台灣時間（+08:00），畫面上的時間跟表單驗證都依瀏覽器的時區：固定成台灣，不管在哪裡跑（CI 的機器是 UTC）都一樣。
    env: { TZ: 'Asia/Taipei' },
    setupFiles: ['./src/test/setup.ts'],
  },
})
