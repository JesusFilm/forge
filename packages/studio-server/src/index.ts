export { studioHash } from "./hash"
// Node-only authenticated transport. No application imports or default credentials.
import { createHash } from "node:crypto"
import {
  SignJWT,
  importPKCS8,
  importSPKI,
  jwtVerify,
  decodeProtectedHeader,
} from "jose"
import { z } from "zod"
export class StudioBoundaryError extends Error {
  constructor(
    message: string,
    public status = 403,
  ) {
    super(message)
  }
}
export const studioAssertionSchema = z.object({
  sub: z.string().min(1),
  authority: z.enum(["interactive", "delegated"]),
  clientId: z.string().min(1),
  scopes: z.array(z.string()).max(16),
  environment: z.string(),
  digest: z.string(),
})
export type StudioCaller = Pick<
  z.infer<typeof studioAssertionSchema>,
  "sub" | "authority" | "clientId" | "scopes"
>
export async function signStudioRequest(
  body: string,
  audience: string,
  caller: StudioCaller,
  config: { privateKey: string; keyId: string; environment: string },
) {
  return new SignJWT({
    ...caller,
    environment: config.environment,
    digest: createHash("sha256").update(body).digest("hex"),
  })
    .setProtectedHeader({
      alg: "EdDSA",
      typ: "studio-service+jwt",
      kid: config.keyId,
    })
    .setIssuer("forge-manager")
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(await importPKCS8(config.privateKey.replaceAll("\\n", "\n"), "EdDSA"))
}
export async function verifyStudioRequest(
  token: string | null,
  body: string,
  audience: string,
  config: { publicKeys: string; environment: string },
) {
  try {
    if (!token || token.length > 8192)
      throw new StudioBoundaryError("Missing Studio assertion")
    const header = decodeProtectedHeader(token)
    const keys = z
      .record(z.string(), z.string())
      .parse(JSON.parse(config.publicKeys))
    if (
      header.typ !== "studio-service+jwt" ||
      !header.kid ||
      !Object.hasOwn(keys, header.kid)
    )
      throw new StudioBoundaryError("Invalid Studio key")
    const { payload } = await jwtVerify(
      token,
      await importSPKI(keys[header.kid]!.replaceAll("\\n", "\n"), "EdDSA"),
      { issuer: "forge-manager", audience, algorithms: ["EdDSA"] },
    )
    const caller = studioAssertionSchema.parse(payload)
    if (
      caller.environment !== config.environment ||
      caller.digest !== createHash("sha256").update(body).digest("hex") ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp - payload.iat > 60 ||
      payload.iat > Date.now() / 1000 + 5
    )
      throw new StudioBoundaryError("Invalid Studio assertion")
    return caller
  } catch {
    throw new StudioBoundaryError("Invalid Studio assertion")
  }
}
export async function readStudioBytes(
  request: Request | Response,
  limit = 524288,
) {
  if (!request.body) throw new StudioBoundaryError("Missing body", 400)
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) {
        await reader.cancel()
        throw new StudioBoundaryError("Body too large", 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString("utf8")
}
