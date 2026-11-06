import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['.multica/inspection-23/repro.test.ts'] } })
