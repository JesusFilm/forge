import { createHash } from "node:crypto"
import { decodeProtectedHeader, importSPKI, jwtVerify } from "jose"
import { z } from "zod"
import { STUDIO_INTERACTIVE_AUDIENCE } from "@forge/studio-contracts/transport"
import { env } from "@/config/env"
import { ForbiddenError } from "@/services/errors"

export async function verifyStudioInteractive(
  assertion: string | null,
  body: string,
) {
  if (
    !assertion ||
    assertion.length > 8192 ||
    !env.STUDIO_INTERACTIVE_PUBLIC_KEYS
  )
    throw new ForbiddenError("Studio interactive transport is not configured")
  try {
    const header = decodeProtectedHeader(assertion)
    if (
      header.alg !== "EdDSA" ||
      header.typ !== "shorts-interactive+jwt" ||
      !header.kid
    )
      throw new ForbiddenError()
    const keys = z
      .record(z.string(), z.string())
      .parse(JSON.parse(env.STUDIO_INTERACTIVE_PUBLIC_KEYS))
    const pem = Object.hasOwn(keys, header.kid) ? keys[header.kid] : undefined
    if (!pem) throw new ForbiddenError()
    const { payload } = await jwtVerify(
      assertion,
      await importSPKI(pem.replaceAll("\\n", "\n"), "EdDSA"),
      {
        algorithms: ["EdDSA"],
        issuer: "forge-manager",
        audience: STUDIO_INTERACTIVE_AUDIENCE,
      },
    )
    if (
      typeof payload.sub !== "string" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp - payload.iat > 60 ||
      payload.iat > Date.now() / 1000 + 5 ||
      payload.environment !== env.STUDIO_ENVIRONMENT ||
      payload.digest !== createHash("sha256").update(body).digest("hex")
    )
      throw new ForbiddenError()
    return payload.sub
  } catch {
    throw new ForbiddenError("Invalid Studio interactive assertion")
  }
}
