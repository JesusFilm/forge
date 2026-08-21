import { createHmac, timingSafeEqual } from "node:crypto"
import { isIP } from "node:net"
import { z } from "zod"
import type { TrustedUserPlaylistReporterIp } from "@/services/user-playlist-report-crypto"
import type { VerifiedViewerCountryContext } from "@/services/user-playlist.service"

const MAX_CONTEXT_AGE_MS = 5 * 60_000
const ViewerContextSchema = z
  .object({
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    viewerIp: z
      .string()
      .refine((value) => isIP(value) !== 0)
      .nullable(),
    issuedAt: z.number().int().nonnegative(),
  })
  .strict()

export type TrustedUserPlaylistRequestContext = {
  viewerCountry: VerifiedViewerCountryContext | null
  reporterIp: TrustedUserPlaylistReporterIp | null
}

const UNTRUSTED_CONTEXT: TrustedUserPlaylistRequestContext = {
  viewerCountry: null,
  reporterIp: null,
}

function equalBase64UrlSignature(expected: Buffer, candidate: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(candidate)) return false
  const decoded = Buffer.from(candidate, "base64url")
  return (
    decoded.byteLength === expected.byteLength &&
    timingSafeEqual(decoded, expected)
  )
}

/**
 * Accepts viewer geography/IP only from a server-to-server HMAC envelope.
 * Cloudflare/X-Forwarded headers are deliberately ignored here: Web egress is
 * not the visitor IP and direct GraphQL callers may spoof forwarded headers.
 */
export function resolveTrustedUserPlaylistRequestContext(
  request: Request,
  options: { secret?: string; now?: () => Date },
): TrustedUserPlaylistRequestContext {
  const secret = options.secret
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    return UNTRUSTED_CONTEXT
  }
  const encoded = request.headers.get("x-forge-viewer-context")
  const signature = request.headers.get("x-forge-viewer-context-signature")
  if (!encoded || !signature || !/^[A-Za-z0-9_-]{1,1024}$/.test(encoded)) {
    return UNTRUSTED_CONTEXT
  }
  const expected = createHmac("sha256", secret)
    .update(encoded, "ascii")
    .digest()
  if (!equalBase64UrlSignature(expected, signature)) return UNTRUSTED_CONTEXT

  let decoded: unknown
  try {
    const bytes = Buffer.from(encoded, "base64url")
    if (bytes.toString("base64url") !== encoded) return UNTRUSTED_CONTEXT
    decoded = JSON.parse(bytes.toString("utf8"))
  } catch {
    return UNTRUSTED_CONTEXT
  }
  const payload = ViewerContextSchema.safeParse(decoded)
  if (!payload.success) return UNTRUSTED_CONTEXT
  const age =
    (options.now ?? (() => new Date()))().getTime() - payload.data.issuedAt
  if (age < -30_000 || age > MAX_CONTEXT_AGE_MS) return UNTRUSTED_CONTEXT

  return {
    viewerCountry:
      payload.data.countryCode == null
        ? null
        : {
            integrityVerified: true,
            countryCode: payload.data.countryCode,
          },
    reporterIp:
      payload.data.viewerIp == null
        ? null
        : {
            integrityVerified: true,
            normalizedIp: payload.data.viewerIp,
          },
  }
}
