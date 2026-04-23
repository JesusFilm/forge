import assert from "node:assert/strict"
import test from "node:test"

import {
  generateVoiceover,
  VoiceoverConfigError,
  VoiceoverProviderError,
  VoiceoverRuntimeError,
} from "./voiceover"

test("generateVoiceover writes a single mp3 artifact for short text", async () => {
  const audio = Uint8Array.from([
    0x49, 0x44, 0x33, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3,
  ])
  const writeCalls: Array<Record<string, unknown>> = []
  const requests: Array<{ url: URL; body: Record<string, unknown> }> = []

  const result = await generateVoiceover(
    {
      assetId: "asset123",
      language: "es",
      text: "Hola mundo. Esta es una prueba.",
    },
    {
      apiKey: "test-key",
      fetchImpl: async (input, init) => {
        requests.push({
          url: new URL(input instanceof URL ? input.toString() : String(input)),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        })

        return new Response(audio, {
          headers: { "content-type": "audio/mpeg" },
        })
      },
      voiceId: "JBFqnCBsd6RMkjVDRZzb",
      writeArtifactImpl: async (options) => {
        writeCalls.push(options as unknown as Record<string, unknown>)
        return `${options.assetId}/${options.artifactType}.${options.ext}`
      },
    },
  )

  assert.equal(result.artifactKey, "asset123/voiceover-es.mp3")
  assert.deepEqual(result.metadata, {
    provider: "elevenlabs",
    modelId: "eleven_multilingual_v2",
    voiceId: "JBFqnCBsd6RMkjVDRZzb",
    outputFormat: "mp3_44100_128",
    chunkCount: 1,
    totalCharacters: "Hola mundo. Esta es una prueba.".length,
  })

  assert.equal(requests.length, 1)
  assert.equal(
    requests[0]?.url.pathname,
    "/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb",
  )
  assert.equal(
    requests[0]?.url.searchParams.get("output_format"),
    "mp3_44100_128",
  )
  assert.deepEqual(requests[0]?.body, {
    text: "Hola mundo. Esta es una prueba.",
    model_id: "eleven_multilingual_v2",
    language_code: "es",
  })

  assert.equal(writeCalls.length, 1)
  assert.equal(writeCalls[0]?.artifactType, "voiceover-es")
  assert.equal(writeCalls[0]?.ext, "mp3")
  assert.equal(writeCalls[0]?.contentType, "audio/mpeg")
  assert.deepEqual(writeCalls[0]?.body, audio)
})

test("generateVoiceover chunks long text and passes continuity hints", async () => {
  const requests: Array<Record<string, unknown>> = []
  const audioResponses = [
    Uint8Array.from([0x49, 0x44, 0x33, 0, 0, 0, 0, 0, 0, 0, 11, 12]),
    Uint8Array.from([0x49, 0x44, 0x33, 0, 0, 0, 0, 0, 0, 0, 21, 22]),
    Uint8Array.from([0x49, 0x44, 0x33, 0, 0, 0, 0, 0, 0, 0, 31, 32]),
  ]
  let responseIndex = 0
  let writtenBody: Uint8Array | undefined

  await generateVoiceover(
    {
      assetId: "asset456",
      language: "en",
      text: "First sentence. Second sentence. Third sentence.",
    },
    {
      apiKey: "test-key",
      maxChunkChars: 20,
      voiceId: "JBFqnCBsd6RMkjVDRZzb",
      fetchImpl: async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)

        const audio = audioResponses[responseIndex]
        responseIndex += 1
        return new Response(audio, {
          headers: { "content-type": "audio/mpeg" },
        })
      },
      writeArtifactImpl: async (options) => {
        writtenBody = options.body as Uint8Array
        return `${options.assetId}/${options.artifactType}.${options.ext}`
      },
    },
  )

  assert.equal(requests.length, 3)
  assert.deepEqual(requests[0], {
    text: "First sentence.",
    model_id: "eleven_multilingual_v2",
    language_code: "en",
    next_text: "Second sentence.",
  })
  assert.deepEqual(requests[1], {
    text: "Second sentence.",
    model_id: "eleven_multilingual_v2",
    language_code: "en",
    previous_text: "First sentence.",
    next_text: "Third sentence.",
  })
  assert.deepEqual(requests[2], {
    text: "Third sentence.",
    model_id: "eleven_multilingual_v2",
    language_code: "en",
    previous_text: "Second sentence.",
  })

  assert.deepEqual(
    writtenBody,
    Uint8Array.from([
      0x49, 0x44, 0x33, 0, 0, 0, 0, 0, 0, 0, 11, 12, 21, 22, 31, 32,
    ]),
  )
})

