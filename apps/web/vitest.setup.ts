process.env.CI ??= "1"
process.env.INTERNAL_GRAPHQL_URL ??= "http://localhost:1437/graphql"
process.env.NEXT_PUBLIC_GRAPHQL_URL ??= "http://localhost:1437/graphql"
process.env.STRAPI_API_TOKEN ??= "test-strapi-api-token"
process.env.STRAPI_PREVIEW_SECRET ??= "test-strapi-preview-secret"
process.env.REVALIDATION_SECRET ??= "test-revalidation-secret"
// U5 — admin GraphQL URL for tests that import the admin client transitively
// (e.g. via @/lib/content). FORGE_CONTENT_API has a default of "strapi" in
// the env schema and does not need to be set here.
process.env.ADMIN_GRAPHQL_URL ??= "http://localhost:1437/admin/api/graphql"

// Required for React 19 + react-dom/client `act` under vitest jsdom environment.
// Mirrors packages/video-player/vitest.setup.ts so .tsx tests can use act().
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(
      () => callback(performance.now()),
      0,
    )) as typeof requestAnimationFrame
}

if (!globalThis.cancelAnimationFrame) {
  globalThis.cancelAnimationFrame = ((handle: number) =>
    clearTimeout(handle)) as typeof cancelAnimationFrame
}
