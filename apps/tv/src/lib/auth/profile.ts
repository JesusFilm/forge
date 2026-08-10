// Signed-in profile data for the TV (feat-322 U4.7).
//
// WHY THERE IS NO LOCAL JWT VERIFICATION IN THIS FILE
// ---------------------------------------------------
// The plan's fallback branch — "verify ONLY the id_token, build JWKS as
// `new URL('/api/auth/jwks', issuer)`, derive `algorithms` FROM the published
// JWKS" — describes `apps/chat/src/auth/oauth-client.ts`, which leans on
// `jose`. `jose` is not a dependency of apps/tv, and adding it would put a
// crypto-heavy package on Hermes (no WebCrypto, so its slowest code paths) to
// re-derive claims the identity provider will hand us directly.
//
// So this module takes the branch the plan PREFERS: the userinfo endpoint.
// The access token goes to apps/auth over TLS and apps/auth answers with the
// claims. That is server-side verification BY CONSTRUCTION — the response is
// exactly as trustworthy as the TLS connection plus the token that bought it,
// and no signature check on this device could add anything to that.
//
// The one property the plan's JWKS advice was protecting — "a hardcoded alg
// pin silently breaks every TV after a key rotation, with no console to
// diagnose it" — is protected here by having no local pin at all. A key
// rotation on apps/auth is invisible to the TV.
//
// `decodeIdTokenClaimsUnverified` is NOT verification. It reads the payload
// segment of a JWT and does not check the signature, the issuer, the audience,
// or the expiry. It exists so an offline TV can put a NAME on screen, and it
// must never gate a security decision. Every identity this module produces
// carries a `source` tag so a caller has to look at where the claims came from
// before trusting them; `isServerVerifiedIdentity` is the one honest gate.

import { getStorage } from "../safeStorage"

/** Better Auth's OIDC userinfo route, under apps/auth's `/api/auth` base. */
export const USERINFO_PATH = "/api/auth/oauth2/userinfo"

/**
 * Display-only, so REGULAR storage (AsyncStorage), never the keychain: it is
 * read on the very first frame of a cold launch to avoid 1–2s of placeholder,
 * and expo-secure-store's keychain read is the slower of the two. Tokens stay
 * in secure storage; this is a name.
 */
export const DISPLAY_NAME_STORAGE_KEY = "forge.tv.profile_display_name"

/**
 * Bounded strictly below any caller's own budget. A TV that cannot reach the
 * IdP must fall through to the cached name quickly, not hold the screen.
 */
export const PROFILE_REQUEST_TIMEOUT_MS = 6000

/**
 * Response size ceiling. React Native's fetch is XHR-backed and exposes no
 * `response.body` stream, so — unlike the repo's server-side byte-cap law —
 * this cannot abort the socket mid-body: it bounds PARSE cost after the buffer,
 * not peak memory. Stated honestly rather than dressed up as an OOM guard.
 */
export const MAX_USERINFO_RESPONSE_CHARS = 64 * 1024

/** Longest id_token accepted for the unverified decode. Real ones are ~1–2KB. */
export const MAX_ID_TOKEN_CHARS = 8192

export const MAX_DISPLAY_NAME_CHARS = 64
export const MAX_EMAIL_CHARS = 254

/**
 * Where an identity's claims came from.
 *
 * `userinfo` — apps/auth validated the access token and answered. Trustworthy.
 * `id_token_unverified` — decoded on this device with NO signature check.
 *   Display only. Never authorize anything from it.
 */
export type IdentitySource = "userinfo" | "id_token_unverified"

export type TvIdentity = {
  source: IdentitySource
  subject: string
  name?: string
  email?: string
  picture?: string
  emailVerified?: boolean
}

/**
 * Server-verified identity check. The ONLY predicate a future security
 * decision may branch on — `identity.name != null` and friends say nothing
 * about where the claims came from.
 */
export function isServerVerifiedIdentity(identity: TvIdentity): boolean {
  return identity.source === "userinfo"
}

/**
 * `unauthorized` is kept distinct from `unavailable` on purpose: the first
 * means the access token was REJECTED (refresh, then sign out), the second
 * means we could not ask (network, timeout, 5xx, garbage body) and the session
 * is probably fine. Collapsing them would sign a viewer out over hotel wifi.
 */
export type UserInfoResult =
  | { kind: "ok"; identity: TvIdentity }
  | { kind: "unauthorized" }
  | { kind: "unavailable" }

