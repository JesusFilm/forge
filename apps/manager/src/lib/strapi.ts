// Server-side Strapi fetch helper.
// Reads the JWT from the HTTP-only cookie and includes it in requests.

import { cookies } from "next/headers"
import { env } from "@/config/env"

export async function strapiServerFetch(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const cookieStore = await cookies()
  const jwt = cookieStore.get("strapi-jwt")?.value

  if (!jwt) throw new Error("Not authenticated")

  return fetch(`${env.STRAPI_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      ...options?.headers,
    },
  })
}
