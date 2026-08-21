import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto"
import { isIP } from "node:net"

import {
  adaptPublicUserPlaylist,
  type PublicUserPlaylist,
} from "./user-playlist-public-contract"
import { PUBLIC_USER_PLAYLIST_QUERY_SOURCE } from "./user-playlist-public-operations"
import {
  consumePublicUserPlaylistIngress,
  type PublicUserPlaylistIngressDecision,
  type PublicUserPlaylistIngressInput,
} from "./user-playlist-public-rate-limit"

export type PublicUserPlaylistBoundaryDecision =
  | "available"
  | "unavailable"
  | "service-unavailable"

export type PublicUserPlaylistBoundaryResult =
  | { kind: "available"; playlist: PublicUserPlaylist }
  | { kind: "unavailable" }
  | { kind: "service-unavailable" }

type BoundaryDependencies = {
  fetch: typeof fetch
  consume: (
    input: PublicUserPlaylistIngressInput,
  ) => Promise<PublicUserPlaylistIngressDecision>
  adminGraphqlUrl?: string
  consumerBearer?: string
  contextSecret?: string
  now: () => Date
}

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/
const CLOUDFLARE_RAY_PATTERN = /^[A-Fa-f0-9]{16,32}(?:-[A-Za-z0-9]{2,10})?$/
const MAX_RESPONSE_BYTES = 1_000_000
const UPSTREAM_TIMEOUT_MS = 5_000
const INTERNAL_CAPABILITY_MAX_AGE_MS = 30_000

export const PUBLIC_USER_PLAYLIST_CAPABILITY_HEADER =
  "x-forge-public-playlist-capability"

function internalCapabilityKey(secret: string): Buffer {
  return createHash("sha256")
    .update("forge:web:public-playlist:internal-capability:v1\0", "utf8")
    .update(secret, "utf8")
    .digest()
}

function strictBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  const decoded = Buffer.from(value, "base64url")
  return decoded.toString("base64url") === value ? decoded : null
}

/**
 * Keep the public URL capability out of Next's dynamic route tree and RSC
 * bootstrap. The proxy rewrites to a fixed segment and carries this encrypted
 * one-request envelope to the server component instead.
 */
export function sealPublicUserPlaylistCapability(
  capability: string,
  options: { secret: string; now: Date },
): string | null {
  if (
    !CAPABILITY_PATTERN.test(capability) ||
    Buffer.byteLength(options.secret, "utf8") < 32
  ) {
    return null
  }
  const nonce = randomBytes(12)
  const cipher = createCipheriv(
    "aes-256-gcm",
    internalCapabilityKey(options.secret),
    nonce,
  )
  const ciphertext = Buffer.concat([
    cipher.update(
      JSON.stringify({ capability, issuedAt: options.now.getTime() }),
      "utf8",
    ),
    cipher.final(),
  ])
  return [
    "v1",
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".")
}

export function openPublicUserPlaylistCapability(
  envelope: string | null,
  options: { secret: string; now: Date },
): string | null {
  if (
    !envelope ||
    envelope.length > 1_024 ||
    Buffer.byteLength(options.secret, "utf8") < 32
  ) {
    return null
  }
  const [version, encodedNonce, encodedCiphertext, encodedTag, extra] =
    envelope.split(".")
  if (
    version !== "v1" ||
    !encodedNonce ||
    !encodedCiphertext ||
    !encodedTag ||
    extra
  ) {
    return null
  }
  try {
    const nonce = strictBase64Url(encodedNonce)
    const ciphertext = strictBase64Url(encodedCiphertext)
    const tag = strictBase64Url(encodedTag)
    if (
      !nonce ||
      nonce.length !== 12 ||
      !ciphertext ||
      ciphertext.length === 0 ||
      !tag ||
      tag.length !== 16
    ) {
      return null
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      internalCapabilityKey(options.secret),
      nonce,
    )
    decipher.setAuthTag(tag)
    const payload = JSON.parse(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        "utf8",
      ),
    ) as { capability?: unknown; issuedAt?: unknown }
    if (
      typeof payload.capability !== "string" ||
      !CAPABILITY_PATTERN.test(payload.capability) ||
      typeof payload.issuedAt !== "number" ||
      !Number.isSafeInteger(payload.issuedAt) ||
      payload.issuedAt > options.now.getTime() + 5_000 ||
      options.now.getTime() - payload.issuedAt > INTERNAL_CAPABILITY_MAX_AGE_MS
    ) {
      return null
    }
    return payload.capability
  } catch {
    return null
  }
}

function defaults(): BoundaryDependencies {
  return {
    fetch: globalThis.fetch,
    consume: consumePublicUserPlaylistIngress,
    adminGraphqlUrl: process.env.ADMIN_GRAPHQL_URL,
    consumerBearer: process.env.WEB_ADMIN_API_KEYS?.split(",")[0]?.trim(),
    contextSecret: process.env.USER_PLAYLIST_TRUSTED_CONTEXT_HMAC_SECRET,
    now: () => new Date(),
  }
}

let dependencyOverride: Partial<BoundaryDependencies> | undefined

export function setPublicUserPlaylistBoundaryDependenciesForTest(
  dependencies?: Partial<BoundaryDependencies>,
): void {
  dependencyOverride = dependencies
}

function dependencies(): BoundaryDependencies {
  return { ...defaults(), ...dependencyOverride }
}

export type TrustedPublicUserPlaylistContext = {
  countryCode: string | null
  viewerIp: string | null
}

