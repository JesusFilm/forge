import "server-only"
import { ApologistError } from "../protocol"

export type ProviderConfig = {
  baseURL: string
  apiKey: string
  model: string
  hosts: string
}
export type PromptConfig = {
  baseURL: string
  publicKey: string
  secretKey: string
  hosts: string
}

/** Validate every credentialed destination against an explicit exact host pin. */
export function pinnedUrl(value: string, hosts: string): URL {
  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !hosts
        .split(",")
        .some(
          (host) => host.trim().toLowerCase() === url.hostname.toLowerCase(),
        )
    )
      throw new ApologistError("unavailable")
    return url
  } catch {
    throw new ApologistError("unavailable")
  }
}

/** Resolve optional configuration at request time; ordinary Chat never depends on it. */
export function providerConfig(
  env: Record<string, string | undefined> = process.env,
): ProviderConfig | null {
  const {
    APOLOGIST_API_URL: baseURL,
    APOLOGIST_API_KEY: apiKey,
    APOLOGIST_MODEL_ID: model,
    APOLOGIST_ALLOWED_HOSTS: hosts,
  } = env
  if (!baseURL || !apiKey || !model || !hosts) return null
  try {
    pinnedUrl(baseURL, hosts)
    return { baseURL, apiKey, model, hosts }
  } catch {
    return null
  }
}

/** Prompt credentials belong to Core's project, separately from Forge tracing. */
export function promptConfig(
  env: Record<string, string | undefined> = process.env,
): PromptConfig | null {
  const {
    APOLOGIST_LANGFUSE_BASE_URL: baseURL,
    APOLOGIST_LANGFUSE_PUBLIC_KEY: publicKey,
    APOLOGIST_LANGFUSE_SECRET_KEY: secretKey,
    APOLOGIST_LANGFUSE_ALLOWED_HOSTS: hosts,
  } = env
  if (!baseURL || !publicKey || !secretKey || !hosts) return null
  try {
    pinnedUrl(baseURL, hosts)
    return { baseURL, publicKey, secretKey, hosts }
  } catch {
    return null
  }
}
