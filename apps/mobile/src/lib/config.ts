import { Platform } from "react-native"
import { env } from "../env"

export function getGraphQLUrl(): string {
  return Platform.OS === "android"
    ? env.EXPO_PUBLIC_GRAPHQL_URL_ANDROID
    : env.EXPO_PUBLIC_GRAPHQL_URL_IOS
}

export function getApiToken(): string | undefined {
  return env.EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN
}
