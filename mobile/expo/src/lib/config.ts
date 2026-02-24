/**
 * Runtime config for the Expo app (env-driven).
 * Set EXPO_PUBLIC_GRAPHQL_URL per environment (dev/stage/prod).
 * Optional: EXPO_PUBLIC_STRAPI_TOKEN for authenticated Strapi requests.
 * Uses direct process.env.EXPO_PUBLIC_* so Metro can inline values at build time.
 */
export const config = {
  /** Strapi GraphQL endpoint (e.g. https://cms.example.com/graphql). */
  get graphqlUrl(): string {
    return process.env.EXPO_PUBLIC_GRAPHQL_URL ?? ""
  },
  /** Optional Bearer token for Strapi (if required for read). */
  get strapiToken(): string | undefined {
    return process.env.EXPO_PUBLIC_STRAPI_TOKEN
  },
} as const
