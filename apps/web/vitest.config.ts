import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    // Default environment is `node` to keep existing server-only tests
    // (e.g. route handlers using `@t3-oss/env-nextjs` server vars) green.
    // Tests that need a DOM should add `// @vitest-environment jsdom` at
    // the top of the test file (see
    // src/components/watch/__tests__/MuxPlayerSpike.test.tsx for an example).
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
  },
})
