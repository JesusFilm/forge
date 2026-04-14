import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { canWriteDerived } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { env } from "@/config/env"
import { BlockSchema } from "@/domain/blocks"
import { toPgVector } from "@/db/pgvector"

export const EXPERIENCE_EMBEDDING_DIMENSIONS = 1536
export const OPENROUTER_EMBEDDING_MODEL = "openai/text-embedding-3-small"
export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"

const BLOCK_TEXT_IGNORE_KEY =
  /(?:^t$|url$|Url$|link$|Link$|Id$|Color$|variant$|itemsSource$|iframeSrc$|sectionKey$|headingLevel$|locale$|icon$)/i

const EmbeddingResponseSchema = z.object({
  data: z
    .array(
      z.object({
        embedding: z.array(z.number().finite()),
      }),
    )
    .min(1),
})

export type ExperienceEmbeddingLocaleInput = {
  title?: string | null
  metaDescription?: string | null
  ogTitle?: string | null
  ogDescription?: string | null
  blocks: unknown
}

export type GeneratedEmbedding = {
  model: string
  dimensions: number
  embedding: number[]
}

function normalizeLine(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function pushLine(
  lines: string[],
  seen: Set<string>,
  value: string | null | undefined,
) {
  if (!value) return
  const line = normalizeLine(value)
  if (!line || seen.has(line)) return
  seen.add(line)
  lines.push(line)
}

function collectBlockText(
  value: unknown,
  lines: string[],
  seen: Set<string>,
  parentKey?: string,
) {
  if (typeof value === "string") {
    if (parentKey && BLOCK_TEXT_IGNORE_KEY.test(parentKey)) {
      return
    }
    pushLine(lines, seen, value)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectBlockText(item, lines, seen, parentKey)
    }
    return
  }

  if (value != null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      collectBlockText(nested, lines, seen, key)
    }
  }
}

function embeddingEndpointFromBase(baseUrl: string): string {
  return new URL("embeddings", `${baseUrl.replace(/\/$/, "")}/`).toString()
}

export function buildExperienceEmbeddingText(
  locale: ExperienceEmbeddingLocaleInput,
): string {
  const lines: string[] = []
  const seen = new Set<string>()

  pushLine(lines, seen, locale.title)
  pushLine(lines, seen, locale.metaDescription)
  pushLine(lines, seen, locale.ogTitle)
  pushLine(lines, seen, locale.ogDescription)

  const parsedBlocks = z.array(BlockSchema).safeParse(locale.blocks)
  collectBlockText(
    parsedBlocks.success ? parsedBlocks.data : locale.blocks,
    lines,
    seen,
  )

  if (lines.length === 0) {
    throw new Error("ExperienceLocale has no text content to embed")
  }

  return lines.join("\n\n")
}

export async function generateExperienceEmbedding(
  text: string,
): Promise<GeneratedEmbedding> {
  const normalizedText = normalizeLine(text)
  if (!normalizedText) {
    throw new Error("Embedding input must not be empty")
  }

  const provider = env.OPENROUTER_API_KEY
    ? {
        apiKey: env.OPENROUTER_API_KEY,
        model: OPENROUTER_EMBEDDING_MODEL,
        url: "https://openrouter.ai/api/v1/embeddings",
      }
    : env.OPENAI_API_KEY
      ? {
          apiKey: env.OPENAI_API_KEY,
          model: OPENAI_EMBEDDING_MODEL,
          url: embeddingEndpointFromBase(
            env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
          ),
        }
      : null

  if (!provider) {
    throw new Error(
      "OPENROUTER_API_KEY or OPENAI_API_KEY is required for embedding generation",
    )
  }

  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${provider.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      input: [normalizedText],
      encoding_format: "float",
    }),
  })

  if (!response.ok) {
    throw new Error(`Embedding request failed with status ${response.status}`)
  }

  const parsed = EmbeddingResponseSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new Error("Embedding response validation failed")
  }

  const embedding = parsed.data.data[0]!.embedding
  if (embedding.length !== EXPERIENCE_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding response returned ${embedding.length} dimensions; expected ${EXPERIENCE_EMBEDDING_DIMENSIONS}`,
    )
  }

  return {
    model: provider.model,
    dimensions: embedding.length,
    embedding,
  }
}

export async function writeExperienceLocaleEmbedding({
  prisma,
  localeId,
  embedding,
  user,
}: {
  prisma: Pick<PrismaClient, "$executeRaw">
  localeId: string
  embedding: readonly number[]
  user: Principal | null
}): Promise<void> {
  if (!canWriteDerived(user)) {
    throw new Error("Forbidden: derived writes require SYSTEM or ADMIN")
  }

  await prisma.$executeRaw`
    UPDATE experience_locale
    SET embedding = ${toPgVector(embedding)}::vector,
        updated_at = NOW()
    WHERE id = ${localeId}
  `
}
