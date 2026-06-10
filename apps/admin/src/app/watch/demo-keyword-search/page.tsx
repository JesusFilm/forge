/**
 * /watch/demo-keyword-search — operator-facing canary tool that
 * fires Query.search twice in parallel (mode: "hybrid" vs
 * mode: "keyword-first") with debug=true, then renders the two
 * result lists side-by-side with retriever provenance per row
 * and a top-K overlap/divergence panel.
 *
 * Public route — no requireSession() gate. Public-shape data only.
 * The browser calls a server action, and that action attaches the
 * configured server-side search bearer before hitting Admin GraphQL.
 * The `debug` payload is still origin-gated server-side; prod requires
 * SEARCH_DEBUG_ALLOWED_ORIGINS to include admin's origin.
 *
 * See docs/plans/2026-04-29-005-feat-admin-keyword-search-demo-route-plan.md
 */

import { Suspense } from "react"
import { DemoSearchClient } from "./demo-search-client"

export const metadata = {
  title: "Demo — Keyword-First Search Canary",
}

// `DemoSearchClient` calls `useSearchParams()`; Next.js 16 production
// builds require any subtree consuming search params to live inside a
// Suspense boundary. Without it, the page is force-rendered statically
// and the search-params reactivity never fires on the client — the
// form submits but the fetch effect doesn't re-run on URL change.
// Hidden in `next dev` (different rendering path); only manifests in
// the deployed build.
export default function DemoKeywordSearchPage() {
  return (
    <Suspense fallback={null}>
      <DemoSearchClient />
    </Suspense>
  )
}
