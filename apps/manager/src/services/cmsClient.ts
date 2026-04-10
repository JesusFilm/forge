// CMS HTTP client — shared helper for calling Strapi REST endpoints.
// Authenticated with STRAPI_API_TOKEN. Used by backfill services.

import { env } from "@/config/env"

export type CmsTokenScope = "default" | "embedding_sync" | "embedding_override"

export type CmsRequestOptions = {
  token?: string
  tokenScope?: CmsTokenScope
}

export class CmsHttpError extends Error {
  constructor(
    readonly method: "GET" | "POST",
    readonly path: string,
    readonly status: number,
    readonly bodyText: string,
    readonly responseData?: unknown,
  ) {
    super(`CMS ${method} ${path} returned ${status}: ${bodyText}`)
    this.name = "CmsHttpError"
  }
}

export class CmsConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CmsConfigurationError"
  }
}

function resolveCmsToken(options?: CmsRequestOptions): string {
  if (options?.token) {
    return options.token
  }

  switch (options?.tokenScope) {
    case "embedding_sync":
      if (env.STRAPI_INTERNAL_API_TOKEN) {
        return env.STRAPI_INTERNAL_API_TOKEN
      }
      throw new CmsConfigurationError(
        "STRAPI_INTERNAL_API_TOKEN is required for embedding sync",
      )
    case "embedding_override":
      if (!env.STRAPI_INTERNAL_API_TOKEN) {
        throw new CmsConfigurationError(
          "STRAPI_INTERNAL_API_TOKEN is required for embedding overrides",
        )
      }
      return env.STRAPI_INTERNAL_API_TOKEN
    default:
      return env.STRAPI_API_TOKEN
  }
}

async function parseCmsResponseBody(response: Response): Promise<{
  bodyText: string
  responseData?: unknown
}> {
  const bodyText = (await response.text()).slice(0, 5_000)
  if (bodyText.length === 0) {
    return { bodyText }
  }

  try {
    return {
      bodyText,
      responseData: JSON.parse(bodyText) as unknown,
    }
  } catch {
    return { bodyText }
  }
}

async function cmsRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  options?: CmsRequestOptions,
): Promise<T> {
  const response = await fetch(`${env.STRAPI_URL}/api${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${resolveCmsToken(options)}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(method === "GET" ? 30_000 : 60_000),
  })

  if (!response.ok) {
    const { bodyText, responseData } = await parseCmsResponseBody(response)
    throw new CmsHttpError(
      method,
      path,
      response.status,
      bodyText,
      responseData,
    )
  }

  return response.json() as Promise<T>
}

export async function cmsGet<T>(
  path: string,
  options?: CmsRequestOptions,
): Promise<T> {
  return cmsRequest<T>("GET", path, undefined, options)
}

export async function cmsPost<T>(
  path: string,
  body: unknown,
  options?: CmsRequestOptions,
): Promise<T> {
  return cmsRequest<T>("POST", path, body, options)
}
