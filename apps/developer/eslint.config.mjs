import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"

import commonConfig from "../../eslint.config.mjs"

export default defineConfig([
  ...commonConfig,
  ...nextVitals,
  globalIgnores([
    ".next/**",
    ".prisma/**",
    "out/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),
])
