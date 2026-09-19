import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shopguard/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
      '@shopguard/database': path.resolve(__dirname, '../../packages/database/src/index.ts'),
    },
  },
})