export function trustedPublicUserPlaylistContext(
  requestHeaders: Headers,
): TrustedPublicUserPlaylistContext {
  const ray = requestHeaders.get("cf-ray")
  if (!ray || !CLOUDFLARE_RAY_PATTERN.test(ray)) {
    return { countryCode: null, viewerIp: null }
  }
  const country = requestHeaders.get("cf-ipcountry")?.toUpperCase() ?? ""
  const candidateIp = requestHeaders.get("cf-connecting-ip")
  return {
    countryCode:
      /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1"
        ? country
        : null,
    viewerIp:
      candidateIp &&
      candidateIp === candidateIp.trim() &&
      isIP(candidateIp) !== 0
        ? candidateIp
        : null,
  }
}

export function signedPublicUserPlaylistContext(
  context: TrustedPublicUserPlaylistContext,
  options: { secret: string; now: Date },
): Record<
  "x-forge-viewer-context" | "x-forge-viewer-context-signature",
  string
> {
  const encoded = Buffer.from(
    JSON.stringify({
      countryCode: context.countryCode,
      viewerIp: context.viewerIp,
      issuedAt: options.now.getTime(),
    }),
    "utf8",
  ).toString("base64url")
  return {
    "x-forge-viewer-context": encoded,
    "x-forge-viewer-context-signature": createHmac("sha256", options.secret)
      .update(encoded, "ascii")
      .digest("base64url"),
  }
}

function validConfiguration(
  deps: BoundaryDependencies,
): deps is BoundaryDependencies & {
  adminGraphqlUrl: string
  consumerBearer: string
  contextSecret: string
} {
  if (
    !deps.adminGraphqlUrl ||
    !deps.consumerBearer ||
    !deps.contextSecret ||
    Buffer.byteLength(deps.contextSecret, "utf8") < 32
  ) {
    return false
  }
  try {
    const url = new URL(deps.adminGraphqlUrl)
    return url.protocol === "https:" || url.hostname === "localhost"
  } catch {
    return false
  }
}

function serviceUnavailableError(payload: unknown): boolean {
  if (typeof payload !== "object" || payload == null) return false
  const errors = (payload as { errors?: unknown }).errors
  if (!Array.isArray(errors)) return false
  return errors.some((entry) => {
    if (typeof entry !== "object" || entry == null) return false
    const extensions = (entry as { extensions?: unknown }).extensions
    return (
      typeof extensions === "object" &&
      extensions != null &&
      (extensions as { code?: unknown }).code === "SERVICE_UNAVAILABLE"
    )
  })
}

async function fetchPlaylist(
  capability: string,
  context: TrustedPublicUserPlaylistContext,
  deps: BoundaryDependencies & {
    adminGraphqlUrl: string
    consumerBearer: string
    contextSecret: string
  },
  now: Date,
): Promise<PublicUserPlaylistBoundaryResult> {
  let response: Response
  try {
    response = await deps.fetch(deps.adminGraphqlUrl, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${deps.consumerBearer}`,
        ...signedPublicUserPlaylistContext(context, {
          secret: deps.contextSecret,
          now,
        }),
      },
      body: JSON.stringify({
        operationName: "PublicUserPlaylist",
        query: PUBLIC_USER_PLAYLIST_QUERY_SOURCE,
        variables: { token: capability },
      }),
    })
  } catch {
    return { kind: "service-unavailable" }
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0")
  if (contentLength > MAX_RESPONSE_BYTES) return { kind: "service-unavailable" }
  let text: string
  try {
    text = await response.text()
  } catch {
    return { kind: "service-unavailable" }
  }
  if (text.length > MAX_RESPONSE_BYTES) return { kind: "service-unavailable" }

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return { kind: "service-unavailable" }
  }
  if (response.status >= 500 || serviceUnavailableError(payload)) {
    return { kind: "service-unavailable" }
  }
  if (!response.ok) return { kind: "unavailable" }
  const data =
    typeof payload === "object" && payload != null
      ? (payload as { data?: unknown }).data
      : null
  const playlist =
    typeof data === "object" && data != null
      ? (data as { userPlaylistByToken?: unknown }).userPlaylistByToken
      : null
  const adapted = adaptPublicUserPlaylist(playlist)
  return adapted
    ? { kind: "available", playlist: adapted }
    : { kind: "unavailable" }
}

export async function resolvePublicUserPlaylistAtBoundary(input: {
  capability: string
  requestHeaders: Headers
}): Promise<PublicUserPlaylistBoundaryResult> {
  if (!CAPABILITY_PATTERN.test(input.capability)) return { kind: "unavailable" }
  const deps = dependencies()
  if (!validConfiguration(deps)) return { kind: "service-unavailable" }
  const context = trustedPublicUserPlaylistContext(input.requestHeaders)
  const now = deps.now()
  const decision = await deps.consume({
    action: "read",
    capabilityDigest: createHash("sha256")
      .update(input.capability, "ascii")
      .digest("base64url"),
    viewerIp: context.viewerIp,
    now,
  })
  if (decision === "limited") return { kind: "unavailable" }
  if (decision !== "admitted") return { kind: "service-unavailable" }
  return fetchPlaylist(input.capability, context, deps, now)
}

export async function preflightPublicUserPlaylist(input: {
  capability: string
  requestHeaders: Headers
}): Promise<PublicUserPlaylistBoundaryDecision> {
  return (await resolvePublicUserPlaylistAtBoundary(input)).kind
}

type Preflight = typeof preflightPublicUserPlaylist
let preflightOverride: Preflight | undefined

export function setPublicUserPlaylistPreflightForTest(
  preflight?: Preflight,
): void {
  preflightOverride = preflight
}

export function runPublicUserPlaylistPreflight(
  input: Parameters<Preflight>[0],
): ReturnType<Preflight> {
  return (preflightOverride ?? preflightPublicUserPlaylist)(input)
}
