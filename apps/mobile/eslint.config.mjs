import { defineConfig } from "eslint/config"
import commonConfig from "../../eslint.config.mjs"
import expoConfig from "eslint-config-expo/flat.js"

export default defineConfig([
  ...commonConfig,
  ...expoConfig,
  {
    ignores: [
      "node_modules/",
      ".expo/",
      "dist/",
      "web-build/",
      "**/.gitkeep",
      "assets/",
    ],
  },
  {
    files: ["jest.setup.js", "**/*.test.ts", "**/*.test.tsx"],
    languageOptions: {
      globals: {
        jest: "readonly",
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
])
