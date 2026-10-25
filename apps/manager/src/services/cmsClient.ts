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

async function cmsRequest<T>(
  method: "GET" | "POST",
  path: string,
  _body?: unknown,
  _options?: CmsRequestOptions,
): Promise<T> {
  throw new CmsConfigurationError(
    `The Strapi CMS HTTP client has been removed; cannot ${method} ${path}`,
  )
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
