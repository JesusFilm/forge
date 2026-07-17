import { defineConfig, globalIgnores } from "eslint/config"
import commonConfig from "../../eslint.config.mjs"

export default defineConfig([
  ...commonConfig,
  globalIgnores(["dist/**", "node_modules/**"]),
])
