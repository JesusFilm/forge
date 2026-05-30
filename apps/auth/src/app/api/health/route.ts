import { getAuthBaseUrl } from "@/config/env"

export function GET(): Response {
  return Response.json({
    ok: true,
    service: "forge-auth",
    authBaseUrl: getAuthBaseUrl(),
  })
}
