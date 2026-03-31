import { Platform } from "react-native"
import { env } from "../env"

export const config = {
  get graphqlUrl(): string {
    const url =
      Platform.OS === "android"
        ? env.EXPO_PUBLIC_GRAPHQL_URL_ANDROID
        : env.EXPO_PUBLIC_GRAPHQL_URL_IOS
    if (!url) {
      throw new Error(
        `Missing EXPO_PUBLIC_GRAPHQL_URL for platform: ${Platform.OS}`,
      )
    }
    return url
  },
  get strapiToken(): string | undefined {
    return env.EXPO_PUBLIC_STRAPI_TOKEN
  },
} as const
