import { auth } from "@/auth/config"

export async function POST(request: Request) {
  return auth.handler(
    await forwardOAuthRequest(request, "/api/auth/oauth2/revoke"),
  )
}

async function forwardOAuthRequest(request: Request, pathname: string) {
  const url = new URL(pathname, request.url)

  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: await request.text(),
  })
}
