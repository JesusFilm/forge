import {
  isDevotionalNativeWorkflowPath,
  isWorkspaceApiPath,
  revalidateDevotionalSession,
} from "@/lib/devotional-access"
import { proxyMastraRequest } from "@/lib/mastra-proxy"

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
  const { path = [] } = await context.params
  const requiresFreshAccess =
    isDevotionalNativeWorkflowPath(path) || isWorkspaceApiPath(path)
  return proxyMastraRequest(
    request,
    `/api/${path.join("/")}`,
    requiresFreshAccess
      ? {
          allowedRoles: ["admin", "editor"],
          revalidateSession: (session) =>
            revalidateDevotionalSession(session, { recordAccess: false }),
          workspaceRequest: isWorkspaceApiPath(path),
        }
      : undefined,
  )
}
