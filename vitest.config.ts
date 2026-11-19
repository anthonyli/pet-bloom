import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  // Next keeps tsconfig jsx as preserve. Vitest still has to transform the shop dialog.
  oxc: { jsx: { runtime: 'automatic' } },
  test: { execArgv: process.platform === 'win32' ? ['--expose-gc'] : [], testTimeout: process.env.CI ? 30_000 : 5_000, hookTimeout: process.env.CI ? 30_000 : 10_000, environment: 'node', include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] }
})
