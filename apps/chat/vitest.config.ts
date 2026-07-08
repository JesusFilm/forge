import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      // server-only throws at import time; stub it out so vitest can load
      // server-helper modules (the guard is only meaningful at Next.js
      // build time, not inside the test runner). Mirrors apps/web.
      "server-only": resolve(__dirname, "src/__mocks__/server-only.ts"),
    },
  },
  test: {
    // jsdom is the app default: chat tests use React Testing Library (a
    // deliberate divergence from apps/web and apps/admin — see CLAUDE.md).
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
})
