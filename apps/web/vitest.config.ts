import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      // server-only throws at import time; stub it out so vitest can load
      // server-helper modules (the guard is only meaningful at Next.js
      // build time, not inside the test runner).
      "server-only": resolve(__dirname, "src/__mocks__/server-only.ts"),
    },
  },
  test: {
    // Default environment is `node` to keep existing server-only tests
    // (e.g. route handlers using `@t3-oss/env-nextjs` server vars) green.
    // Tests that need a DOM should add `// @vitest-environment jsdom` at
    // the top of the test file.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
  },
})
