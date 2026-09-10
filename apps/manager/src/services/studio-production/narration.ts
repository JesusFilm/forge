import { StudioProductionError } from "@/services/studio-production/errors"
import { createHash } from "node:crypto"
import { z } from "zod"
import { env } from "@/config/env"
import {
  studioAssetReferenceSchema,
  studioCommandResultSchema,
} from "@forge/studio-contracts"
import {
  studioAssetVersionSchema,
  type StudioNarrationIdentity,
} from "@forge/studio-contracts/assets"
import { studioNarrationPlanSchema } from "@forge/studio-contracts/production"
import type { StudioInteractiveClient } from "@/backend/studio-interactive"
import { ElevenStudioProvider } from "./provider"
import { studioProductionClient } from "./transport"
import { measureStudioAudio } from "./audio"
import {
  narrationInputDigest,
  StudioRetainedAudioError,
  runStudioNarration,
  type NarrationAudio,
} from "./runner"
import { narrationReserve, readStudioRates } from "./rates"
export async function narrationQuote(
  call: StudioInteractiveClient,
  input: { projectId: string; expectedRevision: number },
) {
  const plan = studioNarrationPlanSchema.parse(
      await call("narration-plan", input),
    ),
    card = readStudioRates(env.STUDIO_PRODUCTION_RATE_CARD)
  let estimateMicros = 0,
    unavailable: string | null = null
  const identities = new Set<string>()
  for (const s of plan.segments) {
    const digest = narrationInputDigest(s.identity)
    if (s.matches.length || identities.has(digest)) continue
    identities.add(digest)
    try {
      estimateMicros += narrationReserve(card, s.identity)
    } catch (e) {
      unavailable = e instanceof Error ? e.message : "Rate unavailable"
    }
  }
  return {
    plan,
    estimateMicros: unavailable ? null : estimateMicros,
    basis: card?.basis ?? "Existing exact cache only",
    expiresAt: card?.verifiedUntil ?? null,
    unavailable,
  }
}
export async function executeNarration(
  userId: string,
  call: StudioInteractiveClient,
  runId: string,
) {
  const production = studioProductionClient(userId, runId)
  const context = z
    .object({
      run: z.object({ state: z.string() }),
      attempt: z.object({ projectId: z.string(), baseRevision: z.number() }),
    })
    .parse(await production.call("context", {}))
  if (context.run.state !== "READY") return context.run
  const plan = studioNarrationPlanSchema.parse(
    await call("narration-plan", {
      projectId: context.attempt.projectId,
      expectedRevision: context.attempt.baseRevision,
    }),
  )
  const card = readStudioRates(env.STUDIO_PRODUCTION_RATE_CARD),
    provider = new ElevenStudioProvider({ key: env.ELEVENLABS_API_KEY ?? "" })
  const cached = async (
    reference: z.infer<typeof studioAssetReferenceSchema>,
    identity: StudioNarrationIdentity,
  ): Promise<NarrationAudio | null> => {
    const asset = studioAssetVersionSchema.parse(
        await call("asset", reference),
      ),
      duration = asset.provenance.recorded.durationMs
    return asset.role === "narration" &&
      asset.narration &&
      narrationInputDigest(asset.narration) ===
        narrationInputDigest(identity) &&
      typeof duration === "number" &&
      Number.isSafeInteger(duration) &&
      duration > 0
      ? { asset: reference, durationMs: duration }
      : null
  }
  return runStudioNarration({
    segments: plan.segments,
    reserveMicros: (identity) => narrationReserve(card, identity),
    port: {
      cached,
      claim: async (key, inputDigest, reserveMicros) => {
        const claim = z
          .object({
            execute: z.boolean(),
            call: z.object({
              state: z.string(),
              result: z.unknown().nullable(),
            }),
          })
          .parse(
            await production.call("claim", { key, inputDigest, reserveMicros }),
          )
        let audio: NarrationAudio | null = null
        if (!claim.execute && claim.call.state === "COMPLETED") {
          const result = z
              .object({ assets: z.array(studioAssetReferenceSchema) })
              .parse(claim.call.result),
            segment = plan.segments.find(
              (s) => narrationInputDigest(s.identity) === inputDigest,
            )
          if (result.assets[0] && segment)
            audio = await cached(result.assets[0], segment.identity)
        }
        return {
          execute: claim.execute,
          state: claim.call.state,
          audio: audio ?? undefined,
        }
      },
      narrate: async (identity) => {
        const segment = plan.segments.find(
          (s) =>
            narrationInputDigest(s.identity) === narrationInputDigest(identity),
        )
        if (!segment)
          throw new StudioProductionError("Speech identity was not admitted")
        const dictionaries = segment.pronunciationLocators
        return {
          ...(await provider.narrate(identity, dictionaries)),
          actualCostMicros: null,
        }
      },
      retain: async (output, identity, key) => {
        let durationMs: number | null = null
        try {
          durationMs = await measureStudioAudio(output.bytes)
        } catch {
          /* Retain paid bytes even when decoding fails. */
        }
        const asset = await production.upload(
          {
            idempotencyKey: `${runId}:${key}`,
            filename: "narration.mp3",
            mimeType: "audio/mpeg",
            role: "narration",
            narration: identity,
            dependencies: identity.pronunciation
              ? [identity.pronunciation]
              : [],
            provenance: {
              status: "recorded",
              recorded: {
                runId,
                providerRequestId: output.requestId,
                providerObservedText: identity.text,
                durationMs,
                mediaValidated: durationMs !== null,
                credits: output.credits,
                actualCostMicros: output.actualCostMicros,
              },
            },
          },
          output.bytes,
        )
        if (durationMs === null)
          throw new StudioRetainedAudioError(asset.reference)
        return { asset: asset.reference, durationMs }
      },
      finish: async (key, result) => {
        await production.call("finish", {
          key,
          state: result.state,
          result: {
            assets: result.audio
              ? [result.audio.asset]
              : (result.retainedAssets ?? []),
            actualCostMicros: result.actualCostMicros,
            credits: result.credits,
            requestId: result.requestId,
            elapsedMs: result.elapsedMs,
            ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
          },
        })
      },
      attach: async (entries) => {
        if (!entries.length)
          throw new StudioProductionError("No effective spoken text to narrate")
        const chunks: z.infer<typeof studioAssetReferenceSchema>[] = []
        let pending: typeof entries = []
        const flush = async () => {
          const bytes = Buffer.from(
            JSON.stringify({ version: 1, entries: pending }),
          )
          const asset = await production.upload(
            {
              idempotencyKey: `${runId}:chunk:${chunks.length}`,
              filename: "narration-chunk.json",
              mimeType: "application/json",
              role: "manifest",
              dependencies: [
                ...new Map(
                  pending.map((e) => [e.asset.versionId, e.asset]),
                ).values(),
              ],
              provenance: { status: "recorded", recorded: { runId } },
            },
            bytes,
          )
          chunks.push(asset.reference)
          pending = []
        }
        for (const entry of entries) {
          if (
            pending.length &&
            (pending.length === 64 ||
              Buffer.byteLength(
                JSON.stringify({ version: 1, entries: [...pending, entry] }),
              ) > 32768)
          )
            await flush()
          pending.push(entry)
        }
        if (pending.length) await flush()
        if (chunks.length > 16)
          throw new StudioProductionError(
            "Narration manifest exceeds its chunk bound; split this project explicitly",
          )
        const bytes = Buffer.from(JSON.stringify({ version: 1, chunks }))
        const manifest = await production.upload(
          {
            idempotencyKey: `${runId}:manifest:${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`,
            filename: "narration-manifest.json",
            mimeType: "application/json",
            role: "manifest",
            dependencies: chunks,
            provenance: {
              status: "recorded",
              recorded: { runId, estimateBasis: card?.basis ?? null },
            },
          },
          bytes,
        )
        const finalContext = z
          .object({ run: z.object({ calls: z.array(z.unknown()) }) })
          .parse(await production.call("context", {}))
        const costMicros = finalContext.run.calls.length === 0 ? 0 : null
        return studioCommandResultSchema.parse(
          await production.call("narration-complete", {
            idempotencyKey: `${runId}:complete`,
            manifest: manifest.reference,
            costMicros,
          }),
        )
      },
    },
  })
}
