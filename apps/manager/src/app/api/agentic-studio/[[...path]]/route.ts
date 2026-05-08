import { proxyAgenticStudioRequest } from "@/lib/agentic-studio-proxy"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ path?: string[] }>
}

async function handle(request: Request, context: RouteContext) {
  const params = await context.params
  return proxyAgenticStudioRequest(request, { path: params.path ?? [] })
}

export async function GET(request: Request, context: RouteContext) {
  return handle(request, context)
}

export async function POST(request: Request, context: RouteContext) {
  return handle(request, context)
}

export async function PUT(request: Request, context: RouteContext) {
  return handle(request, context)
}

export async function PATCH(request: Request, context: RouteContext) {
  return handle(request, context)
}

export async function DELETE(request: Request, context: RouteContext) {
  return handle(request, context)
}

export async function HEAD(request: Request, context: RouteContext) {
  return handle(request, context)
}
