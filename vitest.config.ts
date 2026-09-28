import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify('test') },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 20_000, pool: 'forks' },
})
