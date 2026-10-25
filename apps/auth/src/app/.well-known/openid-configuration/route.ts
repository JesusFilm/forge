import { getOpenIdConfiguration } from "@/auth/openid-configuration"

export const dynamic = "force-dynamic"

export function GET(_request: Request): Response {
  return Response.json(getOpenIdConfiguration(), {
    headers: {
      "Cache-Control":
        "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400",
    },
  })
}
