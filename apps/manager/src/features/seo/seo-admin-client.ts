import { AdminGraphqlClient } from "@/backend/admin-client"
import { env } from "@/config/env"
import { getAdminManagerServiceBearer } from "@/lib/admin-manager-session"

export class SeoAdminConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SeoAdminConfigurationError"
  }
}

export async function createSeoAdminClient(): Promise<AdminGraphqlClient> {
  if (!env.ADMIN_GRAPHQL_URL) {
    throw new SeoAdminConfigurationError(
      "ADMIN_GRAPHQL_URL is required for the SEO workspace.",
    )
  }

  let bearer: string
  try {
    bearer = await getAdminManagerServiceBearer()
  } catch {
    throw new SeoAdminConfigurationError(
      "Manager-to-Admin authentication is not configured for the SEO workspace.",
    )
  }

  return new AdminGraphqlClient({
    graphqlUrl: env.ADMIN_GRAPHQL_URL,
    apiKey: bearer,
  })
}
