/** Metro inlines process.env.EXPO_PUBLIC_* at build time. */
declare const process: {
  env: Record<string, string | undefined> & {
    EXPO_PUBLIC_GRAPHQL_URL?: string
    EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN?: string
    CI?: string
    EAS_BUILD?: string
  }
}
