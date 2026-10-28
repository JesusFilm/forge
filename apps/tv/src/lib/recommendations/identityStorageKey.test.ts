import { recommendationIdentityStorageKey as key } from "./identityStorageKey"

it("preserves the release key regardless of the configured endpoint", () => {
  expect(key("https://admin.jesusfilm.org/api/graphql", false)).toBe(
    "tv.recommendations.identity.v1",
  )
  expect(key("https://stage.example.test/api/graphql", false)).toBe(
    "tv.recommendations.identity.v1",
  )
})

it("isolates development identities by endpoint with SecureStore-safe keys", () => {
  const endpoints = [
    "http://127.0.0.1:19061/graphql",
    "https://admin.jesusfilm.org/api/graphql",
    "https://stage.example.test/api/graphql",
    "https://stage.example.test/api_2f_graphql",
    "https://stage.example.test/api/graphql?tenant=one",
  ]
  const keys = endpoints.map((endpoint) => key(endpoint, true))
  expect(new Set(keys).size).toBe(endpoints.length)
  for (const value of keys) expect(value).toMatch(/^[A-Za-z0-9._-]+$/)
  expect(key("https://ADMIN.jesusfilm.org:443/api/graphql", true)).toBe(
    key("https://admin.jesusfilm.org/api/graphql", true),
  )
})
