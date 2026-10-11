/**
 * Which two-letter codes name a country that a phone can report. Registrations
 * store the edge's ISO code or the phone's own region (`country.ts`), so an alias
 * such as UK (for GB) or a group code such as EU matches no phone.
 */
const REGION_NAMES = new Intl.DisplayNames(["en"], {
  type: "region",
  fallback: "none",
})

// ISO 3166 user-assigned codes and the CLDR group codes. XK (Kosovo) is
// user-assigned too, but it stays because the edge reports it.
const NOT_A_COUNTRY = /^(?:AA|Q[M-Z]|X[A-JL-Z]|ZZ|EU|EZ|UN)$/

export type PushCountryCheck =
  | Readonly<{ kind: "country"; name: string }>
  | Readonly<{ kind: "alias"; canonical: string; name: string }>
  | Readonly<{ kind: "unknown" }>

function canonicalRegion(code: string): string | undefined {
  try {
    return new Intl.Locale(`und-${code}`).region
  } catch {
    return undefined
  }
}

function regionName(code: string): string | undefined {
  try {
    return REGION_NAMES.of(code)
  } catch {
    return undefined
  }
}

/** Classifies an upper-case code: a country, an alias of one, or neither. */
export function checkPushCountryCode(code: string): PushCountryCheck {
  if (!/^[A-Z]{2}$/.test(code)) return { kind: "unknown" }
  const canonical = canonicalRegion(code)
  if (canonical && canonical !== code) {
    const name = regionName(canonical)
    return name && !NOT_A_COUNTRY.test(canonical)
      ? { kind: "alias", canonical, name }
      : { kind: "unknown" }
  }
  if (NOT_A_COUNTRY.test(code)) return { kind: "unknown" }
  const name = regionName(code)
  return name ? { kind: "country", name } : { kind: "unknown" }
}

/** Why a code is refused, or null for a country. */
export function pushCountryCodeRefusal(code: string): string | null {
  const check = checkPushCountryCode(code)
  if (check.kind === "country") return null
  if (check.kind === "alias") {
    return `${code} is not an ISO country code. Use ${check.canonical} for ${check.name}`
  }
  return `${code} is not a country code that a phone reports`
}
