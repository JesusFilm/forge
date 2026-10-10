import { Platform } from "react-native"
import { env } from "../env"
import { resolveAdminGraphqlUrl } from "./adminEndpoint"

export function getGraphQLUrl(): string {
  return resolveAdminGraphqlUrl(
    env.EXPO_PUBLIC_ADMIN_GRAPHQL_URL,
    __DEV__,
    Platform.OS,
  )
}

export function getApiToken(): string | undefined {
  return env.EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN
}
