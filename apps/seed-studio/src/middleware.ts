import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const LOGIN_PATH = "/login"
const SESSION_COOKIE = "seed-studio-session"

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname === LOGIN_PATH) {
    return NextResponse.next()
  }

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next()
  }

  const session = request.cookies.get(SESSION_COOKIE)
  if (!session?.value) {
    const loginUrl = new URL(LOGIN_PATH, request.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
