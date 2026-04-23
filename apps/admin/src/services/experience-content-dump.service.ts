// Per-target indexer for the R3 cms → admin experience content dump.
//
// Mirrors the R1/R2 indexer shape:
//   - `(prisma, input)` signature
//   - `canWriteDerived(input.user)` first guard
//   - Typed error class with inline code union
//   - All writes inside a single $transaction with explicit timeout
//
// Per-locale flow:
//   1. ABAC gate
//   2. Load source row (prefer published; fall back to draft)
//   3. Load top-level components from cms via the repository
//   4. Walk the component tree, pre-collect cms video ids
//   5. Resolve cms video ids → admin cuids via the resolver
//   6. Run per-component transformers (the recursion is internal to
//      the transformer; the resolver's lookup closure is shared
//      across all blocks for this locale)
//   7. Validate the assembled blocks array against admin's BlocksSchema
//   8. Resolve experience-level ogImage URL via files_related_mph
//   9. Build the merge payload + compute SHA-256 hash
//  10. Find or create the canonical Experience row by document_id
//      lookup against admin's ExperienceLocale.cms_document_id
//  11. Slug-collision check (admin's partial unique on
//      `(locale, slug) WHERE status='published'`)
//  12. Upsert the ExperienceLocale inside a $transaction
//
// The hash is NOT persisted by this service — the workflow writes
// it after the embedding dispatch succeeds. That preserves the
// "embed-dispatch-failed leaves stale hash → next rerun retries"
// invariant in plan Key Decision §12.
//
// Error contract: every failure mode is a typed `ExperienceContentDumpError`
// with a code from the inline union below. Raw cms / Prisma error
// messages NEVER leak into the outcome `reason` (cf. zod-validation-
// errors-must-not-echo-user-controlled-input-20260420.md).

import { createHash } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { canWriteDerived } from "@/auth/permissions"
import { BlocksSchema, type Block } from "@/domain/blocks"
import {
  BlockTransformError,
  transformBlocksTopLevel,
} from "./cms-block-transforms"
import type {
  CmsComponentRow,
  CmsExperienceRow,
  CmsExperienceSourceRepository,
} from "./cms-experience-source.types"
import type { CmsVideoIdResolver } from "./cms-video-id-resolver"
import { adminVideoIdLookup } from "./cms-video-id-resolver"

/**
 * Mirrors R1 and R2's transaction-timeout convention. Long
 * locale-content writes (~1 row + 1 collision lookup + maybe an
 * Experience insert) are well under 5s; the 30s ceiling matches
 * sibling indexers and protects against a rare slow query.
 */
const TRANSACTION_TIMEOUT_MS = 30_000

/**
 * Strapi v5 polymorphic-relation tag for `experience.ogImage`. Used
 * as the `related_type` filter against `files_related_mph`.
 */
const STRAPI_EXPERIENCE_RELATED_TYPE = "api::experience.experience"

export class ExperienceContentDumpError extends Error {
  readonly code:
    | "forbidden"
    | "null_locale"
    | "slug_collision"
    | "failed_validation"
    | "embed_dispatch_failed"
    | "cms_read"
    | "db_write"
  readonly cause?: unknown
  constructor(args: {
    code: ExperienceContentDumpError["code"]
    message: string
    cause?: unknown
  }) {
    super(args.message)
    this.name = "ExperienceContentDumpError"
    this.code = args.code
    this.cause = args.cause
  }
}

export type DumpExperienceLocaleInput = {
  documentId: string
  locale: string
  hasPublished: boolean
  hasDraft: boolean
  publishedAt: Date | null
  draftUpdatedAt: Date | null
  user: Principal | null
  repo: CmsExperienceSourceRepository
  videoResolver: CmsVideoIdResolver
}

export type DumpExperienceLocaleResult = {
  experienceLocaleId: string
  experienceId: string
  /** Final canonical row state (PUBLISHED if cms had a published row). */
  status: "DRAFT" | "PUBLISHED"
  action: "created" | "updated" | "skipped_unchanged"
  /** SHA-256 hex of the canonical-JSON merge payload. */
  newHash: string
  /** The previous `cms_content_hash` if the row already existed (else null). */
  previousHash: string | null
  /**
   * True when cms has BOTH a draft and a published row AND the draft
   * is newer than the published row (editor has unpublished pending
   * edits). Pure paper-trail signal — the dump uses the published
   * row regardless.
   */
  draftPendingNewer: boolean
  /**
   * cms video ids referenced by this locale's blocks that did NOT
   * resolve to an admin Video. Surfaced for operational visibility;
   * dropping the reference is the chosen behaviour (Key Decision
   * §11).
   */
  videoResolutionMisses: number[]
}

