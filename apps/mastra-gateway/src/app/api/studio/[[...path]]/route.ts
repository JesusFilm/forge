import {
  canonicalizeMastraApiPath,
  isDevotionalNativeWorkflowPath,
  isSupportResearchNativeWorkflowPath,
  revalidateDevotionalSession,
} from "@/lib/devotional-access"
import { proxyMastraRequest } from "@/lib/mastra-proxy"
import { NextResponse } from "next/server"

type RouteContext = {
  params: Promise<{ path?: string[] }>
}

export async function GET(request: Request, context: RouteContext) {
  return proxyStudioApi(request, context)
}

export async function POST(request: Request, context: RouteContext) {
  return proxyStudioApi(request, context)
}

export async function PUT(request: Request, context: RouteContext) {
  return proxyStudioApi(request, context)
}

export async function PATCH(request: Request, context: RouteContext) {
  return proxyStudioApi(request, context)
}

export async function DELETE(request: Request, context: RouteContext) {
  return proxyStudioApi(request, context)
}

async function proxyStudioApi(request: Request, context: RouteContext) {
  const { path: rawPath = [] } = await context.params
  const path = canonicalizeMastraApiPath(rawPath)
  if (!path) {
    return NextResponse.json({ error: "Invalid API path" }, { status: 400 })
  }
  const isSupportResearchPath = isSupportResearchNativeWorkflowPath(path)
  return proxyMastraRequest(
    request,
    `/api/${path.map(encodeURIComponent).join("/")}`,
    isSupportResearchPath || isDevotionalNativeWorkflowPath(path)
      ? {
          allowedRoles: isSupportResearchPath ? ["admin"] : ["admin", "editor"],
          revalidateSession: (session) =>
            revalidateDevotionalSession(session, { recordAccess: false }),
        }
      : undefined,
  )
}
