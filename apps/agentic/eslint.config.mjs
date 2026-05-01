import { defineConfig, globalIgnores } from "eslint/config"

import commonConfig from "../../eslint.config.mjs"

export default defineConfig([
  ...commonConfig,
  globalIgnores([".mastra/**", "dist/**"]),
])