// ── Endpoint construction ───────────────────────────────────────────────────

/**
 * `${base}${path}` with the base's trailing slashes stripped.
 *
 * Deliberately NOT `new URL(path, base)` despite that being the repo's rule
 * elsewhere: React Native ships its own URL polyfill whose two-argument form
 * CONCATENATES the base verbatim (`https://host/sub` + `/api/x` →
 * `https://host/sub/api/x`) where WHATWG resolves against the origin. Jest
 * runs Node's compliant URL, so no test in this app could ever see the
 * difference — a mocked-vs-real trap in its purest form. Concatenation behaves
 * identically on both runtimes, which is why it is the safer primitive HERE.
 */
export function buildAuthEndpointUrl(
  authBaseUrl: string,
  path: string,
): string {
  return `${authBaseUrl.replace(/\/+$/, "")}${path}`
}

/**
 * Guard against sending the user's access token in the clear. https always;
 * http only when the caller says insecure origins are allowed (callers pass
 * `__DEV__`, matching `validateActionUrl`'s existing rule in this app).
 *
 * Injected rather than read from `__DEV__` here so both branches are testable:
 * jest-expo defines `__DEV__` as true, so a module-internal read would make
 * the deny branch unreachable from a test.
 */
export function isAllowedAuthOrigin(
  url: string,
  allowInsecure: boolean,
): boolean {
  try {
    const protocol = new URL(url).protocol
    if (protocol === "https:") return true
    return allowInsecure && protocol === "http:"
  } catch {
    return false
  }
}

// ── Claim sanitisation ──────────────────────────────────────────────────────

/**
 * Identity-provider text bound for a 10-foot screen: control characters and
 * newlines stripped, whitespace collapsed, length capped. A trailing lone high
 * surrogate left by the cap is dropped so an emoji at the boundary never
 * renders half-encoded. Anything that sanitises to empty becomes `undefined`.
 */
export function sanitizeIdpText(
  raw: unknown,
  maxChars: number,
): string | undefined {
  if (typeof raw !== "string") return undefined
  const collapsed = raw

    // Control characters first, then the invisible/bidi block: an
    // IdP-supplied name carrying U+202E reorders the row it renders into.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(
      /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029\ufeff]/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
  if (collapsed.length === 0) return undefined
  if (collapsed.length <= maxChars) return collapsed
  const cut = collapsed.slice(0, maxChars)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/**
 * Avatar URL gate: https only (no `__DEV__` carve-out — a missing avatar costs
 * nothing, and this string is handed straight to an image loader).
 */
export function sanitizeAvatarUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined
  try {
    return new URL(raw).protocol === "https:" ? raw : undefined
  } catch {
    return undefined
  }
}

/** Name first, then email. The UI owns the "no identity yet" placeholder. */
export function preferredDisplayName(identity: TvIdentity): string | undefined {
  return identity.name ?? identity.email
}

type RawClaims = Record<string, unknown>

function identityFromClaims(
  claims: RawClaims,
  source: IdentitySource,
): TvIdentity | null {
  const subject = sanitizeIdpText(claims.sub, 128)
  if (!subject) return null
  return {
    source,
    subject,
    name: sanitizeIdpText(claims.name, MAX_DISPLAY_NAME_CHARS),
    email: sanitizeIdpText(claims.email, MAX_EMAIL_CHARS),
    picture: sanitizeAvatarUrl(claims.picture),
    // Strict boolean: the string "true" must never read as verified.
    emailVerified:
      typeof claims.email_verified === "boolean"
        ? claims.email_verified
        : undefined,
  }
}

// ── userinfo (the real path) ────────────────────────────────────────────────

/**
 * The narrow slice of `fetch` this module uses. Structural on purpose: a test
 * stub returns `{ ok, status, text }` and nothing else, and the shape documents
 * exactly what is relied on.
 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    redirect?: "error" | "follow" | "manual"
    signal?: AbortSignal
  },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>

export type FetchUserInfoOptions = {
  authBaseUrl: string
  accessToken: string
  timeoutMs?: number
  /** Defaults to `__DEV__`; see `isAllowedAuthOrigin`. */
  allowInsecureOrigin?: boolean
  fetchImpl?: FetchLike
}

/**
 * GET the userinfo endpoint with the access token as a bearer.
 *
 * Never throws — an unhandled rejection in dev escalates to an all-native
 * RCTFatal with no JS message, and this runs on a screen-mount path.
 */
