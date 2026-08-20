import { defineConfig, globalIgnores } from "eslint/config"
import commonConfig from "../../eslint.config.mjs"
import nextVitals from "eslint-config-next/core-web-vitals"

export default defineConfig([
  ...commonConfig,
  ...nextVitals,
  {
    // feat-209 KTD6: leaving a denial screen is a deliberate cross-document
    // navigation that re-resolves identity/gate server-side — never <Link>.
    // Config-level (not inline) because the rule only fires when eslint runs
    // from this app dir; from the repo root (lint-staged) inline disables
    // read as unused directives and fail --max-warnings=0.
    files: [
      "src/components/chat/denial-screens.tsx",
      "src/components/shell/sidebar-new-conversation.tsx",
    ],
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
  globalIgnores([".next/**", "out/**", "next-env.d.ts", ".tmp/**"]),
])
