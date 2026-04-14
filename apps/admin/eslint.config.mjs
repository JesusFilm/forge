import { defineConfig, globalIgnores } from "eslint/config"
import commonConfig from "../../eslint.config.mjs"
import nextVitals from "eslint-config-next/core-web-vitals"

export default defineConfig([
  ...commonConfig,
  ...nextVitals,
  globalIgnores([".next/**", "out/**", "next-env.d.ts"]),
  {
    // Envelop plugins follow the `use*` naming convention which collides
    // with react-hooks/rules-of-hooks. Disable the rule for plugin files.
    files: ["src/graphql/plugins/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
])
