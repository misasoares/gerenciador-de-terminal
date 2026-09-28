import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'sem-git'
  }
})()
const BUILD_ID = `${commit}-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}`

export default defineConfig({
  main: {
    define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
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