test("generateVoiceover fails with a targeted config error when api key is missing", async () => {
  const originalApiKey = process.env.ELEVENLABS_API_KEY
  process.env.MUX_TOKEN_ID ??= "test-mux-token-id"
  process.env.MUX_TOKEN_SECRET ??= "test-mux-token-secret"
  process.env.OPENROUTER_API_KEY ??= "test-openrouter-api-key"
  process.env.STRAPI_URL ??= "https://cms.example.test"
  process.env.STRAPI_API_TOKEN ??= "test-strapi-api-token"
  delete process.env.ELEVENLABS_API_KEY

  try {
    await assert.rejects(
      () =>
        generateVoiceover({
          assetId: "asset789",
          language: "en",
          text: "Hello world.",
        }),
      (error: unknown) => {
        assert.ok(error instanceof VoiceoverConfigError)
        const typedError = error as VoiceoverConfigError
        assert.equal(
          typedError.message,
          "ELEVENLABS_API_KEY is required to generate voiceover audio.",
        )
        return true
      },
    )
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.ELEVENLABS_API_KEY
    } else {
      process.env.ELEVENLABS_API_KEY = originalApiKey
    }
  }
})

test("generateVoiceover fails with a targeted runtime error for empty text", async () => {
  await assert.rejects(
    () =>
      generateVoiceover(
        {
          assetId: "asset999",
          language: "en",
          text: "   \n\t  ",
        },
        {
          apiKey: "test-key",
          voiceId: "JBFqnCBsd6RMkjVDRZzb",
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof VoiceoverRuntimeError)
      const typedError = error as VoiceoverRuntimeError
      assert.equal(
        typedError.message,
        "Voiceover generation requires non-empty text.",
      )
      return true
    },
  )
})

test("generateVoiceover falls back to English for a blank language code", async () => {
  const requests: Array<Record<string, unknown>> = []

  await generateVoiceover(
    {
      assetId: "asset-language",
      language: "  ",
      text: "Hello world.",
    },
    {
      apiKey: "test-key",
      voiceId: "JBFqnCBsd6RMkjVDRZzb",
      fetchImpl: async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)

        return new Response(Uint8Array.from([1, 2, 3]), {
          headers: { "content-type": "audio/mpeg" },
        })
      },
      writeArtifactImpl: async (options) =>
        `${options.assetId}/${options.artifactType}.${options.ext}`,
    },
  )

  assert.equal(requests[0]?.language_code, "en")
})

test("generateVoiceover surfaces provider failures with a stable ElevenLabs error", async () => {
  await assert.rejects(
    () =>
      generateVoiceover(
        {
          assetId: "asset000",
          language: "en",
          text: "Hello world.",
        },
        {
          apiKey: "test-key",
          voiceId: "JBFqnCBsd6RMkjVDRZzb",
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                detail: {
                  message: "Unsupported language code.",
                },
              }),
              {
                status: 422,
                statusText: "Unprocessable Entity",
                headers: { "content-type": "application/json" },
              },
            ),
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof VoiceoverProviderError)
      const typedError = error as VoiceoverProviderError
      assert.equal(
        typedError.message,
        "ElevenLabs request failed (422 Unprocessable Entity): Unsupported language code.",
      )
      assert.equal(typedError.status, 422)
      return true
    },
  )
})
