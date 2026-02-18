import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended"

export default defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "out/**", "next-env.d.ts", "src/generated/**"]),
  eslintPluginPrettierRecommended,
])
