/**
 * /watch/demo-keyword-search — operator-facing canary tool that
 * fires Query.search twice in parallel (mode: "hybrid" vs
 * mode: "keyword-first") with debug=true, then renders the two
 * result lists side-by-side with retriever provenance per row
 * and a top-K overlap/divergence panel.
 *
 * Public route — no requireSession() gate. Public-shape data only.
 * The `debug` payload is origin-gated server-side; same-origin
 * requests pass the gate by default in dev/preview, and prod
 * requires SEARCH_DEBUG_ALLOWED_ORIGINS to include admin's origin.
 *
 * See docs/plans/2026-04-29-005-feat-admin-keyword-search-demo-route-plan.md
 */

import { DemoSearchClient } from "./demo-search-client"

export const metadata = {
  title: "Demo — Keyword-First Search Canary",
}

export default function DemoKeywordSearchPage() {
  return <DemoSearchClient />
}
