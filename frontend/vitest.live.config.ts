import { defineConfig } from 'vitest/config'
import base from './vitest.config'

// Only the live tests (real API calls). Run with `npm run test:live`.
// Fields are replaced, not merged: mergeConfig would concatenate the base
// exclude list, which excludes exactly these files.
export default defineConfig({
  ...base,
  test: { ...base.test, include: ['lib/**/*.live.test.ts'], exclude: ['**/node_modules/**'] },
})
