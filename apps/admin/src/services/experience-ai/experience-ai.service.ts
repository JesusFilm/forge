import { spawn } from "node:child_process"
import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { canEditExperienceLocale, hasPermission } from "@/auth/permissions"
import { ForbiddenError, NotFoundError } from "@/services/errors"
import { env } from "@/config/env"
import { toPgVector } from "@/db/pgvector"
import { generateExperienceEmbedding } from "@/services/embeddings.service"
import { generateOllamaEmbedding } from "@/services/ollama-embedding.service"
import {
  buildDraftExperienceJsonSchema,
  DraftExperienceSchema,
  type VideoCandidate,
} from "./experience-ai.schemas"
import { buildSystemPrompt } from "./experience-ai-prompts"
import {
  ExperienceAiNormalizationError,
  normalizeExperienceDraft,
  type NormalizedExperienceDraft,
} from "./experience-ai-normalize"

const OPENROUTER_CHAT_MODEL = "openai/gpt-4.1-mini"
const OPENAI_CHAT_MODEL = "gpt-4.1-mini"
const CODEX_CHAT_MODEL = "gpt-5.5"
const GENERATION_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_CANDIDATE_LIMIT = 12
const CANDIDATE_FETCH_WINDOW = 80
const VECTOR_SEARCH_EF_SEARCH = 80

type ProviderSelection =
  | {
      kind: "openrouter"
      apiKey: string
      model: string
      url: string
    }
  | {
      kind: "openai"
      apiKey: string
      model: string
      url: string
    }
  | {
      kind: "codex"
      model: string
    }

type ExperienceAiGenerationInput = {
  experienceLocaleId: string
  locale: string
  prompt: string
  user: Principal | null
  candidateLimit?: number
  /// Optional Experience id used for the rule-witness log. The action layer
  /// supplies it when available so logs are greppable per-experience.
  experienceId?: string | null
}

export class ExperienceAiGenerationError extends Error {
  constructor(
    readonly code:
      | "NOT_CONFIGURED"
      | "NO_CANDIDATES"
      | "UPSTREAM_ERROR"
      | "SCHEMA_MISMATCH"
      | "NORMALIZATION_ERROR",
    message: string,
  ) {
    super(message)
    this.name = "ExperienceAiGenerationError"
  }
}

type RankedCandidate = VideoCandidate & {
  score: number
  updatedAt: Date
}

type VideoEmbeddingHit = {
  videoId: string
  distance: number
}

function normalizeText(value: string) {
  return value.trim().toLowerCase()
}

function tokenizePrompt(prompt: string) {
  return Array.from(
    new Set(
      normalizeText(prompt)
        .match(/[a-z0-9]+/g)
        ?.filter((token) => token.length >= 3) ?? [],
    ),
  )
}

