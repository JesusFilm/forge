import type { AdminGraphqlClient } from "@/backend/admin-client"
import { createAuthenticatedAdminClient } from "@/backend/create-admin-client"

export class SeoAdminConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SeoAdminConfigurationError"
  }
}

export async function createSeoAdminClient(): Promise<AdminGraphqlClient> {
  return createAuthenticatedAdminClient({
    ErrorType: SeoAdminConfigurationError,
    missingUrlMessage: "ADMIN_GRAPHQL_URL is required for the SEO workspace.",
    missingAuthMessage:
      "Manager-to-Admin authentication is not configured for the SEO workspace.",
  })
}
