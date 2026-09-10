import { createHash } from "node:crypto"
import { StudioProviderError } from "./provider"
import type { StudioAssetReference } from "@forge/studio-contracts"
import type { StudioNarrationIdentity } from "@forge/studio-contracts/assets"
export type NarrationAudio = { asset: StudioAssetReference; durationMs: number }
export type NarrationSegment = {
  itemId: string
  identity: StudioNarrationIdentity
  matches: StudioAssetReference[]
}
export type NarrationProviderOutput = {
  bytes: Buffer
  requestId: string | null
  credits: number | null
  actualCostMicros: number | null
}
export interface NarrationPort {
  cached(
    reference: StudioAssetReference,
    identity: StudioNarrationIdentity,
  ): Promise<NarrationAudio | null>
  claim(
    key: string,
    inputDigest: string,
    reserveMicros: number,
  ): Promise<{ execute: boolean; state: string; audio?: NarrationAudio }>
  narrate(identity: StudioNarrationIdentity): Promise<NarrationProviderOutput>
  retain(
    output: NarrationProviderOutput,
    identity: StudioNarrationIdentity,
    key: string,
  ): Promise<NarrationAudio>
  finish(
    key: string,
    input: {
      state: "COMPLETED" | "FAILED" | "AMBIGUOUS"
      audio?: NarrationAudio
      retainedAssets?: StudioAssetReference[]
      requestId: string | null
      credits: number | null
      actualCostMicros: number | null
      elapsedMs: number
      diagnostic?: string
    },
  ): Promise<void>
  attach(entries: Array<NarrationAudio & { itemId: string }>): Promise<unknown>
}
export class StudioRetainedAudioError extends Error {
  constructor(public readonly asset: StudioAssetReference) {
    super(
      "Provider bytes retained but audio validation failed; inspect before a new request",
    )
  }
}
export class StudioNarrationRunError extends Error {}
/** A consumed claim is observation only: this caller cannot settle the shared run. */
export class StudioNarrationClaimObserved extends StudioNarrationRunError {}
/** Only the caller that dispatched and durably finished a failed paid claim owns failure. */
export class StudioNarrationDispatchFailure extends StudioNarrationRunError {}
export function narrationInputDigest(identity: StudioNarrationIdentity) {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, v]) => [key, canonical(v)]),
          )
        : value
  return createHash("sha256")
    .update(JSON.stringify(canonical(identity)))
    .digest("hex")
}
export async function runStudioNarration(input: {
  segments: NarrationSegment[]
  reserveMicros: (identity: StudioNarrationIdentity) => number
  port: NarrationPort
}) {
  const entries: Array<NarrationAudio & { itemId: string }> = []
  const retained = new Map<string, NarrationAudio>()
  for (const segment of input.segments) {
    const digest = narrationInputDigest(segment.identity)
    let audio: NarrationAudio | null = retained.get(digest) ?? null
    for (const reference of audio ? [] : segment.matches) {
      audio = await input.port.cached(reference, segment.identity)
      if (audio) break
    }
    if (!audio) {
      const key = `speech-${digest}`
      const claim = await input.port.claim(
        key,
        digest,
        input.reserveMicros(segment.identity),
      )
      if (!claim.execute) {
        if (claim.state !== "COMPLETED" || !claim.audio)
          throw new StudioNarrationClaimObserved(
            "Consumed narration claim is ambiguous or failed; inspect before a new paid request",
          )
        audio = claim.audio
      } else {
        const started = Date.now()
        let output: NarrationProviderOutput | undefined
        try {
          output = await input.port.narrate(segment.identity)
          audio = await input.port.retain(output, segment.identity, key)
        } catch (error) {
          await input.port.finish(key, {
            state:
              error instanceof StudioProviderError && !error.ambiguous
                ? "FAILED"
                : "AMBIGUOUS",
            retainedAssets:
              error instanceof StudioRetainedAudioError ? [error.asset] : [],
            requestId: output?.requestId ?? null,
            credits: output?.credits ?? null,
            actualCostMicros: output?.actualCostMicros ?? null,
            elapsedMs: Date.now() - started,
            diagnostic:
              error instanceof StudioRetainedAudioError
                ? error.message
                : output
                  ? "Provider returned bytes but asset retention was not confirmed; inspect before retry"
                  : "Provider failed or response is ambiguous; no automatic replay",
          })
          throw new StudioNarrationDispatchFailure(
            error instanceof Error
              ? error.message
              : "Narration provider failed",
          )
        }
        await input.port.finish(key, {
          state: "COMPLETED",
          audio,
          requestId: output.requestId,
          credits: output.credits,
          actualCostMicros: output.actualCostMicros,
          elapsedMs: Date.now() - started,
        })
      }
    }
    retained.set(digest, audio)
    entries.push({ ...audio, itemId: segment.itemId })
  }
  return input.port.attach(entries)
}