function candidateText(candidate: {
  title: string
  description: string | null
  slug: string
  label: string | null
}) {
  return [
    candidate.title,
    candidate.description,
    candidate.slug,
    candidate.label,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function scoreCandidate(
  candidate: {
    title: string
    description: string | null
    slug: string
    label: string | null
    previewImageUrl: string | null
    previewStreamUrl: string | null
    updatedAt: Date
  },
  tokens: readonly string[],
) {
  let score = 0
  if (candidate.previewImageUrl) score += 1
  if (candidate.previewStreamUrl) score += 2
  if (tokens.length === 0) {
    return score
  }

  const title = candidate.title.toLowerCase()
  const description = candidate.description?.toLowerCase() ?? ""
  const slug = candidate.slug.toLowerCase()
  const label = candidate.label?.toLowerCase() ?? ""
  const text = candidateText(candidate)

  for (const token of tokens) {
    if (title.includes(token)) score += 8
    if (description.includes(token)) score += 5
    if (slug.includes(token)) score += 4
    if (label.includes(token)) score += 2
    if (text.includes(token)) score += 1
  }

  return score
}

function pickProvider(): ProviderSelection | null {
  if (env.OPENROUTER_API_KEY) {
    return {
      kind: "openrouter",
      apiKey: env.OPENROUTER_API_KEY,
      model: OPENROUTER_CHAT_MODEL,
      url: "https://openrouter.ai/api/v1/chat/completions",
    }
  }
  if (env.OPENAI_API_KEY) {
    return {
      kind: "openai",
      apiKey: env.OPENAI_API_KEY,
      model: OPENAI_CHAT_MODEL,
      url: new URL(
        "chat/completions",
        `${(env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")}/`,
      ).toString(),
    }
  }
  // Codex CLI fallback is gated to avoid surprising production deployments
  // without an API key. When the gate is off and no API key is set, return
  // null so the caller surfaces NOT_CONFIGURED instead of spawning a CLI.
  if (env.EXPERIENCE_AI_ALLOW_CODEX_FALLBACK !== true) {
    return null
  }
  return {
    kind: "codex",
    model: CODEX_CHAT_MODEL,
  }
}

function stripMarkdownFence(content: string) {
  const trimmed = content.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

function parseProviderDraftContent(content: string): unknown {
  const normalized = stripMarkdownFence(content)
  let parsed: unknown
  try {
    parsed = JSON.parse(normalized)
  } catch {
    throw new ExperienceAiGenerationError(
      "SCHEMA_MISMATCH",
      "AI provider returned invalid JSON content",
    )
  }
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      throw new ExperienceAiGenerationError(
        "SCHEMA_MISMATCH",
        "AI provider returned invalid JSON content",
      )
    }
  }
  return parsed
}

function buildCodexPrompt({
  prompt,
  locale,
  candidates,
}: {
  prompt: string
  locale: string
  candidates: VideoCandidate[]
}) {
  return [
    buildSystemPrompt(locale),
    "",
    "Schema:",
    JSON.stringify(buildDraftExperienceJsonSchema(), null, 2),
    "",
    "Input:",
    JSON.stringify(
      {
        prompt: prompt.trim(),
        locale,
        videoCandidates: candidates.map((candidate) => ({
          ref: candidate.ref,
          title: candidate.title,
          description: candidate.description,
          label: candidate.label,
          previewImageUrl: candidate.previewImageUrl,
          previewStreamUrl: candidate.previewStreamUrl,
        })),
      },
      null,
      2,
    ),
  ].join("\n")
}

async function createStructuredDraftWithCodex({
  prompt,
  locale,
  candidates,
  model,
}: {
  prompt: string
  locale: string
  candidates: VideoCandidate[]
  model: string
}) {
  return await new Promise<unknown>((resolve, reject) => {
    const proc = spawn(
      "codex",
      [
        "exec",
        "-m",
        model,
        "-c",
        'model_reasoning_effort="high"',
        "--sandbox",
        "read-only",
        "-",
      ],
      {
        env: { ...process.env, LANG: "en_US.UTF-8" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    )

    let stdout = ""
    let stderr = ""

    const timeoutHandle = setTimeout(() => {
      proc.kill("SIGTERM")
    }, GENERATION_REQUEST_TIMEOUT_MS)

    proc.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })

    proc.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    proc.on("error", (error) => {
      clearTimeout(timeoutHandle)
      reject(
        new ExperienceAiGenerationError(
          "NOT_CONFIGURED",
          error instanceof Error && "code" in error && error.code === "ENOENT"
            ? "codex CLI is not installed or not available on PATH"
            : error instanceof Error
              ? error.message
              : "codex CLI failed to start",
        ),
      )
    })

    proc.on("close", (code, signal) => {
      clearTimeout(timeoutHandle)

      if (signal) {
        reject(
          new ExperienceAiGenerationError(
            "UPSTREAM_ERROR",
            `Codex request timed out after ${GENERATION_REQUEST_TIMEOUT_MS}ms`,
          ),
        )
        return
      }

      if (code !== 0) {
        reject(
          new ExperienceAiGenerationError(
            "UPSTREAM_ERROR",
            stderr.trim() || `codex exited with status ${code ?? "unknown"}`,
          ),
        )
        return
      }

      try {
        resolve(parseProviderDraftContent(stdout))
      } catch (error) {
        reject(error)
      }
    })

    proc.stdin.write(buildCodexPrompt({ prompt, locale, candidates }))
    proc.stdin.end()
  })
}

function buildExperienceAiMessages({
  prompt,
  locale,
  candidates,
}: {
  prompt: string
  locale: string
  candidates: VideoCandidate[]
}) {
  return [
    {
      role: "system" as const,
      content: buildSystemPrompt(locale),
    },
    {
      role: "user" as const,
      content: JSON.stringify(
        {
          prompt: prompt.trim(),
          locale,
          videoCandidates: candidates.map((candidate) => ({
            ref: candidate.ref,
            title: candidate.title,
            description: candidate.description,
            label: candidate.label,
            previewImageUrl: candidate.previewImageUrl,
            previewStreamUrl: candidate.previewStreamUrl,
          })),
        },
        null,
        2,
      ),
    },
  ]
}

type StructuredDraftResult = {
  payload: unknown
  providerKind: "openrouter" | "openai" | "codex"
}

async function createStructuredDraft({
  prompt,
  locale,
  candidates,
}: {
  prompt: string
  locale: string
  candidates: VideoCandidate[]
}): Promise<StructuredDraftResult> {
  const provider = pickProvider()
  if (!provider) {
    throw new ExperienceAiGenerationError(
      "NOT_CONFIGURED",
      "OPENROUTER_API_KEY or OPENAI_API_KEY is required for AI drafting",
    )
  }

  if (provider.kind === "codex") {
    const payload = await createStructuredDraftWithCodex({
      prompt,
      locale,
      candidates,
      model: provider.model,
    })
    return { payload, providerKind: "codex" }
  }

  const controller = new AbortController()
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    GENERATION_REQUEST_TIMEOUT_MS,
  )

  try {
    const response = await fetch(provider.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${provider.apiKey}`,
        "content-type": "application/json",
        ...(provider.kind === "openrouter"
          ? { "x-title": "forge-admin-experience-ai" }
          : {}),
      },
      body: JSON.stringify({
        model: provider.model,
        messages: buildExperienceAiMessages({ prompt, locale, candidates }),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "experience_ai_draft",
            strict: true,
            schema: buildDraftExperienceJsonSchema(),
          },
        },
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new ExperienceAiGenerationError(
        "UPSTREAM_ERROR",
        `AI provider request failed with status ${response.status}`,
      )
    }

    const body = (await response.json()) as unknown
    const bodyParse = {
      choices:
        body && typeof body === "object" && "choices" in body
          ? (body as { choices?: unknown }).choices
          : undefined,
    }
    const choice = Array.isArray(bodyParse.choices)
      ? bodyParse.choices[0]
      : null
    const message =
      choice && typeof choice === "object" && choice !== null
        ? (choice as { message?: unknown }).message
        : null
    const content =
      message && typeof message === "object" && message !== null
        ? (message as { content?: unknown }).content
        : null

    if (typeof content !== "string" || content.trim().length === 0) {
      throw new ExperienceAiGenerationError(
        "UPSTREAM_ERROR",
        "AI provider returned an empty draft payload",
      )
    }

    return {
      payload: parseProviderDraftContent(content),
      providerKind: provider.kind,
    }
  } catch (error) {
    if (error instanceof ExperienceAiGenerationError) {
      throw error
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new ExperienceAiGenerationError(
        "UPSTREAM_ERROR",
        `AI provider request timed out after ${GENERATION_REQUEST_TIMEOUT_MS}ms`,
      )
    }
    throw new ExperienceAiGenerationError(
      "UPSTREAM_ERROR",
      error instanceof Error ? error.message : "AI provider request failed",
    )
  } finally {
    clearTimeout(timeoutHandle)
  }
}

export async function loadExperienceAiVideoCandidates(
  prisma: PrismaClient,
  {
    locale,
    prompt,
    limit = DEFAULT_CANDIDATE_LIMIT,
  }: { locale: string; prompt: string; limit?: number },
): Promise<VideoCandidate[]> {
  const safeLimit = Math.max(1, Math.min(limit, DEFAULT_CANDIDATE_LIMIT))
  const fetchWindow = Math.min(
    Math.max(safeLimit * 4, 24),
    CANDIDATE_FETCH_WINDOW,
  )
  const tokens = tokenizePrompt(prompt)
  const semanticVideoIds = await loadSemanticVideoCandidateIds(prisma, {
    locale,
    prompt,
    limit: fetchWindow,
  })

  const videos = await prisma.video.findMany({
    where:
      semanticVideoIds.length > 0
        ? { id: { in: semanticVideoIds }, deletedAt: null }
        : { deletedAt: null },
    select: {
      id: true,
      slug: true,
      label: true,
      updatedAt: true,
    },
    ...(semanticVideoIds.length > 0
      ? {}
      : { orderBy: { updatedAt: "desc" as const } }),
    take: fetchWindow,
  })

  if (videos.length === 0) {
    return []
  }

  const videoIds = videos.map((video) => video.id)
  const [videoLocales, videoDubs, videoImages] = await Promise.all([
    prisma.videoLocale.findMany({
      where: { videoId: { in: videoIds } },
      select: {
        videoId: true,
        locale: true,
        title: true,
        description: true,
        status: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.videoDub.findMany({
      where: { videoId: { in: videoIds }, deletedAt: null },
      select: {
        videoId: true,
        hls: true,
        dash: true,
        share: true,
        language: {
          select: {
            bcp47: true,
            iso3: true,
            slug: true,
          },
        },
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.videoImage.findMany({
      where: { videoId: { in: videoIds } },
      select: {
        videoId: true,
        url: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ])

  const localesByVideo = new Map<string, typeof videoLocales>()
  for (const row of videoLocales) {
    const current = localesByVideo.get(row.videoId) ?? []
    current.push(row)
    localesByVideo.set(row.videoId, current)
  }

  const dubsByVideo = new Map<string, typeof videoDubs>()
  for (const row of videoDubs) {
    const current = dubsByVideo.get(row.videoId) ?? []
    current.push(row)
    dubsByVideo.set(row.videoId, current)
  }

  const imagesByVideo = new Map<string, typeof videoImages>()
  for (const row of videoImages) {
    const current = imagesByVideo.get(row.videoId) ?? []
    current.push(row)
    imagesByVideo.set(row.videoId, current)
  }

  const semanticRank = new Map(
    semanticVideoIds.map((videoId, index) => [videoId, index]),
  )

  const ranked: RankedCandidate[] = videos.flatMap((video) => {
    const localeRows = localesByVideo.get(video.id) ?? []
    const preferredLocale =
      localeRows.find(
        (row) => row.locale === locale && row.status === "PUBLISHED",
      ) ?? null

    if (!preferredLocale) return []

    const previewImageUrl =
      imagesByVideo.get(video.id)?.find((row) => row.url)?.url ?? null
    const preferredDub =
      dubsByVideo
        .get(video.id)
        ?.find(
          (row) =>
            (row.hls || row.dash || row.share) &&
            (row.language?.bcp47 === locale ||
              row.language?.iso3 === locale ||
              row.language?.slug === locale),
        ) ?? null

    const candidate = {
      ref: "",
      videoId: video.id,
      slug: video.slug,
      title: preferredLocale?.title?.trim() || video.slug,
      description: preferredLocale?.description?.trim() || null,
      previewImageUrl,
      previewStreamUrl:
        preferredDub?.hls ?? preferredDub?.dash ?? preferredDub?.share ?? null,
      label: video.label ? String(video.label) : null,
      score: 0,
      updatedAt: video.updatedAt,
    }

    return [
      {
        ...candidate,
        score: scoreCandidate(candidate, tokens),
      },
    ]
  })

  ranked.sort((left, right) => {
    const leftSemanticRank = semanticRank.get(left.videoId)
    const rightSemanticRank = semanticRank.get(right.videoId)
    if (leftSemanticRank !== undefined || rightSemanticRank !== undefined) {
      return (leftSemanticRank ?? Infinity) - (rightSemanticRank ?? Infinity)
    }
    if (right.score !== left.score) return right.score - left.score
    if (right.updatedAt.getTime() !== left.updatedAt.getTime()) {
      return right.updatedAt.getTime() - left.updatedAt.getTime()
    }
    return left.title.localeCompare(right.title)
  })

  const selected = ranked.slice(0, safeLimit)
  if (selected.length === 0) {
    return []
  }

  return selected.map((candidate, index) => ({
    ref: `v${String(index + 1).padStart(2, "0")}` as const,
    videoId: candidate.videoId,
    slug: candidate.slug,
    title: candidate.title,
    description: candidate.description,
    previewImageUrl: candidate.previewImageUrl,
    previewStreamUrl: candidate.previewStreamUrl,
    label: candidate.label,
  }))
}

async function loadSemanticVideoCandidateIds(
  prisma: PrismaClient,
  {
    locale,
    prompt,
    limit,
  }: {
    locale: string
    prompt: string
    limit: number
  },
): Promise<string[]> {
  let generated: Awaited<ReturnType<typeof generateExperienceEmbedding>>
  try {
    generated = await generateExperienceEmbedding(prompt)
  } catch (error) {
    console.warn(
      "[experience-ai] primary semantic video candidate search unavailable; trying local Ollama index",
      error instanceof Error ? error.message : String(error),
    )
    return loadLocalOllamaVideoCandidateIds(prisma, {
      locale,
      prompt,
      limit,
    })
  }

  const pgVector = toPgVector(generated.embedding)
  const safeLimit = Math.max(1, Math.min(limit, CANDIDATE_FETCH_WINDOW))

  const hits = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SET LOCAL hnsw.ef_search = ${VECTOR_SEARCH_EF_SEARCH}`,
    )
    return tx.$queryRaw<VideoEmbeddingHit[]>`
      WITH scene_hits AS (
        SELECT
          vs.video_id AS "videoId",
          MIN(vsl.embedding <=> ${pgVector}::vector) AS distance
        FROM video_scene_locale vsl
        JOIN video_scene vs ON vs.id = vsl.video_scene_id
        JOIN video v ON v.id = vs.video_id
        WHERE vsl.embedding IS NOT NULL
          AND vsl.locale = ${locale}
          AND v.deleted_at IS NULL
        GROUP BY vs.video_id
      ),
      transcript_hits AS (
        SELECT
          vt.video_id AS "videoId",
          MIN(vtc.embedding <=> ${pgVector}::vector) AS distance
        FROM video_transcript_chunk vtc
        JOIN video_transcript vt ON vt.id = vtc.transcript_id
        JOIN video v ON v.id = vt.video_id
        WHERE vtc.embedding IS NOT NULL
          AND vtc.language = ${locale}
          AND v.deleted_at IS NULL
        GROUP BY vt.video_id
      ),
      combined AS (
        SELECT * FROM scene_hits
        UNION ALL
        SELECT * FROM transcript_hits
      )
      SELECT
        "videoId",
        MIN(distance)::float AS distance
      FROM combined
      GROUP BY "videoId"
      ORDER BY distance ASC
      LIMIT ${safeLimit}
    `
  })

  return hits.map((hit) => hit.videoId)
}

