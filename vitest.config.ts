import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['main/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      // Solo la lógica pura; el resto de main/ depende de electron.
      include: ['main/config.ts', 'main/device-store.ts'],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
})
