import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': root,
      // `server-only` throws outside Next's server build; in tests it's a no-op.
      'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    // Live tests call real APIs and cost tokens: run them with `npm run test:live`.
    exclude: ['**/node_modules/**', '**/*.live.test.ts'],
  },
})
