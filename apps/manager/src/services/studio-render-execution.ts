import { createHash, sign, type KeyObject } from "node:crypto"
import { z } from "zod"
import {
  STUDIO_RENDER_PROFILE,
  STUDIO_RENDER_WIRE_BYTES,
  studioRenderAdmissionSchema,
  studioCodecProofSchema,
  type StudioRenderAdmission,
} from "@forge/studio-contracts/render"

export class StudioRenderTransportError extends Error {}

/** Fixed operator-configured service address. Never derived from a project or
 * returned redirect. Production uses private service networking, not the public
 * edge whose silence limit is shorter than a complete composition render. */
function executionOrigin(value: string) {
  const url = new URL(value)
  const local = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
  if (
    (!local && !url.hostname.endsWith(".railway.internal")) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new StudioRenderTransportError(
      "Execution requires a dedicated private service origin",
    )
  return url
}
async function boundedBody(response: Response, limit: number) {
  const reader = response.body?.getReader()
  if (!reader)
    throw new StudioRenderTransportError("Missing execution response")
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit)
        throw new StudioRenderTransportError(
          "Execution response limit exceeded",
        )
      chunks.push(value)
    }
    return Buffer.concat(chunks, length)
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}
const healthSchema = z.object({
  instanceId: z.uuid(),
  healthy: z.literal(true),
  busy: z.literal(false),
  profileId: z.literal(STUDIO_RENDER_PROFILE.id),
})

/** Only the public admission verification key is installed in the executor.
 * This broker retains signing authority; no user OAuth, DB or provider secret
 * is sent with the immutable input. HTTP disconnect cancels native execution. */
export async function executeStudioRenderRequest(
  config: { endpoint: string; privateKey: KeyObject },
  job: Pick<
    StudioRenderAdmission,
    "attemptId" | "leaseId" | "inputHash" | "input" | "files"
  > & { leaseExpiresAt: number },
  parent: AbortSignal,
) {
  const origin = executionOrigin(config.endpoint)
  if (config.privateKey.asymmetricKeyType !== "ed25519")
    throw new StudioRenderTransportError(
      "Ed25519 execution signing key required",
    )
  const signal = AbortSignal.any([
    parent,
    AbortSignal.timeout(STUDIO_RENDER_PROFILE.requestMs),
  ])
  const remaining = () => job.leaseExpiresAt - Date.now()
  const required =
    STUDIO_RENDER_PROFILE.requestMs + STUDIO_RENDER_PROFILE.retentionMs
  if (remaining() < required)
    throw new StudioRenderTransportError("Insufficient execution lease")
  const healthResponse = await fetch(new URL("/health", origin), {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
  })
  if (!healthResponse.ok) {
    await healthResponse.body?.cancel()
    throw new StudioRenderTransportError("Executor unavailable")
  }
  const health = healthSchema.parse(
    JSON.parse((await boundedBody(healthResponse, 8192)).toString()),
  )
  if (remaining() < required)
    throw new StudioRenderTransportError("Insufficient execution lease")
  const issuedAt = Date.now()
  const admission = studioRenderAdmissionSchema.parse({
    version: 1,
    profileId: STUDIO_RENDER_PROFILE.id,
    instanceId: health.instanceId,
    attemptId: job.attemptId,
    leaseId: job.leaseId,
    inputHash: job.inputHash,
    issuedAt,
    expiresAt: issuedAt + STUDIO_RENDER_PROFILE.uploadMs,
    executionExpiresAt: issuedAt + STUDIO_RENDER_PROFILE.jobMs,
    input: job.input,
    files: job.files,
  })
  const body = Buffer.from(JSON.stringify(admission))
  if (body.length > STUDIO_RENDER_WIRE_BYTES)
    throw new StudioRenderTransportError("Execution input limit exceeded")
  const response = await fetch(new URL("/render", origin), {
    method: "POST",
    body,
    redirect: "error",
    cache: "no-store",
    signal,
    headers: {
      "content-type": "application/json",
      "x-shorts-admission": sign(null, body, config.privateKey).toString(
        "base64",
      ),
    },
  })
  if (!response.ok) {
    const detail = (await boundedBody(response, 8192)).toString()
    throw new StudioRenderTransportError(
      `Execution rejected (${response.status}): ${detail}`,
    )
  }
  try {
    if (
      response.headers.get("x-shorts-attempt") !== job.attemptId ||
      response.headers.get("x-shorts-lease") !== job.leaseId ||
      response.headers.get("content-type") !== "video/mp4"
    )
      throw new StudioRenderTransportError(
        "Execution response binding rejected",
      )
    const encoded = response.headers.get("x-shorts-verification") ?? ""
    if (encoded.length > 12000)
      throw new StudioRenderTransportError("Codec proof limit exceeded")
    const proof = studioCodecProofSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64").toString()),
    )
    const output = await boundedBody(
      response,
      STUDIO_RENDER_PROFILE.outputBytes,
    )
    const digest = createHash("sha256").update(output).digest("hex")
    if (
      !output.length ||
      digest !== proof.outputDigest ||
      digest !== response.headers.get("x-shorts-output-sha256")
    )
      throw new StudioRenderTransportError("Execution output digest mismatch")
    const document = job.input.document
    if (
      proof.video.width !== document.width ||
      proof.video.height !== document.height ||
      proof.video.fps !== document.fps ||
      proof.video.frames !== document.durationInFrames ||
      Math.abs(
        proof.video.durationMs -
          (1000 * document.durationInFrames) / document.fps,
      ) > 100 ||
      Math.abs(proof.audio.durationMs - proof.video.durationMs) > 100
    )
      throw new StudioRenderTransportError(
        "Execution codec dimensions/duration mismatch",
      )
    return { output, proof }
  } finally {
    if (!response.bodyUsed) await response.body?.cancel()
  }
}
