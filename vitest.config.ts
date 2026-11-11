import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { testTimeout: process.env.CI ? 30_000 : 5_000, hookTimeout: process.env.CI ? 30_000 : 10_000, environment: 'node', include: ['tests/**/*.test.ts'] }
})
