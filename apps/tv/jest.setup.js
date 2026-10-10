// Minimum env for modules that import `src/env.ts`.
//
// `createEnv` validates at module load, so without this ANY module reaching env
// is untestable — which is how the device-grant transport went uncovered long
// enough to ship a wrong Content-Type. These are deliberately obvious fakes: a
// test asserting on a real host would be asserting on this file.
process.env.EXPO_PUBLIC_GRAPHQL_URL ||= "https://admin.example.test/graphql"
process.env.EXPO_PUBLIC_AUTH_BASE_URL ||= "https://auth.example.test"
