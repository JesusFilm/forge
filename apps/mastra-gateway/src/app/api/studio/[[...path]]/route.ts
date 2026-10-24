import {
  isDevotionalNativeWorkflowPath,
  revalidateDevotionalSession,
} from "@/lib/devotional-access"
import { proxyMastraRequest } from "@/lib/mastra-proxy"

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
  const { path = [] } = await context.params
  return proxyMastraRequest(
    request,
    `/api/${path.join("/")}`,
    isDevotionalNativeWorkflowPath(path)
      ? {
          allowedRoles: ["admin", "editor"],
          revalidateSession: (session) =>
            revalidateDevotionalSession(session, { recordAccess: false }),
        }
      : undefined,
  )
}
