import { z } from "zod"
import { Prisma, type PrismaClient } from "@prisma/client"

import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { env } from "@/config/env"
import { BlocksSchema } from "@/domain/blocks"
import { ForbiddenError, NotFoundError } from "@/services/errors"
import {
  CreateExperienceLocaleInput,
  ExperienceLocaleDraftDataSchema,
  ExperienceLocaleDraftSnapshotSchema,
  UpdateExperienceLocaleInput,
} from "@/services/experience.schemas"
import {
  ExperienceService,
  localeDraftRevision,
} from "@/services/experience.service"

const ListExperiencesInput = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
})

const LocaleListInput = z.object({
  experienceId: z.string().min(1),
})

const LocaleReadInput = z.object({
  experienceId: z.string().min(1),
  locale: z.string().min(1).max(35),
})

const MissingLocalesInput = z.object({
  sourceLocale: z.string().min(1).max(35),
  targetLocales: z.array(z.string().min(1).max(35)).min(1).max(50),
})

const ValidateLocaleInput = z.object({
  mode: z.enum(["create", "update"]).optional().default("create"),
  draft: z.record(z.string(), z.unknown()),
})

const CreateLocaleToolInput = z.object({
  experienceId: z.string().min(1),
  locale: z.string().min(1).max(35),
  draft: z.record(z.string(), z.unknown()),
})

const UpdateLocaleToolInput = z.object({
  localeId: z.string().min(1),
  expectedDraftRevision: z.string().min(1).nullable(),
  draft: z.record(z.string(), z.unknown()),
})

