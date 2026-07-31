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

export function isWorkspaceApiPath(path: readonly string[]) {
  return path[0] === "workspaces"
}
