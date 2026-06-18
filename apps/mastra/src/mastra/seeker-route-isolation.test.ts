import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

/**
 * Route-isolation guard for the seeker agent (feat-198, U5).
 *
 * WHAT THIS PROVES: no *custom* `registerApiRoute` in `index.ts` wires up the
 * seeker agent — i.e. no hand-written `/forge-*` route exposes it.
 *
 * WHAT THIS DOES NOT PROVE: that the agent is unreachable. Mastra's
 * framework-generated `/api/agents/*` surface exposes ANY registered agent for
 * generate/stream regardless of custom routes, and that surface is
 * unauthenticated at the code layer (see
 * `docs/solutions/integration-issues/mastra-studio-api-auth-guard.md` — the
 * broad `/api/*` service-bearer guard was deliberately removed so Studio's own
 * browser calls work). The real "Studio-only" boundary is the
 * apps/mastra-gateway + Railway network layer, NOT this test. A `/forge-*` 200
 * must never be mistaken for proof the agent is or isn't exposed.
 *
 * Source-text over runtime introspection (KTD4): route handlers are opaque
 * closures (a runtime route list can prove no seeker *path* exists but cannot
 * prove a handler doesn't internally call the agent), and importing `index.ts`
 * eagerly constructs the entire Mastra instance (DuckDB store, observability,
 * all workflows) at module load. Same family as admin's migration byte-parity
 * tests.
 */

const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8")

/**
 * Slice the `apiRoutes: [ ... ]` array region out of the source by
 * bracket-matching from the opener to its matching `]`.
 */
function extractApiRoutesRegion(source: string): string {
  const opener = source.indexOf("apiRoutes: [")
  expect(opener).toBeGreaterThanOrEqual(0)
  const arrayStart = source.indexOf("[", opener)
  let depth = 0
  for (let i = arrayStart; i < source.length; i++) {
    const char = source[i]
    if (char === "[") depth++
    else if (char === "]") {
      depth--
      if (depth === 0) {
        return source.slice(arrayStart, i + 1)
      }
    }
  }
  throw new Error("apiRoutes array opener had no matching close bracket")
}

describe("seeker agent route isolation", () => {
  it("registers seekerAgent in the agents map", () => {
    // Positive check: guards against the negative assertion passing vacuously
    // because the agent was never registered at all.
    expect(indexSource).toMatch(/agents:\s*\{[^}]*\bseekerAgent\b[^}]*\}/)
  })

  it("locates a non-empty apiRoutes region (anti-vacuous guard)", () => {
    const region = extractApiRoutesRegion(indexSource)
    expect(region.length).toBeGreaterThan(0)
    // Sanity: the region actually contains route registrations, so a parsing
    // miss can't make the absence assertion below pass on an empty slice.
    expect(region).toContain("registerApiRoute")
  })

  it("does NOT wire seekerAgent into any custom apiRoute", () => {
    const region = extractApiRoutesRegion(indexSource)
    expect(region).not.toContain("seekerAgent")
  })

  it("references seekerAgent exactly twice in index.ts (import + registration)", () => {
    // Parser-independent backstop. The bracket-matching region slice above is
    // string-unaware: an unbalanced `]` inside a future route's string literal
    // could truncate the region early and let a `/forge-*` route that wires
    // seekerAgent slip past the absence assertion vacuously. This whole-source
    // count catches ANY new seekerAgent reference (a route handler, a second
    // registration) regardless of the parser — it rises to 3+ and fails.
    // The two legitimate references are the import line and the agents-map
    // registration; any third occurrence (incl. a new comment) must be a
    // conscious change with the isolation guarantee re-reviewed.
    const occurrences = indexSource.match(/seekerAgent/g) ?? []
    expect(occurrences).toHaveLength(2)
  })
})
