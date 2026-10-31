import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Núcleo del proxy y de la caché de catálogo (fase 2), y la lógica de cantidades, balanza y panel de peso.
      // types.ts solo tiene tipos (sin código ejecutable).
      include: ['src/lib/runtime.ts', 'src/lib/backend-proxy.ts', 'src/lib/data-layer.ts', 'src/lib/catalog/**/*.ts', 'src/lib/outbox/**/*.ts', 'src/lib/device/**/*.ts', 'src/lib/entitlement/**/*.ts', 'src/lib/quantity.ts', 'src/lib/money.ts', 'src/lib/scale/**/*.ts', 'src/app/pos/lib/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/test/**', 'src/lib/catalog/types.ts', 'src/lib/outbox/types.ts', 'src/lib/scale/types.ts', 'src/app/pos/lib/__tests__/**'],
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
    },
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
})