/**
 * Index one (documentId, locale) tuple from cms into admin. Throws
 * `ExperienceContentDumpError` on any structural failure; the
 * workflow catches it and surfaces a per-target outcome.
 */
export async function dumpExperienceLocale(
  prisma: PrismaClient,
  input: DumpExperienceLocaleInput,
): Promise<DumpExperienceLocaleResult> {
  if (!canWriteDerived(input.user)) {
    throw new ExperienceContentDumpError({
      code: "forbidden",
      message: "Dumping cms experience content requires SYSTEM or ADMIN",
    })
  }
  if (input.locale.length === 0) {
    throw new ExperienceContentDumpError({
      code: "null_locale",
      message: "cms experiences row has empty/null locale; cannot dump",
    })
  }

  // Step 1: pick the source row (prefer published).
  const targetState: "published" | "draft" = input.hasPublished
    ? "published"
    : "draft"
  const sourceRow = await safeCmsRead(() =>
    input.repo.loadExperienceRow(input.documentId, input.locale, targetState),
  )
  if (sourceRow === null) {
    throw new ExperienceContentDumpError({
      code: "cms_read",
      message: `cms returned no experience row for documentId=${input.documentId} locale=${input.locale} prefer=${targetState}`,
    })
  }

  const status: "PUBLISHED" | "DRAFT" =
    sourceRow.published_at !== null ? "PUBLISHED" : "DRAFT"

  // Step 2: load top-level components.
  const components = await safeCmsRead(() =>
    input.repo.loadComponents("experiences", sourceRow.entity_id, "blocks"),
  )

  // Step 3: pre-collect every cms video id referenced anywhere in
  // the component tree, then resolve them in one batch.
  const videoIds = collectCmsVideoIds(components)
  const resolutions = await input.videoResolver.resolve(videoIds)
  const videoLookup = adminVideoIdLookup(resolutions)
  const videoResolutionMisses: number[] = []
  for (const [cmsId, res] of resolutions.entries()) {
    if (res.adminVideoId === null) videoResolutionMisses.push(cmsId)
  }

  // Step 4: transform components → admin Block[]. Per-component
  // BlockTransformErrors propagate up as failed_validation.
  let blocks: Block[]
  try {
    blocks = transformBlocksTopLevel(components, videoLookup)
  } catch (err) {
    if (err instanceof BlockTransformError) {
      throw new ExperienceContentDumpError({
        code: "failed_validation",
        message: `cms component ${err.componentType} (cmp_id=${err.cmpId ?? "<n/a>"}) failed transform: ${err.code}`,
        cause: err,
      })
    }
    throw err
  }

  // Step 5: top-level Zod parse. Single-pass validation gives clean
  // attribution. Zod error messages are NEVER returned to callers
  // (security: cf. zod-echo learning) — only logged server-side via
  // the workflow's per-target log.
  const parseResult = BlocksSchema.safeParse(blocks)
  if (!parseResult.success) {
    // Log full Zod detail for operators (Railway logs).
    console.error(
      JSON.stringify({
        event: "experience_content_dump.validation_failed",
        documentId: input.documentId,
        locale: input.locale,
        zodIssues: parseResult.error.issues.map((i) => ({
          path: i.path,
          code: i.code,
          message: i.message,
        })),
      }),
    )
    throw new ExperienceContentDumpError({
      code: "failed_validation",
      message: `assembled blocks array failed admin BlockSchema validation (${parseResult.error.issues.length} issue(s))`,
    })
  }

  // Step 6: resolve experience-level ogImage URL.
  const ogImageUrl = await safeCmsRead(() =>
    input.repo.loadMediaUrl(
      STRAPI_EXPERIENCE_RELATED_TYPE,
      sourceRow.entity_id,
      "ogImage",
    ),
  )

  // Step 7: build the merge payload + compute hash.
  const mergePayload = buildMergePayload(sourceRow, blocks, ogImageUrl)
  const newHash = sha256Hex(canonicalStringify(mergePayload))

  // Step 8: find existing admin row + collision check.
  const existing = await prisma.experienceLocale.findFirst({
    where: { cmsDocumentId: input.documentId, locale: input.locale },
    select: {
      id: true,
      experienceId: true,
      cmsContentHash: true,
    },
  })

  if (existing && existing.cmsContentHash === newHash) {
    // Idempotent rerun — only refresh the dumped-at timestamp; do
    // not re-write content fields (R3.12).
    await prisma.experienceLocale.update({
      where: { id: existing.id },
      data: { cmsDumpedAt: new Date() },
      select: { id: true },
    })
    return {
      experienceLocaleId: existing.id,
      experienceId: existing.experienceId,
      status,
      action: "skipped_unchanged",
      newHash,
      previousHash: existing.cmsContentHash,
      draftPendingNewer: computeDraftPendingNewer(input),
      videoResolutionMisses,
    }
  }

  const draftPendingNewer = computeDraftPendingNewer(input)

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // Resolve canonical Experience.
        const experienceId = await findOrCreateExperience({
          tx,
          documentId: input.documentId,
          isTemplate: sourceRow.is_template ?? false,
        })

        // Slug-collision check: admin's partial unique blocks
        // duplicate (locale, slug) WHERE status='published'.
        if (
          status === "PUBLISHED" &&
          mergePayload.slug !== null &&
          mergePayload.slug.length > 0
        ) {
          const collision = await tx.experienceLocale.findFirst({
            where: {
              locale: input.locale,
              slug: mergePayload.slug,
              status: "PUBLISHED",
              experienceId: { not: experienceId },
            },
            select: { id: true, cmsDocumentId: true },
          })
          if (collision !== null) {
            throw new ExperienceContentDumpError({
              code: "slug_collision",
              message: `cms publishes ${input.documentId}/${input.locale} with slug=${JSON.stringify(mergePayload.slug)} already published by cms_document_id=${collision.cmsDocumentId ?? "<unknown>"} (admin row ${collision.id})`,
            })
          }
        }

        // Upsert. We don't write `cmsContentHash` here — the
        // workflow's stepDispatchEmbedding writes it AFTER the
        // embed dispatch succeeds, so a dispatch failure leaves
        // the previous hash in place and the next rerun retries.
        const updateData: Prisma.ExperienceLocaleUncheckedUpdateInput = {
          slug: mergePayload.slug ?? "",
          isHomepage: mergePayload.isHomepage ?? false,
          pathSegment: mergePayload.pathSegment ?? null,
          title: mergePayload.title ?? null,
          metaDescription: mergePayload.metaDescription ?? null,
          ogTitle: mergePayload.ogTitle ?? null,
          ogDescription: mergePayload.ogDescription ?? null,
          ogImageUrl: mergePayload.ogImageUrl ?? null,
          blocks: mergePayload.blocks as Prisma.InputJsonValue,
          status,
          publishedAt: sourceRow.published_at,
          // Explicit updatedAt so admin's ExperienceLocale.updatedAt
          // reflects cms's authoritative timestamp on sync writes
          // (CLAUDE.md "explicit timestamp on sync writes" pattern).
          updatedAt: sourceRow.updated_at,
          cmsDocumentId: input.documentId,
          cmsDumpedAt: new Date(),
        }
        const upserted = await tx.experienceLocale.upsert({
          where: {
            experienceId_locale: {
              experienceId,
              locale: input.locale,
            },
          },
          create: {
            experienceId,
            locale: input.locale,
            slug: mergePayload.slug ?? "",
            isHomepage: mergePayload.isHomepage ?? false,
            pathSegment: mergePayload.pathSegment ?? null,
            title: mergePayload.title ?? null,
            metaDescription: mergePayload.metaDescription ?? null,
            ogTitle: mergePayload.ogTitle ?? null,
            ogDescription: mergePayload.ogDescription ?? null,
            ogImageUrl: mergePayload.ogImageUrl ?? null,
            blocks: mergePayload.blocks as Prisma.InputJsonValue,
            status,
            publishedAt: sourceRow.published_at,
            cmsDocumentId: input.documentId,
            cmsDumpedAt: new Date(),
          },
          update: updateData,
          select: { id: true },
        })
        return { experienceLocaleId: upserted.id, experienceId }
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    )

    return {
      experienceLocaleId: result.experienceLocaleId,
      experienceId: result.experienceId,
      status,
      action: existing === null ? "created" : "updated",
      newHash,
      previousHash: existing?.cmsContentHash ?? null,
      draftPendingNewer,
      videoResolutionMisses,
    }
  } catch (err) {
    if (err instanceof ExperienceContentDumpError) throw err
    // Mask raw Prisma errors so any column / parameter values stay
    // out of the workflow's outcome.reason payload.
    throw new ExperienceContentDumpError({
      code: "db_write",
      message: `db write failed for documentId=${input.documentId} locale=${input.locale}`,
      cause: err,
    })
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

type MergePayload = {
  slug: string | null
  isHomepage: boolean | null
  pathSegment: string | null
  title: string | null
  metaDescription: string | null
  ogTitle: string | null
  ogDescription: string | null
  ogImageUrl: string | null
  blocks: Block[]
}

function buildMergePayload(
  row: CmsExperienceRow,
  blocks: Block[],
  ogImageUrl: string | null,
): MergePayload {
  return {
    slug: row.slug,
    isHomepage: row.is_homepage,
    pathSegment: row.path_segment,
    title: row.title,
    metaDescription: row.meta_description,
    ogTitle: row.og_title,
    ogDescription: row.og_description,
    ogImageUrl,
    blocks,
  }
}

function computeDraftPendingNewer(
  input: Pick<
    DumpExperienceLocaleInput,
    "hasDraft" | "hasPublished" | "publishedAt" | "draftUpdatedAt"
  >,
): boolean {
  if (!(input.hasDraft && input.hasPublished)) return false
  const pub = input.publishedAt
  const draft = input.draftUpdatedAt
  if (pub === null || draft === null) return false
  return draft.getTime() > pub.getTime()
}

function collectCmsVideoIds(
  components: readonly CmsComponentRow[],
): Set<number> {
  const out = new Set<number>()
  for (const c of components) collectFromOne(c, out)
  return out
}

function collectFromOne(c: CmsComponentRow, out: Set<number>): void {
  // The switch discriminates on `componentType`, so TS narrows `c`
  // automatically inside each case — `as CmsXxx` casts are
  // redundant AND would let a typo'd case label compile silently.
  switch (c.componentType) {
    case "sections.video-hero":
      addIfNumber(c.cms_video_id, out)
      return
    case "sections.video":
      addIfNumber(c.cms_video_id, out)
      return
    case "sections.video-carousel":
      for (const item of c.items) {
        addIfNumber(item.cms_video_id, out)
      }
      return
    case "sections.media-collection":
      for (const item of c.items) {
        addIfNumber(item.cms_video_id, out)
      }
      return
    case "sections.section":
      for (const child of c.content) {
        collectFromOne(child, out)
      }
      return
    case "sections.container":
      for (const child of c.content) {
        collectFromOne(child, out)
      }
      return
    // Composites and leaves with no video relation
    case "sections.bible-quotes-carousel":
    case "sections.info-blocks":
    case "sections.navigation-carousel":
    case "sections.related-questions":
    case "sections.advent-countdown":
    case "sections.card":
    case "sections.cta":
    case "sections.easter-dates":
    case "sections.promo-banner":
    case "sections.quiz-button":
    case "sections.text":
    case "sections.container-slot":
      return
    default: {
      const _exhaustive: never = c
      void _exhaustive
      return
    }
  }
}

function addIfNumber(value: number | null, out: Set<number>): void {
  if (typeof value === "number" && Number.isInteger(value)) {
    out.add(value)
  }
}

async function findOrCreateExperience(args: {
  tx: Prisma.TransactionClient
  documentId: string
  isTemplate: boolean
}): Promise<string> {
  const existing = await args.tx.experienceLocale.findFirst({
    where: { cmsDocumentId: args.documentId },
    select: { experienceId: true },
  })
  if (existing !== null) {
    // If isTemplate has changed, refresh it on the canonical Experience.
    await args.tx.experience.update({
      where: { id: existing.experienceId },
      data: { isTemplate: args.isTemplate },
      select: { id: true },
    })
    return existing.experienceId
  }
  const created = await args.tx.experience.create({
    data: {
      isTemplate: args.isTemplate,
      // ownerId remains NULL — system-imported (R3.10).
    },
    select: { id: true },
  })
  return created.id
}

async function safeCmsRead<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw new ExperienceContentDumpError({
      code: "cms_read",
      message: `cms read failed: ${err instanceof Error ? err.name : "unknown"}`,
      cause: err,
    })
  }
}

