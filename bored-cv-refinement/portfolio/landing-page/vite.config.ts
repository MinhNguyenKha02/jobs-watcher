import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    esbuildOptions: {
      logOverride: {
        "duplicate-object-key": "silent",
      },
    },
  },
  server: {
    port: 0,
  },
})
