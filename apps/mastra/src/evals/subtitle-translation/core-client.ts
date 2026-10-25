import { z } from "zod"

const DEFAULT_CORE_API_URL = "https://api-gateway.central.jesusfilm.org/"
const CORE_API_HOST = "api-gateway.central.jesusfilm.org"
const CORE_MEDIA_HOST = "api-media-core.jesusfilm.org"
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_GRAPHQL_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_VTT_BYTES = 2 * 1024 * 1024

const VIDEO_SUBTITLES_QUERY = `
  query SubtitleEvalTracks($videoId: ID!) {
    videoSubtitles(offset: 0, limit: 500, where: { videoId: $videoId }) {
      id
      videoId
      languageId
      primary
      edition
      vttSrc
      updatedAt
      videoEdition { id }
    }
  }
`

const CoreSubtitleRowSchema = z
  .object({
    id: z.string().min(1),
    videoId: z.string().min(1),
    languageId: z.string().min(1),
    primary: z.boolean(),
    edition: z.string(),
    vttSrc: z.string().url().nullable(),
    updatedAt: z.string().optional(),
    videoEdition: z.object({ id: z.string().min(1) }).strict(),
  })
  .strict()

const GraphQlResponseSchema = z
  .object({
    data: z
      .object({ videoSubtitles: z.array(CoreSubtitleRowSchema) })
      .strict()
      .nullable(),
    errors: z.array(z.object({ message: z.string() }).passthrough()).optional(),
  })
  .strict()

export type CoreSubtitleRow = z.infer<typeof CoreSubtitleRowSchema>

export async function fetchCoreSubtitleRows(input: {
  videoId: string
  coreApiUrl?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<CoreSubtitleRow[]> {
  const url = assertAllowedHttpsUrl(
    input.coreApiUrl ?? DEFAULT_CORE_API_URL,
    CORE_API_HOST,
  )
  const response = await (input.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-graphql-client-name": "forge-subtitle-translation-eval",
    },
    body: JSON.stringify({
      query: VIDEO_SUBTITLES_QUERY,
      variables: { videoId: input.videoId },
    }),
    redirect: "error",
    signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Core subtitle query failed (${response.status})`)
  }

  const body = await readBoundedText(response, MAX_GRAPHQL_RESPONSE_BYTES)
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(body)
  } catch (error) {
    throw new Error("Core subtitle query returned invalid JSON", {
      cause: error,
    })
  }
  const parsed = GraphQlResponseSchema.parse(parsedJson)
  if (parsed.errors?.length) {
    throw new Error(
      `Core subtitle query returned GraphQL errors: ${parsed.errors
        .map((error) => error.message)
        .join("; ")}`,
    )
  }
  if (!parsed.data) throw new Error("Core subtitle query returned no data")
  return parsed.data.videoSubtitles
}

export async function downloadCoreVtt(input: {
  sourceUrl: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<string> {
  const url = assertAllowedHttpsUrl(input.sourceUrl, CORE_MEDIA_HOST)
  const response = await (input.fetchImpl ?? fetch)(url, {
    method: "GET",
    headers: {
      accept: "text/vtt,text/plain;q=0.9",
      "user-agent": "forge-subtitle-translation-eval/1.0",
    },
    redirect: "error",
    signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Core VTT download failed (${response.status})`)
  }
  return readBoundedText(response, MAX_VTT_BYTES)
}

function assertAllowedHttpsUrl(value: string, expectedHost: string): URL {
  const url = new URL(value)
  if (url.protocol !== "https:" || url.hostname !== expectedHost) {
    throw new Error(`Subtitle eval URL must use https://${expectedHost}`)
  }
  if (url.username || url.password) {
    throw new Error("Subtitle eval URL must not contain credentials")
  }
  return url
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new Error(`Subtitle eval response exceeds ${maximumBytes} bytes`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maximumBytes) {
    throw new Error(`Subtitle eval response exceeds ${maximumBytes} bytes`)
  }
  return new TextDecoder().decode(bytes)
}

export const _internals = {
  DEFAULT_CORE_API_URL,
  CORE_API_HOST,
  CORE_MEDIA_HOST,
  VIDEO_SUBTITLES_QUERY,
  assertAllowedHttpsUrl,
}
