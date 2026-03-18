import { NextRequest, NextResponse } from "next/server"

// UX redirect guard only — checks cookie *presence* to redirect
// unauthenticated users to the login page. This does NOT validate the JWT.
// Real authentication (token validation + role check against Strapi) happens
// in the API route handler via `authenticateRequest()` in `src/lib/auth.ts`.
export function middleware(request: NextRequest) {
  const jwt = request.cookies.get("strapi-jwt")?.value

  if (!jwt && !request.nextUrl.pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico).*)"],
}