const PublishLocaleToolInput = z.object({
  localeId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

const DiscardLocaleToolInput = z.object({
  localeId: z.string().min(1),
  expectedDraftRevision: z.string().min(1),
})

const PreviewLocaleToolInput = z.object({
  localeId: z.string().min(1),
})

const DiffLocaleInput = z.object({
  sourceLocaleId: z.string().min(1),
  targetDraft: z.record(z.string(), z.unknown()),
})

const MediaCheckInput = z.object({
  blocks: z.array(z.unknown()).max(200),
  targetLocale: z.string().min(1).max(35),
})

const VideoReplacementSearchInput = z.object({
  q: z.string().trim().min(1).max(200),
  locale: z.string().min(1).max(35),
  limit: z.number().int().min(1).max(20).optional().default(10),
})

const BibleLookupInput = z.object({
  query: z.string().trim().min(1).max(120),
  locale: z.string().min(1).max(35).optional(),
})

/**
 * Exported for the sibling experience-level MCP service
 * (experience-mcp.service.ts) so both MCP surfaces emit the identical
 * serialized locale shape.
 */
export type LocaleRow = {
  id: string
  experienceId: string
  locale: string
  slug: string
  isHomepage: boolean
  pathSegment: string | null
  title: string | null
  metaDescription: string | null
  ogTitle: string | null
  ogDescription: string | null
  ogImageUrl: string | null
  blocks: unknown
  status: string
  publishedAt: Date | null
  updatedAt: Date
}

export class ExperienceLocaleMcpService {
  constructor(private readonly prisma: PrismaClient) {}

  async listExperiences({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    this.assertCanRead(user)
    const input = ListExperiencesInput.parse(raw)
    const q = input.q

    const rows = await this.prisma.experience.findMany({
      where: {
        archivedAt: null,
        ...(q
          ? {
              locales: {
                some: {
                  OR: [
                    { slug: { contains: q, mode: "insensitive" } },
                    { title: { contains: q, mode: "insensitive" } },
                  ],
                },
              },
            }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: input.limit,
      select: {
        id: true,
        isTemplate: true,
        ownerId: true,
        updatedAt: true,
        locales: {
          orderBy: [{ locale: "asc" }],
          select: {
            id: true,
            locale: true,
            slug: true,
            title: true,
            status: true,
            updatedAt: true,
          },
        },
      },
    })

    const draftRows = await this.prisma.contentRevision.findMany({
      where: {
        entityType: "ExperienceLocale",
        entityId: {
          in: rows.flatMap((row) => row.locales.map((locale) => locale.id)),
        },
        status: "DRAFT",
      },
      select: {
        id: true,
        entityId: true,
        snapshot: true,
        previewToken: true,
        revisedAt: true,
        revisedBy: true,
        revisedByKind: true,
        reason: true,
      },
    })
    const draftsByLocaleId = new Map(
      draftRows.map((draft) => [draft.entityId, draft]),
    )

    return {
      experiences: rows.map((row) => ({
        id: row.id,
        isTemplate: row.isTemplate,
        ownerId: row.ownerId,
        updatedAt: row.updatedAt.toISOString(),
        locales: row.locales.map((locale) => {
          const draft = draftsByLocaleId.get(locale.id)
          const parsed = draft
            ? ExperienceLocaleDraftSnapshotSchema.safeParse(draft.snapshot)
            : null
          const effective = parsed?.success
            ? {
                ...locale,
                slug: parsed.data.data.slug,
                title: parsed.data.data.title,
              }
            : locale
          return {
            ...effective,
            updatedAt: effective.updatedAt.toISOString(),
            hasDraft: Boolean(draft),
            activeDraft: draft ? serializeActiveDraft(draft) : null,
          }
        }),
      })),
    }
  }

  async listLocales({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    this.assertCanRead(user)
    const input = LocaleListInput.parse(raw)
    const experience = await this.prisma.experience.findFirst({
      where: { id: input.experienceId, archivedAt: null },
      select: {
        id: true,
        isTemplate: true,
        ownerId: true,
        locales: {
          orderBy: [{ locale: "asc" }],
          select: {
            id: true,
            experienceId: true,
            locale: true,
            slug: true,
            isHomepage: true,
            pathSegment: true,
            title: true,
            metaDescription: true,
            ogTitle: true,
            ogDescription: true,
            ogImageUrl: true,
            blocks: true,
            status: true,
            publishedAt: true,
            updatedAt: true,
          },
        },
      },
    })
    if (!experience) throw new NotFoundError("Experience", input.experienceId)

    return {
      experience: {
        id: experience.id,
        isTemplate: experience.isTemplate,
        ownerId: experience.ownerId,
      },
      locales: await Promise.all(
        experience.locales.map(async (locale) => {
          const state = await new ExperienceService(
            this.prisma,
          ).getLocaleDraftState({ id: locale.id, user })
          return serializeDraftState(state)
        }),
      ),
    }
  }

  async readLocale({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    this.assertCanRead(user)
    const input = LocaleReadInput.parse(raw)
    const locale = await this.prisma.experienceLocale.findFirst({
      where: {
        experienceId: input.experienceId,
        locale: input.locale,
        experience: { archivedAt: null },
      },
      select: {
        id: true,
        experienceId: true,
        locale: true,
        slug: true,
        isHomepage: true,
        pathSegment: true,
        title: true,
        metaDescription: true,
        ogTitle: true,
        ogDescription: true,
        ogImageUrl: true,
        blocks: true,
        status: true,
        publishedAt: true,
        updatedAt: true,
        experience: {
          select: {
            id: true,
            isTemplate: true,
            ownerId: true,
          },
        },
      },
    })
    if (!locale) {
      throw new NotFoundError(
        "ExperienceLocale",
        `${input.experienceId}:${input.locale}`,
      )
    }

    const state = await new ExperienceService(this.prisma).getLocaleDraftState({
      id: locale.id,
      user,
    })
    return {
      experience: locale.experience,
      ...serializeDraftState(state),
    }
  }

  async findMissingLocales({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    this.assertCanRead(user)
    const input = MissingLocalesInput.parse(raw)
    const targetLocales = [...new Set(input.targetLocales)]
    const rows = await this.prisma.experience.findMany({
      where: {
        archivedAt: null,
        locales: {
          some: { locale: input.sourceLocale },
        },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        isTemplate: true,
        ownerId: true,
        locales: {
          where: {
            locale: { in: [input.sourceLocale, ...targetLocales] },
          },
          select: {
            id: true,
            locale: true,
            slug: true,
            title: true,
            status: true,
          },
        },
      },
    })

    return {
      sourceLocale: input.sourceLocale,
      targetLocales,
      experiences: rows
        .map((row) => {
          const presentLocales = new Set(
            row.locales.map((locale) => locale.locale),
          )
          const missingLocales = targetLocales.filter(
            (locale) => !presentLocales.has(locale),
          )
          return {
            id: row.id,
            isTemplate: row.isTemplate,
            ownerId: row.ownerId,
            source: row.locales.find(
              (locale) => locale.locale === input.sourceLocale,
            ),
            missingLocales,
            existingTargetLocales: row.locales.filter((locale) =>
              targetLocales.includes(locale.locale),
            ),
          }
        })
        .filter((row) => row.missingLocales.length > 0),
    }
  }

  validateLocaleDraft({ input: raw }: { input: unknown }) {
    const input = ValidateLocaleInput.parse(raw)
    const schema =
      input.mode === "update"
        ? UpdateExperienceLocaleInput.strict()
        : CreateExperienceLocaleInput.strict()
    const result = schema.safeParse(input.draft)
    const blocksResult =
      "blocks" in input.draft
        ? BlocksSchema.safeParse(input.draft.blocks)
        : null

    return {
      valid: result.success && (blocksResult?.success ?? true),
      mode: input.mode,
      issues: [
        ...issuesFromResult(result),
        ...(blocksResult ? issuesFromResult(blocksResult, "blocks") : []),
      ],
    }
  }

  async createLocale({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = CreateLocaleToolInput.parse(raw)
    const result = await new ExperienceService(this.prisma).createLocale({
      input: {
        ...input.draft,
        experienceId: input.experienceId,
        locale: input.locale,
      },
      user,
    })

    return { locale: serializeLocale(result) }
  }

  async updateLocale({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = UpdateLocaleToolInput.parse(raw)
    const draft = UpdateExperienceLocaleInput.omit({ id: true })
      .strict()
      .parse(input.draft)
    const result = await new ExperienceService(this.prisma).updateLocaleDraft({
      input: {
        ...draft,
        id: input.localeId,
      },
      user,
      expectedDraftRevision: input.expectedDraftRevision,
    })

    return {
      locale: serializeLocale(result.effective),
      activeDraft: serializeActiveDraft(result.activeDraft),
      rollback: {
        expectedDraftRevision: localeDraftRevision(result.activeDraft),
        restoreDraft:
          input.expectedDraftRevision === null
            ? null
            : draftDataForRollback(result.beforeEffective),
      },
    }
  }

  async publishLocale({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = PublishLocaleToolInput.parse(raw)
    const result = await new ExperienceService(this.prisma).publishLocale({
      input: { id: input.localeId },
      user,
    })

    return {
      locale: serializeLocale(result),
      reason: input.reason,
    }
  }

  async discardLocale({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = DiscardLocaleToolInput.parse(raw)
    const result = await new ExperienceService(this.prisma).rollbackLocaleDraft(
      {
        input: {
          id: input.localeId,
          expectedDraftRevision: input.expectedDraftRevision,
        },
        user,
      },
    )
    return {
      locale: serializeLocale(result.effective),
      discarded: result.activeDraft === null,
      activeDraft: result.activeDraft
        ? serializeActiveDraft(result.activeDraft)
        : null,
    }
  }

  async previewLocale({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = PreviewLocaleToolInput.parse(raw)
    const state = await new ExperienceService(this.prisma).getLocaleDraftState({
      id: input.localeId,
      user,
    })
    const activeDraft = state.activeDraft
    const token = activeDraft?.previewToken
    if (!activeDraft || !token) {
      throw new NotFoundError("Active ExperienceLocale draft", input.localeId)
    }
    return {
      localeId: input.localeId,
      draftRevisionId: activeDraft.id,
      previewUrl: previewUrlFor(token),
    }
  }

  async diffLocaleDraft({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    this.assertCanRead(user)
    const input = DiffLocaleInput.parse(raw)
    const source = (
      await new ExperienceService(this.prisma).getLocaleDraftState({
        id: input.sourceLocaleId,
        user,
      })
    ).effective
    const serializedSource = serializeLocale(source)
    const comparedFields = [
      "slug",
      "title",
      "metaDescription",
      "ogTitle",
      "ogDescription",
      "ogImageUrl",
      "blocks",
    ]

    return {
      source: serializedSource,
      changes: comparedFields
        .filter((field) => field in input.targetDraft)
        .map((field) => ({
          field,
          changed:
            JSON.stringify(
              serializedSource[field as keyof typeof serializedSource],
            ) !== JSON.stringify(input.targetDraft[field]),
        })),
    }
  }

  async checkMedia({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    this.assertCanRead(user)
    const input = MediaCheckInput.parse(raw)
    const refs = limitVideoReferences(extractVideoReferences(input.blocks), 50)
    const targetLanguage = await findLanguage(this.prisma, input.targetLocale)
    const candidates = [...new Set([...refs.videoIds, ...refs.videoSlugs])]

    const videos =
      candidates.length > 0
        ? await this.prisma.video.findMany({
            where: {
              deletedAt: null,
              OR: [
                { id: { in: candidates } },
                { coreId: { in: candidates } },
                { slug: { in: candidates } },
              ],
            },
            select: videoAvailabilitySelect(
              targetLanguage?.id,
              input.targetLocale,
            ),
          })
        : []

    return {
      targetLocale: input.targetLocale,
      targetLanguage,
      references: refs.references,
      videos: videos.map((video) => serializeVideoAvailability(video)),
      unresolvedReferences: refs.references.filter(
        (ref) =>
          !videos.some(
            (video) =>
              video.id === ref.value ||
              video.coreId === ref.value ||
              video.slug === ref.value,
          ),
      ),
    }
  }

  async searchReplacementVideos({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    this.assertCanRead(user)
    const input = VideoReplacementSearchInput.parse(raw)
    const targetLanguage = await findLanguage(this.prisma, input.locale)
    const videos = await this.prisma.video.findMany({
      where: {
        deletedAt: null,
        OR: [
          { slug: { contains: input.q, mode: "insensitive" } },
          {
            locales: {
              some: {
                deletedAt: null,
                OR: [
                  { title: { contains: input.q, mode: "insensitive" } },
                  { description: { contains: input.q, mode: "insensitive" } },
                  { snippet: { contains: input.q, mode: "insensitive" } },
                ],
              },
            },
          },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: input.limit,
      select: videoAvailabilitySelect(targetLanguage?.id, input.locale),
    })

    return {
      query: input.q,
      locale: input.locale,
      targetLanguage,
      videos: videos.map((video) => serializeVideoAvailability(video)),
    }
  }

  async lookupBible({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    this.assertCanRead(user)
    const input = BibleLookupInput.parse(raw)
    const [cachedPassages, citations] = await Promise.all([
      this.prisma.biblePassageCache.findMany({
        where: {
          OR: [
            { reference: { contains: input.query, mode: "insensitive" } },
            { humanReference: { contains: input.query, mode: "insensitive" } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: {
          id: true,
          provider: true,
          versionId: true,
          reference: true,
          humanReference: true,
          versionAbbreviation: true,
          versionTitle: true,
          contentFormat: true,
          content: true,
          copyright: true,
          publisherUrl: true,
          expiresAt: true,
        },
      }),
      this.prisma.bibleCitation.findMany({
        where: {
          deletedAt: null,
          OR: [
            { osisId: { contains: input.query, mode: "insensitive" } },
            {
              bibleBook: {
                osisId: { contains: input.query, mode: "insensitive" },
              },
            },
          ],
        },
        orderBy: [{ bibleBook: { order: "asc" } }, { chapterStart: "asc" }],
        take: 10,
        select: {
          id: true,
          osisId: true,
          chapterStart: true,
          chapterEnd: true,
          verseStart: true,
          verseEnd: true,
          bibleBook: {
            select: {
              osisId: true,
              name: true,
            },
          },
          video: {
            select: {
              id: true,
              slug: true,
            },
          },
        },
      }),
    ])

    return {
      query: input.query,
      locale: input.locale ?? null,
      cachedPassages: cachedPassages.map((passage) => ({
        ...passage,
        expiresAt: passage.expiresAt.toISOString(),
      })),
      citations,
    }
  }

  private assertCanRead(user: Principal | null) {
    if (!hasPermission(user, "read:experiences")) {
      throw new ForbiddenError()
    }
  }
}

function videoAvailabilitySelect(
  languageId: string | undefined,
  locale: string,
) {
  const targetLanguageId = languageId ?? "__no_matching_language__"
  const localeOr: Prisma.VideoLocaleWhereInput[] = [
    { locale },
    { languageSlug: locale },
  ]
  if (languageId) localeOr.push({ languageId })

  return Prisma.validator<Prisma.VideoSelect>()({
    id: true,
    coreId: true,
    slug: true,
    label: true,
    publishedAt: true,
    locales: {
      where: {
        deletedAt: null,
        OR: localeOr,
      },
      select: {
        locale: true,
        languageSlug: true,
        title: true,
        description: true,
        status: true,
      },
      take: 3,
    },
    dubs: {
      where: {
        deletedAt: null,
        published: true,
        languageId: targetLanguageId,
      },
      select: {
        id: true,
        languageId: true,
        hls: true,
        dash: true,
        share: true,
        muxVideoId: true,
      },
      take: 3,
    },
    subtitles: {
      where: {
        deletedAt: null,
        languageId: targetLanguageId,
      },
      select: {
        id: true,
        languageId: true,
        value: true,
        vttSrc: true,
        srtSrc: true,
      },
      take: 3,
    },
  })
}

function serializeVideoAvailability(video: {
  id: string
  coreId: string
  slug: string
  label: unknown
  publishedAt: Date | null
  locales: Array<{
    locale: string | null
    languageSlug: string | null
    title: string | null
    description: string | null
    status: string
  }>
  dubs: Array<{
    id: string
    hls: string | null
    dash: string | null
    share: string | null
    muxVideoId: string | null
  }>
  subtitles: Array<{
    id: string
    value: string | null
    vttSrc: string | null
    srtSrc: string | null
  }>
}) {
  const hasAudio = video.dubs.some(
    (dub) => dub.hls || dub.dash || dub.share || dub.muxVideoId,
  )
  const hasSubtitles = video.subtitles.some(
    (subtitle) => subtitle.value || subtitle.vttSrc || subtitle.srtSrc,
  )

  return {
    id: video.id,
    coreId: video.coreId,
    slug: video.slug,
    label: video.label,
    publishedAt: video.publishedAt?.toISOString() ?? null,
    localizedMetadata: video.locales,
    availability: {
      audio: hasAudio,
      subtitles: hasSubtitles,
      acceptable: hasAudio || hasSubtitles,
    },
  }
}

async function findLanguage(
  prisma: PrismaClient,
  locale: string,
): Promise<{ id: string; bcp47: string | null; slug: string | null } | null> {
  return prisma.language.findFirst({
    where: {
      deletedAt: null,
      OR: [{ bcp47: locale }, { slug: locale }, { iso3: locale }],
    },
    select: { id: true, bcp47: true, slug: true },
  })
}

function extractVideoReferences(blocks: unknown[]) {
  const references: Array<{
    path: string
    kind: "videoId" | "videoSlug"
    value: string
  }> = []

  function visit(value: unknown, path: string) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`))
      return
    }
    if (!value || typeof value !== "object") return

    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key
      if (typeof child === "string" && child.trim()) {
        if (key === "videoId") {
          references.push({
            path: childPath,
            kind: "videoId",
            value: child.trim(),
          })
        }
        if (key === "videoSlug") {
          references.push({
            path: childPath,
            kind: "videoSlug",
            value: child.trim(),
          })
        }
      }
      visit(child, childPath)
    }
  }

  visit(blocks, "blocks")

  return {
    references,
    videoIds: references
      .filter((reference) => reference.kind === "videoId")
      .map((reference) => reference.value),
    videoSlugs: references
      .filter((reference) => reference.kind === "videoSlug")
      .map((reference) => reference.value),
  }
}

function limitVideoReferences(
  refs: ReturnType<typeof extractVideoReferences>,
  limit: number,
) {
  const references = refs.references.slice(0, limit)

  return {
    references,
    videoIds: references
      .filter((reference) => reference.kind === "videoId")
      .map((reference) => reference.value),
    videoSlugs: references
      .filter((reference) => reference.kind === "videoSlug")
      .map((reference) => reference.value),
  }
}

export function serializeLocale(locale: LocaleRow) {
  return {
    id: locale.id,
    experienceId: locale.experienceId,
    locale: locale.locale,
    slug: locale.slug,
    isHomepage: locale.isHomepage,
    pathSegment: locale.pathSegment,
    title: locale.title,
    metaDescription: locale.metaDescription,
    ogTitle: locale.ogTitle,
    ogDescription: locale.ogDescription,
    ogImageUrl: locale.ogImageUrl,
    blocks: locale.blocks,
    status: locale.status,
    publishedAt: locale.publishedAt?.toISOString() ?? null,
    updatedAt: locale.updatedAt.toISOString(),
  }
}

function previewUrlFor(token: string) {
  return new URL(
    `/watch/preview/experience/${encodeURIComponent(token)}`,
    env.WATCH_CANONICAL_ORIGIN,
  ).toString()
}

function serializeActiveDraft(draft: {
  id: string
  snapshot: unknown
  previewToken: string | null
  revisedAt: Date
  revisedBy: string | null
  revisedByKind: string
  reason: string | null
}) {
  return {
    id: draft.id,
    revision: localeDraftRevision(draft),
    revisedAt: draft.revisedAt.toISOString(),
    revisedBy: draft.revisedBy,
    revisedByKind: draft.revisedByKind,
    reason: draft.reason,
    previewUrl: draft.previewToken ? previewUrlFor(draft.previewToken) : null,
  }
}

function draftDataForRollback(locale: LocaleRow) {
  return ExperienceLocaleDraftDataSchema.parse({
    slug: locale.slug,
    isHomepage: locale.isHomepage,
    pathSegment: locale.pathSegment,
    title: locale.title,
    metaDescription: locale.metaDescription,
    ogTitle: locale.ogTitle,
    ogDescription: locale.ogDescription,
    ogImageUrl: locale.ogImageUrl,
    blocks: locale.blocks,
  })
}

function serializeDraftState(state: {
  canonical: LocaleRow
  effective: LocaleRow
  activeDraft: {
    id: string
    snapshot: unknown
    previewToken: string | null
    revisedAt: Date
    revisedBy: string | null
    revisedByKind: string
    reason: string | null
  } | null
}) {
  return {
    canonical: serializeLocale(state.canonical),
    effective: serializeLocale(state.effective),
    // Backward-compatible alias: locale is always the editable effective state.
    locale: serializeLocale(state.effective),
    hasDraft: state.activeDraft !== null,
    activeDraft: state.activeDraft
      ? serializeActiveDraft(state.activeDraft)
      : null,
  }
}

function issuesFromResult(
  result: { success: true } | { success: false; error: z.ZodError },
  prefix?: string,
) {
  if (result.success) return []
  return result.error.issues.map((issue) => ({
    path: [prefix, ...issue.path].filter(Boolean).join("."),
    code: issue.code,
    message: issue.message,
  }))
}
