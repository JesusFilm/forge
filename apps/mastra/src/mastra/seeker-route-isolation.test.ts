import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

/**
 * Route-exposure guard for the seeker agent (feat-198 U5, re-pinned by
 * feat-204 U3 / KTD5).
 *
 * WHAT THIS PROVES (post-feat-204): the seeker agent is exposed via EXACTLY ONE
 * custom `registerApiRoute` in `index.ts` — `/forge-seeker`, wired to the
 * `handleSeekerRouteRequest` handler — and no OTHER `/forge-*` route references
 * it. The handler looks the agent up by string id inside its own module
 * (`getAgentById("seekerAgent")`, KTD1), so the literal `seekerAgent` token
 * must NOT appear anywhere in the `apiRoutes` region — its presence there would
 * mean someone smuggled an agent import into a route block and must re-review
 * isolation. The whole-source `seekerAgent` count stays exactly 2 (the import
 * line + the agents-map registration).
 *
 * WHAT THIS DOES NOT PROVE: that the agent is otherwise unreachable. Mastra's
 * framework-generated `/api/agents/*` surface exposes ANY registered agent for
 * generate/stream regardless of custom routes, and that surface is
 * unauthenticated at the code layer (see
 * `docs/solutions/integration-issues/mastra-studio-api-auth-guard.md` — the
 * broad `/api/*` service-bearer guard was deliberately removed so Studio's own
 * browser calls work). `/forge-seeker` itself is default-off (KTD7) +
 * bearer-gated, but the load-bearing containment for the built-in surface
 * remains the apps/mastra-gateway + Railway network layer, NOT this test. A
 * `/forge-*` 200 must never be mistaken for proof the agent is or isn't exposed.
 *
 * Source-text over runtime introspection (KTD4): route handlers are opaque
 * closures (a runtime route list can prove a seeker *path* exists but cannot
 * prove a handler does or doesn't internally call the agent), and importing
 * `index.ts` eagerly constructs the entire Mastra instance (DuckDB store,
 * observability, all workflows) at module load. Same family as admin's
 * migration byte-parity tests.
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

  it("exposes the seeker via exactly one /forge-seeker route", () => {
    // feat-204 (KTD5): the seeker is now exposed by exactly one custom route.
    // More than one occurrence would mean a duplicate/competing registration.
    const region = extractApiRoutesRegion(indexSource)
    const occurrences = region.match(/["']\/forge-seeker["']/g) ?? []
    expect(occurrences).toHaveLength(1)
  })

  it("wires /forge-seeker to the handleSeekerRouteRequest handler", () => {
    const region = extractApiRoutesRegion(indexSource)
    expect(region).toContain("handleSeekerRouteRequest")
  })

  // The two feat-250 source pins ("threads the lane-only seekerServiceKeys",
  // "derives seekerServiceKeys from the ai-chat lane CSV") were replaced in
  // feat-283: the const they pinned is gone — key sourcing moved inside the
  // lane admission module, and the pool-vs-lane invariant is now guarded by
  // the discriminating key-source test in ai-chat-lane-admission.test.ts
  // plus the registration-site no-seam pin below.

  it("lane registrations inject no admission seams (feat-283)", () => {
    // The admission module's DEFAULT key/flag sourcing is load-bearing only
    // while the lane registrations pass no seams: an explicit
    // `getServiceKeys: () => serviceKeys` (the pool CSV, in scope in
    // index.ts) at any lane registration would re-grant pool keys
    // conversation access with every other test green. Slice each lane
    // block (the deleted feat-250 pin's own technique) and pin the absence.
    const region = extractApiRoutesRegion(indexSource)
    const laneRoutes = [
      "/forge-seeker",
      "/forge-ai-chat-history-list",
      "/forge-ai-chat-history-replay",
    ]
    for (const route of laneRoutes) {
      const start = region.indexOf(`"${route}"`)
      expect(start).toBeGreaterThanOrEqual(0)
      const next = region.indexOf("registerApiRoute(", start)
      const block =
        next === -1 ? region.slice(start) : region.slice(start, next)
      expect(block).not.toMatch(
        /\bserviceKeys\b|\bgetServiceKeys\b|\bgetEnabled\b/,
      )
    }
    // Anti-vacuous companion: a pool-keyed route's block DOES carry the pool
    // binding, so a parser miss cannot satisfy the absence assertions above.
    const expStart = region.indexOf('"/forge-experience-chat"')
    expect(expStart).toBeGreaterThanOrEqual(0)
    const expNext = region.indexOf("registerApiRoute(", expStart)
    const expBlock =
      expNext === -1 ? region.slice(expStart) : region.slice(expStart, expNext)
    expect(expBlock).toMatch(/\bserviceKeys\b/)
  })

  it("passes no admission seam anywhere in index.ts (parser-independent backstop)", () => {
    // Whole-source companion to the block pin above (the same technique as
    // the exactly-twice count backstop below): a FUTURE lane registration —
    // e.g. feat-247's — that injects an admission seam is caught even before
    // the laneRoutes list above learns the new route. Only the seam tokens
    // can be pinned source-wide: the pool `serviceKeys` binding stays
    // legitimate for every non-lane route.
    expect(indexSource).not.toMatch(/\bgetServiceKeys\b|\bgetEnabled\b/)
  })

  it("does NOT reference seekerAgent inside any custom apiRoute", () => {
    // The route looks the agent up by string id in the handler module (KTD1),
    // so the literal `seekerAgent` token must never appear in the apiRoutes
    // region. Its presence here means a route smuggled in an agent import and
    // the isolation guarantee must be re-reviewed.
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
    // registration. `/forge-seeker` (feat-204) deliberately does NOT add a
    // third: its handler resolves the agent by string id (KTD1), so any third
    // occurrence (incl. a new comment) must be a conscious change with the
    // isolation guarantee re-reviewed.
    const occurrences = indexSource.match(/seekerAgent/g) ?? []
    expect(occurrences).toHaveLength(2)
  })

  it("imports handleSeekerRouteRequest exactly once", () => {
    // Regression note (feat-204): the route handler is imported once at the top
    // of index.ts. A second import would signal a stray/duplicate wiring.
    const occurrences = indexSource.match(/handleSeekerRouteRequest/g) ?? []
    // One import binding + one call site in the route block = 2 occurrences.
    expect(occurrences).toHaveLength(2)
  })
})
