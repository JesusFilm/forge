import {
  canonicalizeMastraApiPath,
  isDevotionalNativeWorkflowPath,
  isSupportResearchNativeWorkflowPath,
  isWorkspaceApiPath,
  revalidateDevotionalSession,
} from "@/lib/devotional-access"
import { proxyMastraRequest } from "@/lib/mastra-proxy"
import {
  isBoundedSupportResearchDryRun,
  isSupportResearchLaunchPath,
} from "@/lib/support-research-access"
import { NextResponse } from "next/server"

type RouteContext = {
  params: Promise<{ path?: string[] }>
}

export async function GET(request: Request, context: RouteContext) {
  return proxyMastraApiPath(request, context)
}

export async function POST(request: Request, context: RouteContext) {
  return proxyMastraApiPath(request, context)
}

export async function PUT(request: Request, context: RouteContext) {
  return proxyMastraApiPath(request, context)
}

export async function PATCH(request: Request, context: RouteContext) {
  return proxyMastraApiPath(request, context)
}

export async function DELETE(request: Request, context: RouteContext) {
  return proxyMastraApiPath(request, context)
}

async function proxyMastraApiPath(request: Request, context: RouteContext) {
  const { path: rawPath = [] } = await context.params
  const path = canonicalizeMastraApiPath(rawPath)
  if (!path) {
    return NextResponse.json({ error: "Invalid API path" }, { status: 400 })
  }
  const supportResearchRequest = isSupportResearchNativeWorkflowPath(path)
  if (
    supportResearchRequest &&
    isSupportResearchLaunchPath(path) &&
    !(await isBoundedSupportResearchDryRun(request))
  ) {
    return NextResponse.json(
      { error: "Invalid support research dry-run launch" },
      { status: 400 },
    )
  }
  const requiresFreshAccess =
    supportResearchRequest ||
    isDevotionalNativeWorkflowPath(path) ||
    isWorkspaceApiPath(path)
  return proxyMastraRequest(
    request,
    `/api/${path.map(encodeURIComponent).join("/")}`,
    requiresFreshAccess
      ? {
          allowedRoles: supportResearchRequest
            ? ["admin"]
            : ["admin", "editor"],
          revalidateSession: (session) =>
            revalidateDevotionalSession(session, { recordAccess: false }),
          workspaceRequest: isWorkspaceApiPath(path),
        }
      : undefined,
  )
}
