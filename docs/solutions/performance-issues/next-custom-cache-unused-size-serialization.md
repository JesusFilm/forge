---
title: Next serializes custom-cache entries for an unused size check
date: "2026-10-21"
module: Watch incremental cache
problem_type: performance_issue
component: tooling
root_cause: inefficient_algorithm
resolution_type: code_fix
tags: [nextjs, cache, serialization, event-loop, patched-dependencies]
---

# Next custom-cache size serialization

Next 16.3.8 calls `JSON.stringify(data).length` in IncrementalCache.set before
checking whether its FETCH size limit applies. Custom handlers are exempt from
that limit, but still pay the serialization cost. APP_PAGE buffers expand through
Buffer.toJSON into numeric arrays. Forge's Redis handler then separately encodes
buffers as base64 and serializes the stored entry.

In a matched production process-profile window, the unused framework pass
accounted for approximately 379 ms of sampled CPU. That is process-wide activity,
not a complete attribution of one waiting request or the incident's root cause.
Synchronous writes can postpone callbacks for concurrent cache reads on the same
JavaScript thread.

`patches/next@16.3.8.patch` skips the size pass only when
`this.hasCustomCacheHandler` is true. Default handlers retain their existing
serialization and size-limit behavior. Web is currently the only Forge Next app
with a configured custom handler; the dependency patch itself is shared across
all consumers of the pinned version. Preserve the existing Admin startup preload
hook in the same patch.

## Patch the runtime that actually executes

Next publishes independent implementations. Updating only
`dist/server/lib/incremental-cache/index.js` misses the compiled APP_PAGE runtime
observed in production. This repair covers standalone CJS/ESM and all four
regular/experimental, standard/Turbo APP_PAGE production bundles. The minified
replacement retains byte width and line count, preserving subsequent source-map
positions. Existing maps do not newly describe the changed expression.

Compiled dev, APP_ROUTE and Pages bundles remain unoptimized. Reassess all paths
and remove the local patch if an upstream version supplies the same correction.
Regenerate pnpm's patch checksum and every affected lock reference on changes;
a fresh frozen install must apply the checked-in patch successfully.

## Regression and evidence

`pnpm --filter @forge/web run test:cache-size` executes the actual standalone and
four compiled production caches. It fails on the original framework because the
custom APP_PAGE buffer expands once. The repaired custom path expands zero times;
the default path still expands once. The test also covers returned values, the
exact 2 MiB FETCH boundary, production warning/dev E1003 behavior and custom/build
exemptions.

`probe:cache-size` retains synthetic base64/JSON storage work while a pending read
competes with a write. The recorded median fell from about 90 ms to 17 ms. This is
local mechanism evidence, not real Watch HTTP latency, Redis timing or sustained
production recovery. The large cached payload remains a separate optimization.

See `docs/reports/2026-10-21-watch-cache-size-serialization.md` for exact windows,
commands, compatibility checks, entry-size measurements and acceptance limits.
