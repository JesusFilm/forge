import { defineConfig, globalIgnores } from "eslint/config"
import commonConfig from "../../eslint.config.mjs"
import nextVitals from "eslint-config-next/core-web-vitals"

export default defineConfig([
  ...commonConfig,
  ...nextVitals,
  globalIgnores([".next/**", "out/**", "next-env.d.ts"]),
])
