import { Platform } from "react-native"

/**
 * Runtime config for the Expo app (env-driven).
 * GraphQL URL is chosen by platform so iOS simulator (localhost) and Android
 * emulator (10.0.2.2) both reach the host. Uses direct process.env.EXPO_PUBLIC_*
 * so Metro can inline values at build time.
 */
export const config = {
  /** Strapi GraphQL endpoint for the current platform. */
  get graphqlUrl(): string {
    if (Platform.OS === "ios") {
      return process.env.EXPO_PUBLIC_GRAPHQL_URL_IOS ?? ""
    }
    if (Platform.OS === "android") {
      return process.env.EXPO_PUBLIC_GRAPHQL_URL_ANDROID ?? ""
    }
    return (
      process.env.EXPO_PUBLIC_GRAPHQL_URL_IOS ??
      process.env.EXPO_PUBLIC_GRAPHQL_URL_ANDROID ??
      ""
    )
  },
  /** Optional Bearer token for Strapi (if required for read). Embedded in client bundle at build time (EXPO_PUBLIC_*). Do not use production secrets. */
  get strapiToken(): string | undefined {
    return process.env.EXPO_PUBLIC_STRAPI_TOKEN
  },
} as const
