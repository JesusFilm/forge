import type { CodegenConfig } from "@graphql-codegen/cli"

const config: CodegenConfig = {
  schema: "https://api-gateway.central.jesusfilm.org",
  documents: ["src/**/*.ts"],
  ignoreNoDocuments: true,
  generates: {
    "./src/api/core-sync/gql/": {
      preset: "client",
      config: {
        skipTypename: true,
        useTypeImports: true,
        enumsAsTypes: true,
        optimizeDocumentNode: false,
      },
      presetConfig: {
        fragmentMasking: false,
      },
    },
  },
}

export default config
