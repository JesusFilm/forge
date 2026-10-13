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
      zod: resolve(__dirname, "node_modules/zod"),
    },
  },
  test: {
    environment: "node",
    // The disposable schemas share PostgreSQL's database-scoped extensions.
    fileParallelism: false,
    env: {
      RECOMMENDATION_SEMANTIC_SERVING_ENABLED: "true",
      // Synthetic native-fixture key, never a deployed credential.
      RECOMMENDATION_CAPABILITY_KEYRING: JSON.stringify({
        keys: [
          {
            kid: "catalog-native-fixture",
            status: "active",
            key: Buffer.alloc(32, 33).toString("base64url"),
          },
        ],
      }),
    },
    include: [
      "tests/integration/precomputed-source-build.db.test.ts",
      "tests/integration/precomputed-catalog-build.db.test.ts",
    ],
    setupFiles: [resolve(__dirname, "vitest.setup.ts")],
  },
})
