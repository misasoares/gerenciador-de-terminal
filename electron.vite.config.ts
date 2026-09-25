import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          daemon: resolve(__dirname, 'src/daemon/main.ts'),
        },
      },
    },
  },
  preload: {},
  renderer: { plugins: [react()] },
})
