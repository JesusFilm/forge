import { defineConfig } from "eslint/config"
import js from "@eslint/js"
import tseslint from "typescript-eslint"
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended"
import reactHooksPlugin from "eslint-plugin-react-hooks"
import nextPlugin from "@next/eslint-plugin-next"

export default defineConfig(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/manager/**/*.tsx", "apps/manager/**/*.ts"],
    plugins: {
      "react-hooks": reactHooksPlugin,
      "@next/next": nextPlugin,
    },
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "@next/next/no-img-element": "warn",
    },
  },
  {
    files: ["apps/admin/**/*.tsx", "apps/admin/**/*.ts"],
    plugins: {
      "react-hooks": reactHooksPlugin,
      "@next/next": nextPlugin,
    },
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "@next/next/no-img-element": "warn",
    },
  },
  {
    // Keep exhaustive-deps enabled here so it matches apps/chat's own
    // next/core-web-vitals config — a directive valid in one lint pass
    // must not be an unknown rule or unused suppression in the other.
    files: ["apps/chat/**/*.tsx", "apps/chat/**/*.ts"],
    plugins: {
      "react-hooks": reactHooksPlugin,
      "@next/next": nextPlugin,
    },
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-img-element": "warn",
    },
  },
  {
    files: ["apps/rag/**/*.ts", "apps/rag/**/*.tsx"],
    rules: {
      "max-lines": [
        "error",
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "writable",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/roadmap/scripts/**/*.js", "apps/mobile/plugins/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "writable",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/mobile/plugins/**/*.test.js"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
      },
    },
  },
  eslintPluginPrettierRecommended,
)