// -----------------------------------------------------------------------------
// Hashing — SHA-256 over canonical JSON
// -----------------------------------------------------------------------------

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

/**
 * Deterministic JSON stringify with sorted object keys. Arrays
 * preserve order (positional content). Numbers/strings/booleans/null
 * pass through. `undefined` values omit the key (matching JSON.stringify).
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(canonicalize)
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] === undefined) continue
    out[key] = canonicalize(obj[key])
  }
  return out
}

/**
 * Test-only: persist the new content hash for an ExperienceLocale.
 * Called by the workflow's `stepDispatchEmbedding` AFTER
 * `runExperienceEmbedding` has been dispatched successfully — keeps
 * the "embed dispatch failed → next rerun retries" invariant in
 * plan Key Decision §12 since the previous hash stays in place
 * until then.
 */
export async function persistContentHash(
  prisma: PrismaClient,
  experienceLocaleId: string,
  hash: string,
): Promise<void> {
  await prisma.experienceLocale.update({
    where: { id: experienceLocaleId },
    data: { cmsContentHash: hash },
    select: { id: true },
  })
}

// -----------------------------------------------------------------------------
// Internal exports for tests
// -----------------------------------------------------------------------------

export const _internals = {
  buildMergePayload,
  computeDraftPendingNewer,
  collectCmsVideoIds,
  canonicalize,
  sha256Hex,
}
