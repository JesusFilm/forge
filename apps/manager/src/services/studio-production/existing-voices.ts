import { createHash } from "node:crypto"
import { z } from "zod"
import { readStudioBytes } from "@forge/studio-server"
import { studioIdSchema } from "@forge/studio-contracts"
import { studioVoicePresetSchema } from "@forge/studio-contracts/assets"
import type { StudioInteractiveClient } from "@/backend/studio-interactive"
import { StudioProductionError } from "./errors"

export const existingVoiceInput = z
  .object({
    voiceId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    language: studioIdSchema,
    languageCode: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/),
  })
  .strict()
const providerVoice = z.object({
  voice_id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
})
async function providerRead(path: string, key: string, fetcher: typeof fetch) {
  if (!key) throw new StudioProductionError("ElevenLabs is not configured")
  const response = await fetcher(`https://api.elevenlabs.io${path}`, {
    headers: { "xi-api-key": key },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new StudioProductionError(`Voice lookup returned ${response.status}`)
  }
  return JSON.parse(await readStudioBytes(response))
}
export async function searchExistingVoices(
  query: string,
  key: string,
  fetcher: typeof fetch = fetch,
) {
  const search = z.string().max(200).parse(query)
  const params = new URLSearchParams({ page_size: "20", search })
  const result = z
    .object({ voices: z.array(providerVoice).max(20) })
    .parse(await providerRead(`/v2/voices?${params}`, key, fetcher))
  return result.voices.map((v) => ({ id: v.voice_id, name: v.name }))
}
export async function importExistingVoice(
  raw: unknown,
  call: StudioInteractiveClient,
  key: string,
  adminUrl: string,
  fetcher: typeof fetch = fetch,
) {
  const input = existingVoiceInput.parse(raw)
  const found = providerVoice.parse(
    await providerRead(
      `/v1/voices/${encodeURIComponent(input.voiceId)}`,
      key,
      fetcher,
    ),
  )
  if (found.voice_id !== input.voiceId)
    throw new StudioProductionError("Voice identity mismatch")
  const voice = studioVoicePresetSchema.parse({
    language: input.language,
    provider: "elevenlabs",
    voiceId: input.voiceId,
    model: "eleven_multilingual_v2",
    settings: {
      language_code: input.languageCode,
      stability: 0.5,
      similarity_boost: 0.75,
    },
    pronunciation: null,
  })
  const bytes = Buffer.from(JSON.stringify({ name: found.name, voice }))
  const digest = createHash("sha256").update(bytes).digest("hex")
  const grant = z.object({ path: z.string() }).parse(
    await call("asset-upload", {
      metadata: {
        idempotencyKey: `existing-voice-${digest}`,
        filename: `${found.name.slice(0, 160)}.json`,
        mimeType: "application/json",
        role: "voice",
        voice,
        provenance: {
          status: "recorded",
          recorded: {
            provider: "elevenlabs",
            providerVoiceId: input.voiceId,
            name: found.name,
            registrationStatus: "existing",
          },
        },
      },
      digest,
      byteSize: bytes.length,
    }),
  )
  if (!/^\/api\/shorts\/assets\/transfer\/[a-f0-9]{64}$/.test(grant.path))
    throw new StudioProductionError("Invalid voice transfer capability")
  const response = await fetcher(new URL(grant.path, adminUrl), {
    method: "PUT",
    body: new Uint8Array(bytes),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new StudioProductionError("Could not retain this voice preset")
  }
  return JSON.parse(await readStudioBytes(response))
}
