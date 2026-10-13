// Preload (after `--import tsx`): swap the route's networked dependencies for
// the stubs in ./stubs. Everything else, including the route itself, is real.
import { registerHooks } from "node:module"
import { pathToFileURL } from "node:url"

// Synthetic placeholders only (as in vitest.setup.ts); nothing connects.
process.env.CI ??= "1"
process.env.STRAPI_PREVIEW_SECRET ??= "fixture"
process.env.REVALIDATION_SECRET ??= "fixture"
process.env.ADMIN_GRAPHQL_URL ??= "http://127.0.0.1:9/fixture"
process.env.WEB_ADMIN_API_KEYS ??= "fixture"

const stub = (file) =>
  pathToFileURL(new URL(`./stubs/${file}`, import.meta.url).pathname).href
const stubs = new Map([
  ["server-only", stub("stubs.tsx")],
  ["next-intl/server", stub("stubs.tsx")],
  ["@/lib/feature-flags", stub("stubs.tsx")],
  ["@/lib/watch-route-manifest", stub("stubs.tsx")],
  ["@/components/WatchRouteSurfaceRegistration", stub("stubs.tsx")],
  ["@/components/home/WatchHomeFooter", stub("stubs.tsx")],
  ["@/components/watch/WatchStructuredData", stub("stubs.tsx")],
  ["@/components/watch/WatchPageClient", stub("stubs.tsx")],
  ["@/i18n/client-messages", stub("client-messages.ts")],
  ["@/lib/content", stub("content.ts")],
])

registerHooks({
  resolve(specifier, context, nextResolve) {
    const url = stubs.get(specifier)
    return url ? { url, shortCircuit: true } : nextResolve(specifier, context)
  },
})
