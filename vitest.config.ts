import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 120000,
    threads: false,
    isolate: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/infrastructure/inbound/cli/**/*.ts', 'src/domain/profile/source/**/*.ts'],
    },
    setupFiles: ['./tests/setup.ts'],
  },
})
