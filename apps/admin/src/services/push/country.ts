/**
 * KTD6 — a registration's country comes from the edge's own header alone.
 *
 * `apps/web`'s reader also accepts `x-vercel-ip-country` and `x-country-code`,
 * which a client can set. A phone sends this request itself, so admin reads
 * only the header Cloudflare writes, and falls to the phone's own region.
 */
import type { PushCountrySource } from "@prisma/client"

/** The only country header admin trusts. A client cannot write it. */
export const PUSH_EDGE_COUNTRY_HEADER = "cf-ipcountry"

/** Cloudflare's placeholder for an unknown origin, and its Tor label. */
const PUSH_UNKNOWN_COUNTRY_VALUES = new Set(["XX", "T1"])

export type PushCountryResolution = Readonly<{
  country: string | null
  source: PushCountrySource
}>

function normalizeCountry(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase()
  if (!code || !/^[A-Z]{2}$/.test(code)) return null
  return PUSH_UNKNOWN_COUNTRY_VALUES.has(code) ? null : code
}

/** The edge's country for this request, or null when it named none. */
export function readPushEdgeCountry(headers: Headers): string | null {
  return normalizeCountry(headers.get(PUSH_EDGE_COUNTRY_HEADER))
}

/** The region subtag of a BCP-47 tag: `fr-FR` and `zh-Hant-TW` both give one. */
function regionSubtag(tag: string | null): string | null {
  if (!tag) return null
  const subtags = tag.trim().split("-").slice(1)
  for (const subtag of subtags) {
    const region = normalizeCountry(subtag)
    if (region) return region
  }
  return null
}

/**
 * The stored country and the source that supplied it. The value is a
 * best-effort label: the origin is reachable without the edge, so a phone's
 * own region stands in, and neither one is null-free.
 */
export function resolvePushCountry(input: {
  edgeCountry: string | null
  phoneLocale: string | null
}): PushCountryResolution {
  const edge = normalizeCountry(input.edgeCountry)
  if (edge) return { country: edge, source: "EDGE" }
  const region = regionSubtag(input.phoneLocale)
  if (region) return { country: region, source: "PHONE_REGION" }
  return { country: null, source: "UNKNOWN" }
}
