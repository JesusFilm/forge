import { AdminGraphqlClient } from "@/backend/admin-client"
import { env } from "@/config/env"
import { getAdminManagerServiceBearer } from "@/lib/admin-manager-session"

type ConfigurationErrorConstructor = new (message: string) => Error

export async function createAuthenticatedAdminClient({
  ErrorType,
  missingUrlMessage,
  missingAuthMessage,
}: {
  ErrorType: ConfigurationErrorConstructor
  missingUrlMessage: string
  missingAuthMessage: string
}) {
  if (!env.ADMIN_GRAPHQL_URL) {
    throw new ErrorType(missingUrlMessage)
  }
  let bearer: string
  try {
    bearer = await getAdminManagerServiceBearer()
  } catch {
    throw new ErrorType(missingAuthMessage)
  }
  return new AdminGraphqlClient({
    graphqlUrl: env.ADMIN_GRAPHQL_URL,
    apiKey: bearer,
  })
}
