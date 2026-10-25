// Shared constant for the /watch basePath. Consumed by both next.config.mjs
// (Next.js basePath) and src/lib/routes.ts (WATCH_BASE_PATH used by absolute
// URL builders). Having one source eliminates the cross-file invariant
// drift documented in todo #014.

export const WATCH_BASE_PATH = "/watch"
