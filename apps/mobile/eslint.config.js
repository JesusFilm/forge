const expoConfig = require("eslint-config-expo/flat")

module.exports = [
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
]
