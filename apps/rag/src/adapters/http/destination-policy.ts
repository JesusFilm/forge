import type { FetchDestinationPolicy } from "../../contracts/index.js"
import { RagOperationalError } from "../../contracts/index.js"

export function assertAllowedDestinationUrl(
  rawUrl: string,
  policy?: FetchDestinationPolicy,
): URL {
  const url = new URL(rawUrl)
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new RagOperationalError(
      "fetch_destination_refused",
      `fetch destination refused: unsupported protocol ${url.protocol}`,
    )
  if (url.username || url.password)
    throw new RagOperationalError(
      "fetch_destination_refused",
      "fetch destination refused: URL credentials are not allowed",
    )
  if (!policy) return url
  const allowed = policy.allowPatterns.map((pattern) => new RegExp(pattern))
  if (
    (allowed.length > 0 && !allowed.some((re) => re.test(url.href))) ||
    (allowed.length === 0 && url.hostname !== policy.expectedHost)
  )
    throw new RagOperationalError(
      "fetch_destination_refused",
      `fetch destination refused: ${url.href} is outside source policy`,
    )
  return url
}
