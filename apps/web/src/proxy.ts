import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * Proxy runs for /watch and /watch/* (excluding /watch/assets).
 * Root redirect / → /watch is handled in next.config redirects (basePath: false).
 * Add locale rewrites or other logic here when needed.
 */
export function proxy(request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: ["/watch/((?!assets).*)", "/watch"],
}
