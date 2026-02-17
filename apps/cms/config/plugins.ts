import path from "node:path"
import type { Core } from "@strapi/strapi"

const contractsGraphql = path.resolve(
  process.cwd(),
  "..",
  "packages",
  "contracts",
  "graphql",
)

const config = ({
  env,
}: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  graphql: {
    config: {
      endpoint: "/graphql",
      shadowCRUD: true,
      landingPage: env("NODE_ENV") !== "production",
      generateArtifacts: true,
      artifacts: {
        schema: path.join(contractsGraphql, "schema.graphql"),
        typegen: path.join(contractsGraphql, "generated-types.ts"),
      },
    },
  },
  i18n: { enabled: true },
})

export default config
