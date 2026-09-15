import { createAuthenticatedAdminClient } from "@/backend/create-admin-client"

export class WatchRouteAlertsConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WatchRouteAlertsConfigurationError"
  }
}

export async function createWatchRouteAlertsAdminClient() {
  return createAuthenticatedAdminClient({
    ErrorType: WatchRouteAlertsConfigurationError,
    missingUrlMessage: "ADMIN_GRAPHQL_URL is required for Watch route alerts.",
    missingAuthMessage:
      "Manager-to-Admin authentication is not configured for Watch route alerts.",
  })
}
