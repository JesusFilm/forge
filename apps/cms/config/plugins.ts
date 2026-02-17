import type { Core } from "@strapi/strapi"

const config = ({
  env,
}: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  graphql: {
    config: {
      endpoint: "/graphql",
      shadowCRUD: true,
      landingPage: env("NODE_ENV") !== "production",
    },
  },
  i18n: { enabled: true },
})

export default config
