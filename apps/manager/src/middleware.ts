import { NextRequest, NextResponse } from "next/server"
import {
  LEGACY_STRAPI_SESSION_COOKIE,
  MANAGER_SESSION_COOKIE,
} from "@/lib/session-cookie"

// UX redirect guard only — checks cookie *presence* to redirect
// unauthenticated users to the login page. This does NOT validate the session.
// Real authentication (token validation + role check against backend) happens
// in the API route handler via `authenticateRequest()` in `src/lib/auth.ts`.
export function middleware(request: NextRequest) {
  const session =
    request.cookies.get(MANAGER_SESSION_COOKIE)?.value ??
    request.cookies.get(LEGACY_STRAPI_SESSION_COOKIE)?.value
  const { pathname } = request.nextUrl

  // Public assets in /public (for example SVG logos) should never be
  // redirected through the login guard.
  if (pathname.includes(".")) {
    return NextResponse.next()
  }

  if (!session && !pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!login|api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp|css|js|woff2?|ttf|eot)$).*)",
  ],
}
