import type { GatewaySession } from "@/lib/gateway-session"
import { createGatewayStudioAccessService } from "@/services/studio-access.factory"

const DEVOTIONAL_WORKFLOW_IDS = new Set([
  "daily-devotional",
  "video-first-devotional",
  "devotional-source",
  "devotional-content",
  "devotional-produce",
  "devotional-render",
  "devotional-approve",
  "devotional-publish",
])

export async function revalidateDevotionalSession(
  session: GatewaySession,
  { recordAccess = true }: { recordAccess?: boolean } = {},
): Promise<GatewaySession | null> {
  const access = await createGatewayStudioAccessService().resolve(session, {
    recordAccess,
  })
  if (!access.allowed) return null
  return { ...session, role: access.role }
}

export function isDevotionalNativeWorkflowPath(path: readonly string[]) {
  return path[0] === "workflows" && DEVOTIONAL_WORKFLOW_IDS.has(path[1] ?? "")
}

export function isSupportResearchNativeWorkflowPath(path: readonly string[]) {
  return path[0] === "workflows" && path[1] === "daily-support-research"
}

export function isWorkspaceApiPath(path: readonly string[]) {
  return path[0] === "workspaces"
}

/**
 * Canonicalize catch-all API segments before they are classified or joined
 * into an upstream URL. `new URL()` normalizes encoded dot segments, so using
 * the raw Next.js params for authorization can otherwise classify a different
 * path than the one Mastra receives.
 */
export function canonicalizeMastraApiPath(
  path: readonly string[],
): string[] | null {
  const canonical: string[] = []
  for (const rawSegment of path) {
    let segment = rawSegment
    try {
      for (let index = 0; index <= rawSegment.length; index += 1) {
        const decoded = decodeURIComponent(segment)
        if (decoded === segment) break
        segment = decoded
        if (index === rawSegment.length) return null
      }
    } catch {
      return null
    }
    if (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes("\0")
    ) {
      return null
    }
    canonical.push(segment)
  }
  return canonical
}
