import { env, DEFAULT_ADMIN_GRAPHQL_URL } from "../env"

export function getGraphQLUrl(): string {
  return env.EXPO_PUBLIC_ADMIN_GRAPHQL_URL ?? DEFAULT_ADMIN_GRAPHQL_URL
}

export function getApiToken(): string | undefined {
  return env.EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN
}
