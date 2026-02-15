import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  // Global ignores - excluded from all linting
  {
    ignores: [
      // Generated clients (per AGENTS.md - read-only artifacts)
      "packages/clients/**",
      // Build outputs
      "**/dist/**",
      "**/.next/**",
      "**/build/**",
      "**/coverage/**",
      // Dependencies
      "**/node_modules/**",
      // Mobile (separate lint tools)
      "mobile/**",
      // Infra (Terraform)
      "infra/**",
    ],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended rules
  ...tseslint.configs.recommended,

  // Global settings for all JS/TS files
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      // Phase 1: Baseline rules (syntax, undefined vars, unsafe async)
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-undef": "error",

      // Async safety
      "no-async-promise-executor": "error",
      "require-await": "off",
      "@typescript-eslint/require-await": "off",

      // Allow empty functions for placeholders
      "@typescript-eslint/no-empty-function": "off",
    },
  },

  // MJS files - no TS rules
  {
    files: ["**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  }
);