export async function fetchUserInfo({
  authBaseUrl,
  accessToken,
  timeoutMs = PROFILE_REQUEST_TIMEOUT_MS,
  allowInsecureOrigin = __DEV__,
  fetchImpl = fetch as FetchLike,
}: FetchUserInfoOptions): Promise<UserInfoResult> {
  if (!accessToken) return { kind: "unauthorized" }

  const url = buildAuthEndpointUrl(authBaseUrl, USERINFO_PATH)
  if (!isAllowedAuthOrigin(url, allowInsecureOrigin)) {
    // Enum token only, no URL and no claim values (R8 — nothing here is PII,
    // and keeping it token-only means it can never become PII by accident).
    console.warn("[tv-profile] event=userinfo_blocked reason=insecure_origin")
    return { kind: "unavailable" }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
      // React Native's XHR-backed fetch ignores this; the real protection is
      // that both platforms drop Authorization on a cross-origin redirect.
      // Kept because it is free and states the intent.
      redirect: "error",
      signal: controller.signal,
    })

    if (response.status === 401 || response.status === 403) {
      return { kind: "unauthorized" }
    }
    if (!response.ok) return { kind: "unavailable" }

    const body = await response.text()
    if (body.length > MAX_USERINFO_RESPONSE_CHARS)
      return { kind: "unavailable" }

    const parsed: unknown = JSON.parse(body)
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { kind: "unavailable" }
    }
    const identity = identityFromClaims(parsed as RawClaims, "userinfo")
    // A subject-less body is a broken response, not a signed-out user.
    return identity ? { kind: "ok", identity } : { kind: "unavailable" }
  } catch {
    // Timeout, offline, DNS, malformed JSON. The caught error is deliberately
    // not logged: a JSON parse failure can embed raw body fragments.
    return { kind: "unavailable" }
  } finally {
    clearTimeout(timer)
  }
}

// ── Offline display fallback (NOT verification) ─────────────────────────────

const B64_STANDARD =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function base64UrlToBytes(input: string): Uint8Array | null {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/")
  if (!/^[A-Za-z0-9+/]*$/.test(normalized)) return null
  const remainder = normalized.length % 4
  // A remainder of 1 cannot come from any byte sequence.
  if (remainder === 1) return null
  const padded =
    remainder === 0 ? normalized : normalized + "=".repeat(4 - remainder)

  const bytes: number[] = []
  for (let i = 0; i < padded.length; i += 4) {
    // The alphabet regex above already rejected anything else, so indexOf only
    // ever returns -1 for the padding we added ourselves.
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => {
      const char = padded[i + k]
      return char === "=" ? -1 : B64_STANDARD.indexOf(char)
    })
    if (a < 0 || b < 0) return null
    bytes.push(((a << 2) | (b >> 4)) & 0xff)
    if (c >= 0) bytes.push(((b << 4) | (c >> 2)) & 0xff)
    if (c >= 0 && d >= 0) bytes.push(((c << 6) | d) & 0xff)
  }
  return new Uint8Array(bytes)
}

/**
 * UTF-8 → string, hand-rolled rather than via `TextDecoder`: Hermes does not
 * guarantee one, and a name with non-Latin characters is the normal case, not
 * the edge case. Malformed input returns null (a JWT payload is valid UTF-8
 * JSON by construction, so malformed means "do not trust this").
 */
function utf8Decode(bytes: Uint8Array): string | null {
  let out = ""
  let i = 0
  while (i < bytes.length) {
    const b0 = bytes[i]
    let codePoint: number
    let size: number
    if (b0 < 0x80) {
      codePoint = b0
      size = 1
    } else if ((b0 & 0xe0) === 0xc0) {
      codePoint = b0 & 0x1f
      size = 2
    } else if ((b0 & 0xf0) === 0xe0) {
      codePoint = b0 & 0x0f
      size = 3
    } else if ((b0 & 0xf8) === 0xf0) {
      codePoint = b0 & 0x07
      size = 4
    } else {
      return null
    }
    if (i + size > bytes.length) return null
    for (let k = 1; k < size; k += 1) {
      const b = bytes[i + k]
      if ((b & 0xc0) !== 0x80) return null
      codePoint = (codePoint << 6) | (b & 0x3f)
    }
    if (codePoint > 0x10ffff) return null
    if (codePoint <= 0xffff) {
      out += String.fromCharCode(codePoint)
    } else {
      const v = codePoint - 0x10000
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
    }
    i += size
  }
  return out
}

