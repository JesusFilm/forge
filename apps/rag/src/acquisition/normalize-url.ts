/**
 * normalizeUrl — the canonical dedup identity (docs/architecture.md §2,
 * invariant 2). Strips the fragment and tracking params (utm_*, gclid, fbclid,
 * ref, ref_src, igshid, mc_cid, mc_eid), lowercases the host, and trims a
 * trailing slash (except the root path). Deterministic: same input → same
 * output. Acquisition's only URL-identity rule; everything downstream dedups on
 * the result.
 */
const TRACKING_PARAMS = new Set([
  "gclid",
  "fbclid",
  "ref",
  "ref_src",
  "igshid",
  "mc_cid",
  "mc_eid",
])

export function normalizeUrl(input: string): string {
  const u = new URL(input)
  u.hash = ""

  for (const key of [...u.searchParams.keys()]) {
    const k = key.toLowerCase()
    if (k.startsWith("utm_") || TRACKING_PARAMS.has(k))
      u.searchParams.delete(key)
  }

  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.slice(0, -1)
  }

  return u.toString()
}
