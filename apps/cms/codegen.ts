import type { CodegenConfig } from "@graphql-codegen/cli"

const config: CodegenConfig = {
  schema: "https://api-gateway.central.jesusfilm.org/",
  documents: "src/api/gateway-sync/**/*.graphql",
  generates: {
    "src/api/gateway-sync/generated/gateway-types.ts": {
      plugins: ["typescript", "typescript-operations"],
      config: {
        skipTypename: true,
        avoidOptionals: false,
        maybeValue: "T | null",
      },
    },
  },
}

export default config
