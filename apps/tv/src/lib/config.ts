import { Platform } from "react-native"
import { env } from "../env"

export function getGraphQLUrl(): string {
  const url = env.EXPO_PUBLIC_GRAPHQL_URL
  // Android emulator can't reach host via localhost — swap to 10.0.2.2
  if (__DEV__ && Platform.OS === "android" && url.includes("localhost")) {
    return url.replace("localhost", "10.0.2.2")
  }
  return url
}

export function getApiToken(): string | undefined {
  return env.EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN
}
