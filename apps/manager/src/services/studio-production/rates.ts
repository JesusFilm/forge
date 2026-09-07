import { StudioProductionError } from "@/services/studio-production/errors"
import { z } from "zod"
import type { StudioNarrationIdentity } from "@forge/studio-contracts/assets"
const amount = z.number().finite().nonnegative().max(100000000)
export const studioRateCardSchema = z
  .object({
    basis: z.string().min(1).max(1000),
    verifiedUntil: z.string().datetime(),
    narration: z
      .array(
        z
          .object({
            model: z.string(),
            voiceId: z.string(),
            microsPerCharacter: amount,
          })
          .strict(),
      )
      .max(100),
    music: z
      .array(
        z
          .object({
            model: z.string(),
            maxDurationMs: z.number().int().positive(),
            microsPerGeneration: amount,
          })
          .strict(),
      )
      .max(10),
    voice: z
      .array(
        z
          .object({
            model: z.string(),
            microsPerPreviewCharacter: amount,
            registrationMicros: amount,
          })
          .strict(),
      )
      .max(10),
  })
  .strict()
export type StudioRateCard = z.infer<typeof studioRateCardSchema>
export function readStudioRates(raw: string | undefined) {
  if (!raw) return null
  const card = studioRateCardSchema.parse(JSON.parse(raw))
  return Date.parse(card.verifiedUntil) > Date.now() ? card : null
}
export function narrationReserve(
  card: StudioRateCard | null,
  identity: StudioNarrationIdentity,
) {
  const rate = card?.narration.find(
    (r) => r.model === identity.model && r.voiceId === identity.voiceId,
  )
  if (!rate || identity.provider !== "elevenlabs")
    throw new StudioProductionError(
      "Verify account-specific model and voice rate before requesting paid narration",
    )
  return Math.ceil(identity.text.length * rate.microsPerCharacter)
}
