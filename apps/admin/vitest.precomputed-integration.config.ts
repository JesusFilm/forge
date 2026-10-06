import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  root: resolve(__dirname, "../.."),
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@mastra/pg": resolve(__dirname, "../mastra/node_modules/@mastra/pg"),
      "@prisma/client": resolve(__dirname, "node_modules/@prisma/client"),
      pg: resolve(__dirname, "node_modules/pg"),
      vitest: resolve(__dirname, "node_modules/vitest"),
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/integration/precomputed-source-build.db.test.ts",
      "tests/integration/precomputed-catalog-build.db.test.ts",
    ],
    setupFiles: [resolve(__dirname, "vitest.setup.ts")],
  },
})
