// CMS HTTP client — shared helper for calling Strapi REST endpoints.
// Authenticated with STRAPI_API_TOKEN. Used by backfill services.

import { env } from "@/config/env"

export async function cmsGet<T>(path: string): Promise<T> {
  const response = await fetch(`${env.STRAPI_URL}/api${path}`, {
    headers: { Authorization: `Bearer ${env.STRAPI_API_TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500)
    throw new Error(`CMS GET ${path} returned ${response.status}: ${body}`)
  }

  return response.json() as Promise<T>
}

export async function cmsPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${env.STRAPI_URL}/api${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.STRAPI_API_TOKEN}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500)
    throw new Error(`CMS POST ${path} returned ${response.status}: ${body}`)
  }

  return response.json() as Promise<T>
}
