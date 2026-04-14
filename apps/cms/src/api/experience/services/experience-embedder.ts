import type { Core } from "@strapi/strapi"
import { embedText, EMBEDDING_MODEL } from "../../../lib/openrouter"

const EXPERIENCE_UID = "api::experience.experience"

/**
 * Canonical model name for storage. EMBEDDING_MODEL includes the OpenRouter
 * vendor prefix ("openai/text-embedding-3-small") which is needed for the
 * API call but not for storage. Strip the prefix so all embedding tables
 * (transcript, scene, experience) store the same canonical model name.
 */
const STORAGE_MODEL = EMBEDDING_MODEL.replace(/^[^/]+\//, "")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Block = Record<string, any>

type ExperienceEntity = {
  id: number
  locale: string
  slug: string
  title: string | null
  metaDescription: string | null
  ogTitle: string | null
  ogDescription: string | null
  publishedAt: string | null
  blocks: Block[] | null
}

// ---------------------------------------------------------------------------
// HTML stripping
// ---------------------------------------------------------------------------

/** Strip HTML tags from richtext fields. Simple regex — sufficient for small CMS content blocks. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim()
}

// ---------------------------------------------------------------------------
// Content block text extraction
// ---------------------------------------------------------------------------

/**
 * Extract embeddable text segments from a single content block.
 * Dispatches on the `__component` discriminator set by Strapi's dynamic zone.
 */
function extractBlockText(block: Block): string[] {
  if (!block || typeof block !== "object") return []

  const component: string | undefined = block.__component
  if (!component) return []

  switch (component) {
    case "sections.text": {
      const parts: string[] = []
      if (block.heading) parts.push(String(block.heading))
      if (block.subtitle) parts.push(String(block.subtitle))

      const paragraphs = block.contentParagraphs
      if (Array.isArray(paragraphs)) {
        for (const p of paragraphs) {
          if (typeof p === "string" && p.trim()) parts.push(p.trim())
        }
      } else if (typeof paragraphs === "string" && paragraphs.trim()) {
        // May arrive as a JSON string from the DB
        try {
          const parsed = JSON.parse(paragraphs)
          if (Array.isArray(parsed)) {
            for (const p of parsed) {
              if (typeof p === "string" && p.trim()) parts.push(p.trim())
            }
          }
        } catch {
          parts.push(paragraphs.trim())
        }
      }
      return parts
    }

    case "sections.promo-banner": {
      const parts: string[] = []
      if (block.intro) parts.push(String(block.intro))
      if (block.heading) parts.push(String(block.heading))
      if (block.description) parts.push(String(block.description))
      return parts
    }

    case "sections.info-blocks": {
      const parts: string[] = []
      if (block.intro) parts.push(String(block.intro))
      if (block.heading) parts.push(String(block.heading))
      if (block.description) parts.push(String(block.description))

      if (Array.isArray(block.blocks)) {
        for (const item of block.blocks) {
          if (item?.title) parts.push(String(item.title))
          if (item?.description) parts.push(String(item.description))
        }
      }
      return parts
    }

    case "sections.card": {
      const parts: string[] = []
      if (block.title) parts.push(String(block.title))
      if (block.description) parts.push(String(block.description))
      return parts
    }

    case "sections.cta": {
      const parts: string[] = []
      if (block.heading) parts.push(String(block.heading))
      if (block.body) parts.push(stripHtml(String(block.body)))
      return parts
    }

    case "sections.related-questions": {
      const parts: string[] = []
      if (block.heading) parts.push(String(block.heading))

      if (Array.isArray(block.questions)) {
        for (const q of block.questions) {
          if (q?.question) parts.push(String(q.question))
          if (q?.answer) parts.push(stripHtml(String(q.answer)))
        }
      }
      return parts
    }

    case "sections.bible-quotes-carousel": {
      const parts: string[] = []
      if (block.heading) parts.push(String(block.heading))

      if (Array.isArray(block.quotes)) {
        for (const quote of block.quotes) {
          if (quote?.reference) parts.push(String(quote.reference))
          if (quote?.text) parts.push(String(quote.text))
        }
      }
      return parts
    }

    // Wrapper components — recurse into nested dynamic zones
    case "sections.section":
      return flattenContentBlocks(block.content)

    case "sections.container": {
      if (!Array.isArray(block.slots)) return []
      const parts: string[] = []
      for (const slot of block.slots) {
        parts.push(...flattenContentBlocks(slot?.content))
      }
      return parts
    }

    // Non-text components — skip
    default:
      return []
  }
}

/**
 * Walk an array of content blocks and extract all embeddable text segments.
 * Recurses into wrapper components (section, container).
 */
export function flattenContentBlocks(
  blocks: Block[] | null | undefined,
): string[] {
  if (!Array.isArray(blocks)) return []

  const segments: string[] = []
  for (const block of blocks) {
    segments.push(...extractBlockText(block))
  }
  return segments.filter(Boolean)
}

// ---------------------------------------------------------------------------
// Text flattener
// ---------------------------------------------------------------------------

/**
 * Build embeddable text from an experience entity.
 *
 * Concatenates in priority order: title, metaDescription, ogTitle (if
 * different from title), ogDescription (if different from metaDescription),
 * then flattened content blocks. This ordering ensures the embedding model
 * weights the most important fields highest.
 */
export function buildExperienceText(experience: ExperienceEntity): string {
  const parts: (string | null)[] = [
    experience.title,
    experience.metaDescription,
    experience.ogTitle !== experience.title ? experience.ogTitle : null,
    experience.ogDescription !== experience.metaDescription
      ? experience.ogDescription
      : null,
    ...flattenContentBlocks(experience.blocks),
  ]

  return parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .join("\n\n")
}

// ---------------------------------------------------------------------------
// DB read helpers
// ---------------------------------------------------------------------------

async function readExperience(
  strapi: Core.Strapi,
  experienceId: number,
): Promise<ExperienceEntity | null> {
  const entity = await strapi.db.query(EXPERIENCE_UID).findOne({
    where: { id: experienceId },
    select: [
      "id",
      "locale",
      "slug",
      "title",
      "metaDescription",
      "ogTitle",
      "ogDescription",
      "publishedAt",
    ],
    populate: {
      blocks: {
        populate: {
          // Nested components with text (info-block items, Q&A, quotes)
          blocks: true,
          questions: true,
          quotes: true,
          // sections.section → content dynamic zone
          content: {
            populate: { blocks: true, questions: true, quotes: true },
          },
          // sections.container → slots → content dynamic zone
          slots: {
            populate: {
              content: {
                populate: {
                  blocks: true,
                  questions: true,
                  quotes: true,
                },
              },
            },
          },
        },
      },
    },
  })

  return (entity as ExperienceEntity) ?? null
}

// ---------------------------------------------------------------------------
// Text limits
// ---------------------------------------------------------------------------

/**
 * Conservative character limit for text-embedding-3-small (8191 token limit).
 * ~4 chars/token average gives ~32k chars. We use 30k for safety margin.
 */
const MAX_SOURCE_TEXT_CHARS = 30_000

// ---------------------------------------------------------------------------
// pgvector helpers
// ---------------------------------------------------------------------------

function toPgvectorText(embedding: number[]): string {
  return `[${embedding.join(",")}]`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Index (upsert) an experience embedding.
 *
 * Reads the experience by id, flattens its text, generates an embedding via
 * OpenRouter, and upserts into `experience_embeddings`. If the experience
 * is not found or unpublished, any existing embedding is deleted instead.
 *
 * Designed to be safely callable many times for the same experience
 * (idempotent upsert via ON CONFLICT).
 */
export async function indexExperience(
  strapi: Core.Strapi,
  experienceId: number,
  locale: string,
): Promise<void> {
  const experience = await readExperience(strapi, experienceId)
  if (!experience || experience.publishedAt == null) {
    await deleteExperienceEmbedding(strapi, experienceId, locale)
    return
  }

  const sourceText = buildExperienceText(experience)
  if (sourceText.trim().length === 0) {
    await deleteExperienceEmbedding(strapi, experienceId, locale)
    strapi.log.warn(
      `[experience-embedding] No embeddable text for experience ${experienceId} (locale=${locale}), deleted stale embedding if any`,
    )
    return
  }

  const truncatedText =
    sourceText.length > MAX_SOURCE_TEXT_CHARS
      ? sourceText.slice(0, MAX_SOURCE_TEXT_CHARS)
      : sourceText

  const embedding = await embedText(truncatedText)
  const embeddingVector = toPgvectorText(embedding)
  const knex: KnexInstance = strapi.db.connection

  await knex.raw(
    `INSERT INTO experience_embeddings
       (experience_id, locale, slug, source_text, embedding, model)
     VALUES (?, ?, ?, ?, ?::vector, ?)
     ON CONFLICT (experience_id, locale) DO UPDATE
       SET slug = EXCLUDED.slug,
           source_text = EXCLUDED.source_text,
           embedding = EXCLUDED.embedding,
           model = EXCLUDED.model,
           updated_at = NOW()`,
    [
      experienceId,
      locale,
      experience.slug,
      truncatedText,
      embeddingVector,
      STORAGE_MODEL,
    ],
  )

  strapi.log.info(
    `[experience-embedding] Indexed experience ${experienceId} (locale=${locale}, slug=${experience.slug})`,
  )
}

/**
 * Delete an experience embedding row.
 *
 * Called when an experience is unpublished or deleted.
 */
export async function deleteExperienceEmbedding(
  strapi: Core.Strapi,
  experienceId: number,
  locale: string,
): Promise<void> {
  const knex: KnexInstance = strapi.db.connection

  await knex.raw(
    "DELETE FROM experience_embeddings WHERE experience_id = ? AND locale = ?",
    [experienceId, locale],
  )
}
