import type { StudioInteractiveClient } from "@/backend/studio-interactive"
import { expect, it, vi } from "vitest"
import { importExistingVoice, searchExistingVoices } from "./existing-voices"

it("searches existing voices without generating audio or returning provider metadata", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      voices: [{ voice_id: "bella", name: "Bella", samples: ["private"] }],
    }),
  )
  expect(await searchExistingVoices("Bella", "key", fetcher)).toEqual([
    { id: "bella", name: "Bella" },
  ])
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0]?.[0]).toContain("/v2/voices?")
})
it("retains a verified existing preset with explicit provider language and deterministic retry identity", async () => {
  const call = vi.fn<StudioInteractiveClient>(async () => ({
    path: "/api/shorts/assets/transfer/" + "a".repeat(64),
  }))
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ voice_id: "bella", name: "Bella" }))
    .mockResolvedValueOnce(Response.json({ retained: true }))
  const input = { voiceId: "bella", language: "english", languageCode: "en" }
  await importExistingVoice(
    input,
    call,
    "key",
    "https://admin.example/api/graphql",
    fetcher,
  )
  const upload = call.mock.calls[0]?.[1] as {
    metadata: {
      voice: unknown
      provenance: { recorded: { registrationStatus: string } }
      idempotencyKey: string
    }
  }
  expect(upload.metadata.voice).toEqual({
    language: "english",
    provider: "elevenlabs",
    voiceId: "bella",
    model: "eleven_multilingual_v2",
    settings: { language_code: "en", stability: 0.5, similarity_boost: 0.75 },
    pronunciation: null,
  })
  expect(upload.metadata.provenance.recorded.registrationStatus).toBe(
    "existing",
  )
  expect(fetcher.mock.calls.map((c) => c[1]?.method ?? "GET")).toEqual([
    "GET",
    "PUT",
  ])
  expect(upload.metadata.idempotencyKey).toMatch(
    /^existing-voice-[a-f0-9]{64}$/,
  )
})
it("does not retain a voice if the provider rejects it or returns a different identity", async () => {
  const call = vi.fn()
  for (const response of [
    new Response(null, { status: 404 }),
    Response.json({ voice_id: "other", name: "Other" }),
  ]) {
    await expect(
      importExistingVoice(
        { voiceId: "bella", language: "english", languageCode: "en" },
        call,
        "key",
        "https://admin.example",
        vi.fn(async () => response),
      ),
    ).rejects.toThrow()
  }
  expect(call).not.toHaveBeenCalled()
})
it("rejects invalid language codes before any provider call", async () => {
  const fetcher = vi.fn()
  await expect(
    importExistingVoice(
      { voiceId: "bella", language: "english", languageCode: "english" },
      vi.fn(),
      "key",
      "https://admin.example",
      fetcher,
    ),
  ).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
it("rejects untrusted transfer paths before uploading", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ voice_id: "bella", name: "Bella" }),
  )
  await expect(
    importExistingVoice(
      { voiceId: "bella", language: "english", languageCode: "en" },
      vi.fn(async () => ({ path: "https://evil.example/upload" })),
      "key",
      "https://admin.example",
      fetcher,
    ),
  ).rejects.toThrow("Invalid")
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it("bounds provider responses", async () => {
  await expect(
    searchExistingVoices(
      "",
      "key",
      vi.fn(async () => new Response("x".repeat(524289))),
    ),
  ).rejects.toThrow()
})
