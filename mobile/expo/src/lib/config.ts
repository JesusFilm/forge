/**
 * Runtime config for the Expo app (env-driven).
 * Set EXPO_PUBLIC_GRAPHQL_URL per environment (dev/stage/prod).
 * Optional: EXPO_PUBLIC_STRAPI_TOKEN for authenticated Strapi requests.
 */
const getEnv = (key: string): string | undefined => {
  if (typeof process !== "undefined" && process.env?.[key] !== undefined) {
    return process.env[key] as string
  }
  // Expo injects EXPO_PUBLIC_* at build time via app.config / .env
  return undefined
}

export const config = {
  /** Strapi GraphQL endpoint (e.g. https://cms.example.com/graphql). */
  get graphqlUrl(): string {
    const url = getEnv("EXPO_PUBLIC_GRAPHQL_URL")
    if (!url) {
      return ""
    }
    return url
  },
  /** Optional Bearer token for Strapi (if required for read). */
  get strapiToken(): string | undefined {
    return getEnv("EXPO_PUBLIC_STRAPI_TOKEN")
  },
} as const
