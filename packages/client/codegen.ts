import type { CodegenConfig } from "@graphql-codegen/cli"

const config: CodegenConfig = {
  schema: "../../apps/cms/schema.graphql",
  generates: {
    "./src/generated/graphql.ts": {
      plugins: [
        { add: { content: "// AUTO-GENERATED FILE. DO NOT EDIT." } },
        "typescript",
      ],
    },
  },
}

export default config
