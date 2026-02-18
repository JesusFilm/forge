import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "./apps/cms/schema.graphql",
  generates: {
    "./apps/web/src/generated/graphql.ts": {
      plugins: ["typescript"],
    },
  },
};

export default config;
