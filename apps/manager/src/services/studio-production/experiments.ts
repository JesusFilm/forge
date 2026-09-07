import { StudioProductionError } from "@/services/studio-production/errors"
import { createHash } from "node:crypto"
import { z } from "zod"
import { env } from "@/config/env"
import type { StudioInteractiveClient } from "@/backend/studio-interactive"
import {
  studioExperimentDraftSchema,
  studioExperimentRequestSchema,
} from "@forge/studio-contracts/experiments"
import { studioAssetReferenceSchema } from "@forge/studio-contracts"
import { ElevenStudioProvider, StudioProviderError } from "./provider"
import { studioProductionClient } from "./transport"
import { measureStudioAudio } from "./audio"
import { readStudioRates } from "./rates"
export const experimentDraftSchema = studioExperimentDraftSchema
const musicSettings = z
  .object({
    lengthMs: z.number().int().min(3000).max(600000),
    instrumental: z.boolean(),
  })
  .strict()
const voiceSettings = z
  .object({
    text: z.string().min(100).max(1000),
    loudness: z.number().min(-1).max(1),
    guidanceScale: z.number().min(0).max(100),
    languageCode: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/),
    narrationModel: z.literal("eleven_multilingual_v2"),
  })
  .strict()
export function experimentQuote(raw: unknown) {
  const draft = experimentDraftSchema.parse(raw),
    card = readStudioRates(env.STUDIO_PRODUCTION_RATE_CARD)
  if (draft.provider !== "elevenlabs" || !card)
    throw new StudioProductionError(
      "Verified account rates are required before a creative experiment",
    )
  let amountMicros: number
  if (draft.kind === "music") {
    z.enum(["music_v1", "music_v2"]).parse(draft.model)
    z.string().min(1).max(4100).parse(draft.prompt)
    const settings = musicSettings.parse(draft.settings),
      rate = card.music.find(
        (r) => r.model === draft.model && settings.lengthMs <= r.maxDurationMs,
      )
    if (!rate)
      throw new StudioProductionError(
        "No verified music duration/generation rate",
      )
    amountMicros = Math.ceil(rate.microsPerGeneration * draft.candidateCount)
  } else {
    z.enum(["eleven_multilingual_ttv_v2", "eleven_ttv_v3"]).parse(draft.model)
    z.string().min(20).max(1000).parse(draft.prompt)
    const settings = voiceSettings.parse(draft.settings),
      rate = card.voice.find((r) => r.model === draft.model)
    if (!rate || draft.candidateCount !== 3)
      throw new StudioProductionError(
        "Voice design requires a verified three-preview estimate",
      )
    amountMicros = Math.ceil(
      settings.text.length * rate.microsPerPreviewCharacter +
        rate.registrationMicros,
    )
  }
  return {
    draft,
    estimate: {
      currency: "USD" as const,
      amountMicros,
      basis: card.basis,
      expiresAt: card.verifiedUntil,
    },
  }
}
export async function executeStudioExperiment(
  userId: string,
  _call: StudioInteractiveClient,
  runId: string,
) {
  const production = studioProductionClient(userId, runId)
  const context = z
    .object({
      run: z.object({ state: z.string() }),
      experiment: z.object({
        id: z.string(),
        request: studioExperimentRequestSchema,
      }),
    })
    .parse(await production.call("context", {}))
  if (context.run.state !== "READY") return context
  const spec = context.experiment.request
  let card: NonNullable<ReturnType<typeof readStudioRates>>,
    provider: ElevenStudioProvider
  try {
    const quote = experimentQuote(experimentDraftSchema.strip().parse(spec))
    card = readStudioRates(env.STUDIO_PRODUCTION_RATE_CARD)!
    if (
      quote.estimate.amountMicros > spec.maxCostMicros ||
      quote.estimate.basis !== spec.estimate.basis
    )
      throw new StudioProductionError(
        "Estimate changed; review before new dispatch",
      )
    provider = new ElevenStudioProvider({ key: env.ELEVENLABS_API_KEY ?? "" })
  } catch (error) {
    await production.call("preflight-error", {
      diagnostic:
        error instanceof Error
          ? error.message.slice(0, 2000)
          : "Experiment preflight failed before provider dispatch",
    })
    throw error
  }
  const count = spec.kind === "music" ? spec.candidateCount : 1
  for (let index = 0; index < count; index++) {
    const key = spec.kind === "music" ? `music-${index}` : "voice-design",
      digest = createHash("sha256")
        .update(JSON.stringify({ request: spec, index }))
        .digest("hex")
    const reserve =
      spec.kind === "music"
        ? card.music.find(
            (r) =>
              r.model === spec.model &&
              Number(spec.settings.lengthMs) <= r.maxDurationMs,
          )!.microsPerGeneration
        : Number(spec.settings.text?.toString().length) *
          card.voice.find((r) => r.model === spec.model)!
            .microsPerPreviewCharacter
    const claim = z
      .object({ execute: z.boolean(), call: z.object({ state: z.string() }) })
      .parse(
        await production.call("claim", {
          key,
          inputDigest: digest,
          reserveMicros: Math.ceil(reserve),
        }),
      )
    if (!claim.execute) {
      if (claim.call.state !== "COMPLETED")
        throw new StudioProductionError(
          "Consumed experiment response is ambiguous or failed; no automatic replay",
        )
      continue
    }
    const started = Date.now(),
      assets: z.infer<typeof studioAssetReferenceSchema>[] = []
    let requestId: string | null = null,
      previewText: string | null = null
    try {
      let candidates: Array<{
        bytes: Buffer
        voiceId?: string
        language?: string
      }>
      if (spec.kind === "music") {
        const settings = musicSettings.parse(spec.settings),
          result = await provider.music({
            prompt: spec.prompt,
            model: spec.model,
            lengthMs: settings.lengthMs,
            instrumental: settings.instrumental,
          })
        requestId = result.requestId
        candidates = [{ bytes: result.bytes }]
      } else {
        const settings = voiceSettings.parse(spec.settings),
          result = await provider.designVoice({
            prompt: spec.prompt,
            model: spec.model,
            text: settings.text,
            loudness: settings.loudness,
            guidanceScale: settings.guidanceScale,
          })
        requestId = result.requestId
        previewText = result.text
        candidates = result.candidates
      }
      for (const [candidateIndex, candidate] of candidates.entries()) {
        let durationMs: number | null = null,
          mediaError: string | null = null
        try {
          durationMs = await measureStudioAudio(candidate.bytes)
        } catch {
          mediaError =
            "Retained audio did not pass bounded decode/duration validation"
        }
        const candidateKey = `${runId}:${key}:${candidateIndex}`
        const preset =
          spec.kind === "voice"
            ? {
                language: spec.language,
                provider: spec.provider,
                model: String(spec.settings.narrationModel),
                voiceId: candidate.voiceId!,
                settings: {
                  language_code: String(spec.settings.languageCode),
                  stability: 0.5,
                  similarity_boost: 0.75,
                  style: 0,
                  use_speaker_boost: true,
                  speed: 1,
                },
                pronunciation: null,
              }
            : undefined
        const asset = await production.upload(
          {
            idempotencyKey: candidateKey,
            filename: `${spec.kind}-candidate-${index}-${candidateIndex}.mp3`,
            mimeType: "audio/mpeg",
            role: spec.kind,
            ...(preset ? { voice: preset } : {}),
            provenance: {
              status: "recorded",
              recorded: {
                runId,
                experimentId: context.experiment.id,
                candidateKey,
                provider: spec.provider,
                model: spec.model,
                language: spec.language,
                prompt: spec.prompt,
                settings: spec.settings,
                providerRequestId: requestId,
                durationMs,
                mediaValidated: mediaError === null,
                mediaError,
                actualCostMicros: null,
                ...(preset
                  ? {
                      registrationStatus: "preview",
                      generatedVoiceId: candidate.voiceId!,
                      providerObservedPreviewText: previewText,
                      previewTextMatch: previewText === spec.settings.text,
                      providerObservedLanguage: candidate.language ?? null,
                      languageMatch:
                        candidate.language === spec.settings.languageCode,
                    }
                  : {}),
              },
            },
          },
          candidate.bytes,
        )
        assets.push(asset.reference)
        await production.call("experiment-candidate", {
          candidateKey,
          asset: asset.reference,
          providerRequestId: requestId,
          actualCostMicros: null,
        })
      }
    } catch (error) {
      await production.call("finish", {
        key,
        state:
          error instanceof StudioProviderError && !error.ambiguous
            ? "FAILED"
            : "AMBIGUOUS",
        result: {
          assets,
          requestId,
          actualCostMicros: null,
          credits: null,
          elapsedMs: Date.now() - started,
          diagnostic:
            "Experiment interrupted; retained candidates remain available. Inspect consumed calls before a new request.",
        },
      })
      throw error
    }
    await production.call("finish", {
      key,
      state: "COMPLETED",
      result: {
        assets,
        requestId,
        actualCostMicros: null,
        credits: null,
        elapsedMs: Date.now() - started,
      },
    })
  }
  return { experimentId: context.experiment.id }
}