/**
 * Decode an id_token's claims WITHOUT verifying anything.
 *
 * This does not check the signature, issuer, audience, or expiry, and it
 * cannot: apps/tv has no JWKS client (see the file header). It exists so a
 * cold launch or an offline TV can show a name instead of a placeholder.
 *
 * NEVER gate a security decision on the result. The returned identity is
 * tagged `id_token_unverified` precisely so that a caller that tries has to
 * write the untrustworthy word down.
 */
export function decodeIdTokenClaimsUnverified(
  idToken: string | undefined | null,
): TvIdentity | null {
  if (typeof idToken !== "string") return null
  if (idToken.length === 0 || idToken.length > MAX_ID_TOKEN_CHARS) return null
  const parts = idToken.split(".")
  // Exactly three: a five-part JWE is encrypted and there is nothing to read.
  if (parts.length !== 3) return null
  const bytes = base64UrlToBytes(parts[1])
  if (!bytes) return null
  const json = utf8Decode(bytes)
  if (json === null) return null
  try {
    const parsed: unknown = JSON.parse(json)
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null
    }
    return identityFromClaims(parsed as RawClaims, "id_token_unverified")
  } catch {
    return null
  }
}

// ── Cached display name (regular storage, display-only) ─────────────────────

/**
 * The cached name, sanitised again on the way out: a value written by an older
 * build with looser rules must not reach the screen unfiltered.
 */
export async function readCachedDisplayName(): Promise<string | undefined> {
  try {
    const raw = await getStorage().getItem(DISPLAY_NAME_STORAGE_KEY)
    return sanitizeIdpText(raw, MAX_DISPLAY_NAME_CHARS)
  } catch {
    return undefined
  }
}

/** Write (or, for an absent name, REMOVE) the cached display name. */
export async function writeCachedDisplayName(
  name: string | undefined,
): Promise<void> {
  const clean = sanitizeIdpText(name, MAX_DISPLAY_NAME_CHARS)
  try {
    if (!clean) {
      await getStorage().removeItem(DISPLAY_NAME_STORAGE_KEY)
      return
    }
    await getStorage().setItem(DISPLAY_NAME_STORAGE_KEY, clean)
  } catch {
    // Best-effort: a cold launch showing a placeholder is not a failure.
  }
}

/**
 * Sign-out hook. Load-bearing for account isolation on a shared TV: the cached
 * name is the PREVIOUS viewer's, so leaving it behind greets the next family
 * member with someone else's name.
 */
export async function clearCachedDisplayName(): Promise<void> {
  await writeCachedDisplayName(undefined)
}

/**
 * Mirror an identity's name into the cache — including CLEARING it when the
 * identity has no name, so a nameless account never inherits the previous
 * one's label.
 *
 * Only the name is cached. The email deliberately is not: this store is
 * unencrypted, and the plan asks for the display name specifically. An account
 * with no name shows the UI's own placeholder for the first frame.
 */
export async function cacheIdentityDisplayName(
  identity: TvIdentity,
): Promise<void> {
  await writeCachedDisplayName(identity.name)
}

// ── Composition ─────────────────────────────────────────────────────────────

export type ResolveTvIdentityOptions = FetchUserInfoOptions & {
  idToken?: string
}

/**
 * The whole U4.7 read: ask userinfo, fall back to the unverified id_token
 * decode, and mirror the resulting name into the cold-launch cache.
 *
 * The fallback fires on `unavailable` ONLY. On `unauthorized` the access token
 * was rejected, and synthesising an identity out of a stale id_token would
 * paint a dead session as a live one — exactly the state the caller needs to
 * see so it can refresh or sign out.
 *
 * A failed read never touches the cache: a network blip must not blank a name
 * that is still correct.
 */
export async function resolveTvIdentity(
  options: ResolveTvIdentityOptions,
): Promise<UserInfoResult> {
  const result = await fetchUserInfo(options)
  if (result.kind === "ok") {
    await cacheIdentityDisplayName(result.identity)
    return result
  }
  if (result.kind === "unauthorized") return result

  const fallback = decodeIdTokenClaimsUnverified(options.idToken)
  if (!fallback) return result
  await cacheIdentityDisplayName(fallback)
  return { kind: "ok", identity: fallback }
}
