import { defineConfig, globalIgnores } from "eslint/config"
import common from "../../eslint.config.mjs"
import nextVitals from "eslint-config-next/core-web-vitals"

export default defineConfig([
  ...common,
  ...nextVitals.map((config) =>
    config.name === "next/typescript"
      ? Object.fromEntries(
          Object.entries(config).filter(([key]) => key !== "plugins"),
        )
      : config,
  ),
  globalIgnores([".next/**", "next-env.d.ts"]),
])
