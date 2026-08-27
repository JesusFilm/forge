const PROTECTED_WORKFLOW_IDS = new Set([
  "daily-devotional",
  "video-first-devotional",
  "devotional-source",
  "devotional-content",
  "devotional-produce",
  "devotional-render",
  "devotional-approve",
  "devotional-publish",
])

const STOREFRONT_CURATOR_WORKFLOW_ID = "storefront-homepage-curation"

export type ProtectedNativeWorkflowRouteBlock =
  | "devotional_lifecycle_route_required"
  | "storefront_curator_operator_route_required"

export type ProtectedNativeWorkflowRouteResponse = {
  status: 403
  body: {
    error: ProtectedNativeWorkflowRouteBlock
    message: string
  }
}

function nativeWorkflowId(pathname: string): string | null {
  let normalizedPathname = pathname
  try {
    // Hono's URL pathname may retain an encoded slash. Decode before matching
    // so `%2F` cannot hide a protected workflow's run subpath from the guard.
    normalizedPathname = decodeURIComponent(pathname)
  } catch {
    // Fall back to the raw pathname. This still blocks a literal protected ID
    // followed by malformed encoding and, importantly, never crashes routing.
  }
  const match = /^\/api\/workflows\/([^/]+)(?:\/|$)/.exec(normalizedPathname)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

/**
 * Returns the custom-route boundary that must handle a protected native
 * workflow request. Storefront curation is fully private: every method,
 * including run inspection, must go through its dedicated operator route.
 * Devotional reads retain their existing behavior while mutations remain
 * lifecycle-route-only.
 */
export function getProtectedNativeWorkflowRouteBlock(
  method: string,
  pathname: string,
): ProtectedNativeWorkflowRouteBlock | null {
  const workflowId = nativeWorkflowId(pathname)
  if (!workflowId) return null
  if (workflowId === STOREFRONT_CURATOR_WORKFLOW_ID) {
    return "storefront_curator_operator_route_required"
  }
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null
  }
  return PROTECTED_WORKFLOW_IDS.has(workflowId)
    ? "devotional_lifecycle_route_required"
    : null
}

export function getProtectedNativeWorkflowRouteResponse(
  method: string,
  pathname: string,
): ProtectedNativeWorkflowRouteResponse | null {
  const block = getProtectedNativeWorkflowRouteBlock(method, pathname)
  if (!block) return null
  const storefront = block === "storefront_curator_operator_route_required"
  return {
    status: 403,
    body: {
      error: block,
      message: storefront
        ? "Use the authenticated /forge-storefront-curation operator route."
        : "Use the authenticated /forge-daily-devotional lifecycle routes.",
    },
  }
}

export function isBlockedDevotionalNativeMutation(
  method: string,
  pathname: string,
): boolean {
  return (
    getProtectedNativeWorkflowRouteBlock(method, pathname) ===
    "devotional_lifecycle_route_required"
  )
}
