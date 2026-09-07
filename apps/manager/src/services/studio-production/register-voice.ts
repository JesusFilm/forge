import { StudioProductionError } from "@/services/studio-production/errors"
import { createHash } from "node:crypto"
import { z } from "zod"
import { env } from "@/config/env"
import type { StudioInteractiveClient } from "@/backend/studio-interactive"
import { studioAssetReferenceSchema } from "@forge/studio-contracts"
import { studioAssetVersionSchema } from "@forge/studio-contracts/assets"
import { studioExperimentRequestSchema } from "@forge/studio-contracts/experiments"
import { studioProductionClient } from "./transport"
import { ElevenStudioProvider, StudioProviderError } from "./provider"
import { readStudioRates } from "./rates"
export async function registerExperimentVoice(
  userId: string,
  call: StudioInteractiveClient,
  input: { runId: string; candidateKey: string; name: string },
) {
  const production = studioProductionClient(userId, input.runId)
  const context = z
    .object({
      experiment: z.object({
        id: z.string(),
        request: studioExperimentRequestSchema,
        selection: z.object({ candidateKey: z.string() }).nullable(),
        candidates: z.array(
          z.object({
            candidateKey: z.string(),
            asset: studioAssetReferenceSchema,
          }),
        ),
      }),
    })
    .parse(await production.call("context", {}))
  const experiment = context.experiment,
    candidate = experiment.candidates.find(
      (c) => c.candidateKey === input.candidateKey,
    ),
    rate = readStudioRates(env.STUDIO_PRODUCTION_RATE_CARD)?.voice.find(
      (r) => r.model === experiment.request.model,
    )
  if (
    experiment.request.kind !== "voice" ||
    !candidate ||
    experiment.selection?.candidateKey !== candidate.candidateKey ||
    !rate
  )
    throw new StudioProductionError(
      "Select an auditioned voice and verify registration rate before registration",
    )
  const preview = studioAssetVersionSchema.parse(
    await call("asset", candidate.asset),
  )
  if (
    !preview.voice ||
    preview.provenance.recorded.registrationStatus !== "preview" ||
    preview.provenance.recorded.languageMatch !== true ||
    preview.provenance.recorded.previewTextMatch !== true ||
    preview.provenance.recorded.mediaValidated !== true
  )
    throw new StudioProductionError(
      "Registration requires a decoded preview with matching author language and exact requested preview text",
    )
  // Read and verify the already-retained preview before consuming a registration call.
  const grant = z
    .object({ path: z.string() })
    .parse(await call("asset-read", candidate.asset))
  if (
    !env.ADMIN_GRAPHQL_URL ||
    !/^\/api\/studio\/assets\/transfer\/[a-f0-9]{64}$/.test(grant.path) ||
    preview.byteSize > 24 * 1024 * 1024
  )
    throw new StudioProductionError("Preview transfer unavailable")
  const response = await fetch(new URL(grant.path, env.ADMIN_GRAPHQL_URL), {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok || !response.body)
    throw new StudioProductionError("Preview read failed")
  const reader = response.body.getReader(),
    parts: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > preview.byteSize)
        throw new StudioProductionError("Preview size mismatch")
      parts.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const bytes = Buffer.concat(parts)
  if (
    size !== preview.byteSize ||
    createHash("sha256").update(bytes).digest("hex") !== candidate.asset.digest
  )
    throw new StudioProductionError("Preview digest mismatch")
  const key = `register-${candidate.candidateKey}`,
    inputDigest = createHash("sha256")
      .update(
        JSON.stringify({
          candidate: candidate.asset,
          name: input.name,
          voiceId: preview.voice.voiceId,
        }),
      )
      .digest("hex")
  const claim = z
    .object({
      execute: z.boolean(),
      call: z.object({ state: z.string(), result: z.unknown().nullable() }),
    })
    .parse(
      await production.call("claim", {
        key,
        inputDigest,
        reserveMicros: Math.ceil(rate.registrationMicros),
      }),
    )
  let registered: z.infer<typeof studioAssetReferenceSchema>
  if (!claim.execute) {
    if (claim.call.state !== "COMPLETED")
      throw new StudioProductionError(
        "Voice registration response is ambiguous or failed; do not repeat it",
      )
    registered = z
      .object({ assets: z.array(studioAssetReferenceSchema).min(1) })
      .parse(claim.call.result).assets[0]
  } else {
    const started = Date.now()
    let providerVoiceId: string | null = null,
      requestId: string | null = null
    try {
      const result = await new ElevenStudioProvider({
        key: env.ELEVENLABS_API_KEY ?? "",
      }).registerVoice({
        voiceId: preview.voice.voiceId,
        name: input.name,
        description: experiment.request.prompt,
      })
      providerVoiceId = result.voice_id
      requestId = result.requestId
      const asset = await production.upload(
        {
          idempotencyKey: `${input.runId}:${key}`,
          filename: `${input.name}.mp3`,
          mimeType: preview.mimeType,
          role: "voice",
          voice: { ...preview.voice, voiceId: result.voice_id },
          dependencies: [candidate.asset],
          provenance: {
            status: "recorded",
            recorded: {
              runId: input.runId,
              experimentId: experiment.id,
              candidateKey: candidate.candidateKey,
              registrationStatus: "registered",
              provider: experiment.request.provider,
              providerVoiceId,
              providerRequestId: requestId,
              name: input.name,
              durationMs: preview.provenance.recorded.durationMs ?? null,
              actualCostMicros: null,
            },
          },
        },
        bytes,
      )
      registered = asset.reference
    } catch (error) {
      await production.call("finish", {
        key,
        state:
          error instanceof StudioProviderError && !error.ambiguous
            ? "FAILED"
            : "AMBIGUOUS",
        result: {
          assets: [],
          requestId,
          actualCostMicros: null,
          credits: null,
          elapsedMs: Date.now() - started,
          providerMetadata: { providerVoiceId },
          diagnostic:
            "Voice registration/retention unconfirmed; inspect provider ID before any new registration",
        },
      })
      throw error
    }
    await production.call("finish", {
      key,
      state: "COMPLETED",
      result: {
        assets: [registered],
        requestId,
        actualCostMicros: null,
        credits: null,
        elapsedMs: Date.now() - started,
        providerMetadata: { providerVoiceId },
      },
    })
  }
  await call("experiment-select", {
    experimentId: experiment.id,
    candidateKey: candidate.candidateKey,
    idempotencyKey: `${input.runId}:${key}:select`,
    registeredVoice: registered,
  })
  return { experimentId: experiment.id, registeredVoice: registered }
}
