import { generateKeyPairSync } from "node:crypto"
import { exportSPKI, importSPKI, jwtVerify } from "jose"
import { describe, expect, it, vi } from "vitest"

import { readMuxSubtitleSource } from "./source-mux"

const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello world\n"
const audio = { id: "audio-1", type: "audio", primary: true }
const ready = {
  id: "text-1",
  type: "text",
  text_type: "subtitles",
  text_source: "generated_vod",
  language_code: "en",
  status: "ready",
}
const asset = (
  tracks: Record<string, unknown>[] = [audio, ready],
  policy = "public",
) =>
  Response.json({
    data: {
      status: "ready",
      tracks,
      playback_ids: [{ id: "playback-1", policy }],
    },
  })
const credentials = { tokenId: "id", tokenSecret: "secret" }

describe("Mux subtitle source acquisition", () => {
  it("reads a ready matching source without generation and confines credentials to Mux API", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(asset())
      .mockResolvedValueOnce(new Response(vtt))
    expect(
      await readMuxSubtitleSource(
        { muxAssetId: "mux-1", sourceLanguage: "en" },
        { ...credentials, fetchImpl },
      ),
    ).toEqual({
      language: "en",
      segments: [{ start: 0, end: 2, text: "Hello world" }],
    })
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://api.mux.com/video/v1/assets/mux-1",
      expect.objectContaining({
        redirect: "error",
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Basic aWQ6c2VjcmV0",
        }),
      }),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      new URL("https://stream.mux.com/playback-1/text/text-1.vtt"),
      expect.objectContaining({ redirect: "error" }),
    )
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toBeUndefined()
  })

  it("requests generation on the primary audio once and polls until actual timed subtitles exist", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(asset([audio]))
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(asset([audio, { ...ready, status: "preparing" }]))
      .mockResolvedValueOnce(asset())
      .mockResolvedValueOnce(new Response(vtt))
    await readMuxSubtitleSource(
      { muxAssetId: "mux-1", sourceLanguage: "en" },
      { ...credentials, fetchImpl, sleep: async () => {} },
    )
    const posts = fetchImpl.mock.calls.filter(
      ([, init]) => init?.method === "POST",
    )
    expect(posts).toHaveLength(1)
    expect(posts[0]?.[0]).toBe(
      "https://api.mux.com/video/v1/assets/mux-1/tracks/audio-1/generate-subtitles",
    )
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toEqual({
      generated_subtitles: [
        { language_code: "en", name: "Generated subtitles" },
      ],
    })
  })

  it("waits for an existing generation without issuing another paid mutation", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(asset([audio, { ...ready, status: "preparing" }]))
      .mockResolvedValueOnce(asset())
      .mockResolvedValueOnce(new Response(vtt))
    await readMuxSubtitleSource(
      { muxAssetId: "mux-1", sourceLanguage: "en" },
      { ...credentials, fetchImpl, sleep: async () => {} },
    )
    expect(
      fetchImpl.mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(false)
  })

  it.each([
    { language: "en-US", failedGeneration: false },
    { language: "ar-SA", failedGeneration: false },
    { language: "en-US", failedGeneration: true },
  ])(
    "waits for uploaded preparing subtitles before generation: %j",
    async ({ language, failedGeneration }) => {
      let reads = 0
      const uploaded = {
        ...ready,
        id: "uploaded-1",
        text_source: "uploaded",
        language_code: language.split("-")[0]!,
      }
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockImplementation(async (url, init) => {
          if (init?.method === "POST") return Response.json({ data: [] })
          if (new URL(String(url)).hostname === "stream.mux.com")
            return new Response(vtt)
          reads++
          return asset([
            audio,
            { ...ready, language_code: "fr" },
            { ...uploaded, id: "captions-1", text_type: "captions" },
            ...(failedGeneration ? [{ ...ready, status: "errored" }] : []),
            { ...uploaded, status: reads === 1 ? "preparing" : "ready" },
          ])
        })
      const sleep = vi.fn(async () => {})
      await expect(
        readMuxSubtitleSource(
          { muxAssetId: "mux-1", sourceLanguage: language },
          { ...credentials, fetchImpl, sleep },
        ),
      ).resolves.toEqual({
        language,
        segments: [{ start: 0, end: 2, text: "Hello world" }],
      })
      expect(reads).toBe(2)
      expect(sleep).toHaveBeenCalledTimes(1)
      expect(
        fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST"),
      ).toHaveLength(0)
      expect(fetchImpl).toHaveBeenLastCalledWith(
        new URL("https://stream.mux.com/playback-1/text/uploaded-1.vtt"),
        expect.objectContaining({ redirect: "error" }),
      )
      expect(fetchImpl.mock.calls.at(-1)?.[1]?.headers).toBeUndefined()
    },
  )

  it.each(["deleted", "errored", undefined])(
    "does not treat an uploaded track with status %s as preparing or ready",
    async (status) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          asset([
            audio,
            { ...ready, text_source: "uploaded", language_code: "ar", status },
          ]),
        )
      const sleep = vi.fn()
      await expect(
        readMuxSubtitleSource(
          { muxAssetId: "mux-1", sourceLanguage: "ar" },
          { ...credentials, fetchImpl, sleep },
        ),
      ).rejects.toMatchObject({ reason: "source_invalid", retryable: false })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(sleep).not.toHaveBeenCalled()
    },
  )

  it.each(["ready", "preparing"])(
    "rejects unsupported generation rather than selecting another language's %s track",
    async (status) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(asset([audio, { ...ready, status }]))
      await expect(
        readMuxSubtitleSource(
          { muxAssetId: "mux-1", sourceLanguage: "ar" },
          { ...credentials, fetchImpl },
        ),
      ).rejects.toMatchObject({ reason: "source_invalid", retryable: false })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    },
  )

  it("stops on errored source tracks without restarting generation", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(asset([audio, { ...ready, status: "errored" }]))
    await expect(
      readMuxSubtitleSource(
        { muxAssetId: "mux-1", sourceLanguage: "en" },
        { ...credentials, fetchImpl },
      ),
    ).rejects.toMatchObject({ reason: "source_failed", retryable: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each(["generated_vod", "uploaded"])(
    "bounds waiting and leaves a preparing %s track reusable on retry",
    async (text_source) => {
      let time = 0
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockImplementation(async () =>
          asset([audio, { ...ready, text_source, status: "preparing" }]),
        )
      await expect(
        readMuxSubtitleSource(
          { muxAssetId: "mux-1", sourceLanguage: "en" },
          {
            ...credentials,
            fetchImpl,
            timeoutMs: 10,
            pollIntervalMs: 5,
            now: () => time,
            sleep: async (ms) => {
              time += ms
            },
          },
        ),
      ).rejects.toMatchObject({
        reason: "source_failed",
        retryable: true,
        message: "Mux subtitle source timed out.",
      })
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      expect(
        fetchImpl.mock.calls.some(([, init]) => init?.method === "POST"),
      ).toBe(false)
    },
  )

  it.each(["pkcs1", "pkcs8"] as const)(
    "signs supported private playback with a bounded video token (%s)",
    async (type) => {
      const { privateKey, publicKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
      })
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(asset(undefined, "signed"))
        .mockResolvedValueOnce(new Response(vtt))
      await readMuxSubtitleSource(
        { muxAssetId: "mux-1", sourceLanguage: "en" },
        {
          ...credentials,
          fetchImpl,
          signingKeyId: "signing-1",
          privateKey: Buffer.from(
            privateKey.export({ type, format: "pem" }),
          ).toString("base64"),
        },
      )
      const url = new URL(String(fetchImpl.mock.calls[1]?.[0]))
      const key = await importSPKI(await exportSPKI(publicKey), "RS256")
      const verified = await jwtVerify(url.searchParams.get("token")!, key, {
        audience: "v",
        subject: "playback-1",
      })
      expect(verified.protectedHeader.kid).toBe("signing-1")
      expect(verified.payload.exp).toBeLessThanOrEqual(
        Math.floor(Date.now() / 1000) + 300,
      )
    },
  )

  it.each([
    "missing signing",
    "drm",
    "invalid vtt",
    "too large",
    "stream too large",
    "auth",
    "redirect",
  ])("fails honestly and sanitizes provider details: %s", async (scenario) => {
    const fetchImpl = vi.fn<typeof fetch>()
    if (scenario === "redirect")
      fetchImpl.mockRejectedValue(
        new Error("secret-token https://internal.example"),
      )
    else if (scenario === "auth")
      fetchImpl.mockResolvedValueOnce(
        new Response("secret-token", { status: 401 }),
      )
    else {
      fetchImpl.mockResolvedValueOnce(
        asset(
          undefined,
          scenario === "drm"
            ? "drm"
            : scenario === "missing signing"
              ? "signed"
              : "public",
        ),
      )
      fetchImpl.mockResolvedValueOnce(
        scenario === "too large"
          ? new Response("ignored", {
              headers: { "content-length": "6000000" },
            })
          : scenario === "stream too large"
            ? new Response("x".repeat(5 * 1024 * 1024 + 1))
            : new Response("WEBVTT\n\n00:00:02.000 --> 00:00:01.000\nHello\n"),
      )
    }
    const error = await readMuxSubtitleSource(
      { muxAssetId: "mux-1", sourceLanguage: "en" },
      { ...credentials, fetchImpl, signingKeyId: "", privateKey: "" },
    ).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).not.toContain("secret-token")
    expect(String(error)).not.toContain("https://internal.example")
  })
})
