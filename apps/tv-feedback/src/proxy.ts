import { NextResponse, type NextRequest } from "next/server"
import { signedSimulatorConfig } from "./server/signedSimulator"

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const matches = (prefix: string) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  const local = matches("/tv/local") || matches("/api/feedback/local")
  const preview = matches("/tv/preview")
  const signed = matches("/tv/simulator") || matches("/api/feedback/simulator")
  if (signed && !signedSimulatorConfig())
    return new NextResponse(null, { status: 404 })
  // Reject before App Router streaming starts. A page-level notFound() alone
  // can render a not-found shell with HTTP 200 after a parent loading boundary.
  if (
    ((local || preview) && process.env.NODE_ENV !== "development") ||
    (local && process.env.FEEDBACK_LOCAL_ENABLED !== "true")
  )
    return new NextResponse(null, { status: 404 })
  return NextResponse.next()
}

export const config = {
  matcher: [
    "/tv/preview/:path*",
    "/tv/local/:path*",
    "/api/feedback/local/:path*",
    "/tv/simulator/:path*",
    "/api/feedback/simulator/:path*",
  ],
}
