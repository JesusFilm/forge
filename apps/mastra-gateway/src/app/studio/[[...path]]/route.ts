import { proxyMastraRequest } from "@/lib/mastra-proxy"

type RouteContext = {
  params: Promise<{ path?: string[] }>
}

export async function GET(request: Request, context: RouteContext) {
  return proxyStudioPath(request, context)
}

export async function POST(request: Request, context: RouteContext) {
  return proxyStudioPath(request, context)
}

export async function PUT(request: Request, context: RouteContext) {
  return proxyStudioPath(request, context)
}

export async function PATCH(request: Request, context: RouteContext) {
  return proxyStudioPath(request, context)
}

export async function DELETE(request: Request, context: RouteContext) {
  return proxyStudioPath(request, context)
}

async function proxyStudioPath(request: Request, context: RouteContext) {
  const { path = [] } = await context.params
  return proxyMastraRequest(request, `/studio/${path.join("/")}`)
}