async function loadLocalOllamaVideoCandidateIds(
  prisma: PrismaClient,
  {
    locale,
    prompt,
    limit,
  }: {
    locale: string
    prompt: string
    limit: number
  },
): Promise<string[]> {
  let embedding: number[]
  try {
    embedding = await generateOllamaEmbedding(prompt)
  } catch (error) {
    console.warn(
      "[experience-ai] local Ollama candidate search unavailable; falling back to catalog token ranking",
      error instanceof Error ? error.message : String(error),
    )
    return []
  }

  const pgVector = toPgVector(embedding)
  const safeLimit = Math.max(1, Math.min(limit, CANDIDATE_FETCH_WINDOW))

  const hits = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SET LOCAL hnsw.ef_search = ${VECTOR_SEARCH_EF_SEARCH}`,
    )
    return tx.$queryRaw<VideoEmbeddingHit[]>`
      SELECT
        vce.video_id AS "videoId",
        (vce.embedding <=> ${pgVector}::vector)::float AS distance
      FROM video_candidate_embedding vce
      JOIN video v ON v.id = vce.video_id
      WHERE vce.embedding IS NOT NULL
        AND vce.locale = ${locale}
        AND v.deleted_at IS NULL
      ORDER BY distance ASC
      LIMIT ${safeLimit}
    `
  })

  return hits.map((hit) => hit.videoId)
}

export async function generateExperienceAiDraft(
  prisma: PrismaClient,
  input: ExperienceAiGenerationInput,
): Promise<NormalizedExperienceDraft> {
  if (!hasPermission(input.user, "write:experiences")) {
    throw new ForbiddenError()
  }

  const localeRow = await prisma.experienceLocale.findUnique({
    where: { id: input.experienceLocaleId },
    select: {
      id: true,
      blocks: true,
      status: true,
      experience: {
        select: {
          ownerId: true,
          archivedAt: true,
        },
      },
    },
  })

  if (!localeRow) {
    throw new NotFoundError("ExperienceLocale", input.experienceLocaleId)
  }

  if (!canEditExperienceLocale(input.user, localeRow)) {
    throw new ForbiddenError()
  }

  if (Array.isArray(localeRow.blocks) && localeRow.blocks.length > 0) {
    throw new ExperienceAiGenerationError(
      "UPSTREAM_ERROR",
      "AI drafting only supports empty canvases in v1",
    )
  }

  const candidates = await loadExperienceAiVideoCandidates(prisma, {
    locale: input.locale,
    prompt: input.prompt,
    limit: input.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT,
  })

  if (candidates.length === 0) {
    throw new ExperienceAiGenerationError(
      "NO_CANDIDATES",
      "No catalog-backed video candidates were available for this locale",
    )
  }

  const startedAt = Date.now()
  const { payload: providerDraft, providerKind } = await createStructuredDraft({
    prompt: input.prompt,
    locale: input.locale,
    candidates,
  })

  const draftParse = DraftExperienceSchema.safeParse(providerDraft)
  if (!draftParse.success) {
    throw new ExperienceAiGenerationError(
      "SCHEMA_MISMATCH",
      "AI provider response did not match the draft schema",
    )
  }

  let normalized: NormalizedExperienceDraft
  try {
    normalized = normalizeExperienceDraft(draftParse.data, candidates)
  } catch (error) {
    if (error instanceof ExperienceAiNormalizationError) {
      throw new ExperienceAiGenerationError(
        "NORMALIZATION_ERROR",
        error.message,
      )
    }
    throw error
  }

  // Rule-witness log — greppable invariant trail in Railway. MUST NOT
  // include the operator prompt or any candidate metadata (titles,
  // descriptions, URLs). Mirrors the workflow log shape used in
  // src/workflows/transcriptEmbeddingBackfill.ts.
  try {
    console.log(
      JSON.stringify({
        service: "experience-ai",
        event: "draft_generated",
        experienceId: input.experienceId ?? null,
        experienceLocaleId: input.experienceLocaleId,
        locale: input.locale,
        providerKind,
        candidateCount: candidates.length,
        blockCount: normalized.blocks.length,
        rulesSatisfied: {
          catalogOnly: true,
          localeMatchedDubs: true,
          blocksSchemaParsed: true,
          ephemeralAction: true,
        },
        durationMs: Date.now() - startedAt,
      }),
    )
  } catch {
    // Never let a logging failure break a successful generation.
  }

  return normalized
}

export class ExperienceAiService {
  constructor(private prisma: PrismaClient) {}

  loadVideoCandidates(
    input: Parameters<typeof loadExperienceAiVideoCandidates>[1],
  ) {
    return loadExperienceAiVideoCandidates(this.prisma, input)
  }

  generateDraft(input: ExperienceAiGenerationInput) {
    return generateExperienceAiDraft(this.prisma, input)
  }
}

export {
  buildExperienceAiMessages,
  createStructuredDraft,
  pickProvider,
  scoreCandidate,
  tokenizePrompt,
}
