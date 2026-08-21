import type { RevisionStatus } from "@prisma/client"
import { notFound } from "next/navigation"
import { revalidatePath } from "next/cache"
import { ExperienceEditorWithChat } from "@/app/dashboard/experiences/experience-editor-with-chat"
import { duplicateExperienceForEditor } from "@/app/dashboard/experiences/duplicate-experience-action"
import {
  archiveThreadAction as archiveChatThreadCore,
  createThreadAction as createChatThreadCore,
  getMessagesAction as getChatMessagesCore,
  listThreadsAction as listChatThreadsCore,
} from "@/app/dashboard/experiences/experience-chat-actions"
import { runGenerateDraftAction } from "@/app/dashboard/experiences/generate-draft-action"
import { runGenerateSectionAction } from "@/app/dashboard/experiences/generate-section-action"
import { runGenerateVariantAction } from "@/app/dashboard/experiences/generate-variant-action"
import { buildMediaLibraryBrowserData } from "@/app/dashboard/media/media-library-browser-data"
import { uploadMediaAssetFromFormData } from "@/app/dashboard/media/upload-media-asset-action"
import {
  loadVideoCollectionChildren,
  loadVideoRows,
  videoIdsFromExperienceBlocks,
} from "@/app/dashboard/live-data"
import {
  matchesVideoLibraryCategory,
  parseVideoLibraryCategory,
  type VideoLibraryCategory,
} from "@/app/dashboard/video-library-utils"
import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { env } from "@/config/env"
import { prisma } from "@/db/client"
import { getAdminLocale } from "@/i18n/server"
import { createServices } from "@/services"
import { ForbiddenError } from "@/services/errors"
import {
  recordAdminVideoLibrarySearchTraceSafely,
  type AdminVideoLibrarySearchTraceClient,
} from "@/services/search-trace.service"

type LocaleSnapshot = {
  title: string | null
  slug: string | null
  pathSegment: string | null
  metaDescription: string | null
  ogTitle: string | null
  ogDescription: string | null
  ogImageUrl: string | null
  isHomepage: boolean
  blocks: unknown
  status: string | null
  publishedAt: string | null
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(value)
}

function statusTone(status: string): "success" | "warning" | "danger" {
  if (status === "PUBLISHED") return "success"
  if (status === "ARCHIVED") return "danger"
  return "warning"
}

function draftPreviewUrl(watchOrigin: string, previewToken: string | null) {
  if (!previewToken) return null
  return `${watchOrigin.replace(/\/$/, "")}/watch/preview/experience/${previewToken}`
}

function revisionTone(
  status: RevisionStatus,
): "success" | "warning" | "danger" | "info" | "muted" {
  if (status === "HISTORICAL") return "info"
  if (status === "DRAFT") return "warning"
  if (status === "DISCARDED") return "danger"
  return "muted"
}

function normalizeLocaleSnapshot(value: unknown): LocaleSnapshot | null {
  if (!value || typeof value !== "object") return null

  const envelope = value as { data?: Record<string, unknown> }
  const data = envelope.data
  if (!data || typeof data !== "object") return null

  return {
    title: typeof data.title === "string" ? data.title : null,
    slug: typeof data.slug === "string" ? data.slug : null,
    pathSegment: typeof data.pathSegment === "string" ? data.pathSegment : null,
    metaDescription:
      typeof data.metaDescription === "string" ? data.metaDescription : null,
    ogTitle: typeof data.ogTitle === "string" ? data.ogTitle : null,
    ogDescription:
      typeof data.ogDescription === "string" ? data.ogDescription : null,
    ogImageUrl: typeof data.ogImageUrl === "string" ? data.ogImageUrl : null,
    isHomepage: data.isHomepage === true,
    blocks: data.blocks,
    status: typeof data.status === "string" ? data.status : null,
    publishedAt: typeof data.publishedAt === "string" ? data.publishedAt : null,
  }
}

function snapshotFromLocale(locale: {
  title: string | null
  slug: string
  pathSegment: string | null
  metaDescription: string | null
  ogTitle: string | null
  ogDescription: string | null
  ogImageUrl: string | null
  isHomepage: boolean
  blocks: unknown
  status: string
  publishedAt: Date | null
}): LocaleSnapshot {
  return {
    title: locale.title,
    slug: locale.slug,
    pathSegment: locale.pathSegment,
    metaDescription: locale.metaDescription,
    ogTitle: locale.ogTitle,
    ogDescription: locale.ogDescription,
    ogImageUrl: locale.ogImageUrl,
    isHomepage: locale.isHomepage,
    blocks: locale.blocks,
    status: locale.status,
    publishedAt: locale.publishedAt?.toISOString() ?? null,
  }
}

async function languageSlugForLocale(locale: string): Promise<string | null> {
  const language = await prisma.language.findFirst({
    where: { bcp47: locale, deletedAt: null, slug: { not: null } },
    select: { slug: true },
  })
  return language?.slug ?? null
}

async function languageIdForLocale(locale: string): Promise<string | null> {
  const language = await prisma.language.findFirst({
    where: {
      deletedAt: null,
      OR: [{ bcp47: locale }, { slug: locale }, { iso3: locale }],
    },
    select: { id: true },
  })
  return language?.id ?? null
}

async function loadMediaLibrary() {
  const [folders, assets] = await Promise.all([
    prisma.mediaFolder.findMany({
      select: { id: true, name: true, parentId: true },
      orderBy: [{ parentId: "asc" }, { name: "asc" }],
    }),
    prisma.mediaAsset.findMany({
      where: { kind: "IMAGE", status: "READY" },
      select: {
        id: true,
        backend: true,
        originalFilename: true,
        mimeType: true,
        byteSize: true,
        objectKey: true,
        previewObjectKey: true,
        muxPlaybackId: true,
        folderId: true,
        updatedAt: true,
        locales: {
          where: { locale: "en" },
          select: { displayName: true, altText: true },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ])

  return buildMediaLibraryBrowserData({ folders, images: assets })
}

function summarizeSnapshotDiff(
  previous: LocaleSnapshot | null,
  current: LocaleSnapshot,
) {
  if (!previous) return "Current state"

  const changes: string[] = []
  if ((previous.title ?? "") !== (current.title ?? "")) changes.push("title")
  if ((previous.slug ?? "") !== (current.slug ?? "")) changes.push("slug")
  if ((previous.pathSegment ?? "") !== (current.pathSegment ?? "")) {
    changes.push("route prefix")
  }
  if ((previous.metaDescription ?? "") !== (current.metaDescription ?? "")) {
    changes.push("meta description")
  }
  if ((previous.ogTitle ?? "") !== (current.ogTitle ?? "")) {
    changes.push("OG title")
  }
  if ((previous.ogDescription ?? "") !== (current.ogDescription ?? "")) {
    changes.push("OG description")
  }
  if ((previous.ogImageUrl ?? "") !== (current.ogImageUrl ?? "")) {
    changes.push("OG image")
  }
  if (previous.isHomepage !== current.isHomepage) changes.push("homepage flag")
  if (
    JSON.stringify(previous.blocks ?? []) !==
    JSON.stringify(current.blocks ?? [])
  ) {
    changes.push("blocks")
  }
  if ((previous.status ?? "") !== (current.status ?? "")) changes.push("status")

  if (changes.length === 0) return "No content changes detected"
  const visible = changes.slice(0, 4).join(", ")
  return changes.length > 4
    ? `Changed ${visible}, and ${changes.length - 4} more`
    : `Changed ${visible}`
}

type ExperienceEditorPageProps = {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ locale?: string }>
}

export default async function ExperienceEditorPage({
  params,
  searchParams,
}: ExperienceEditorPageProps) {
  const [{ id }, resolvedSearchParams, principal, adminLocale] =
    await Promise.all([
      params,
      searchParams ?? Promise.resolve<{ locale?: string }>({}),
      requireSession(),
      getAdminLocale(),
    ])
  const mediaLibraryPromise = loadMediaLibrary()

  const services = createServices(prisma)
  const experienceSummary = await services.experience.getById({
    id,
    user: principal,
    query: {},
  })

  if (!experienceSummary) {
    notFound()
  }

  const experience = await prisma.experience.findFirst({
    where: { id: experienceSummary.id },
    include: {
      locales: {
        orderBy: { updatedAt: "desc" },
      },
    },
  })

  if (!experience) {
    notFound()
  }

  const localeCode = resolvedSearchParams.locale?.trim()
  const selectedLocale =
    experience.locales.find((locale) => locale.locale === localeCode) ??
    experience.locales.find((locale) => locale.locale === adminLocale) ??
    experience.locales[0]

  if (!selectedLocale) {
    notFound()
  }

  const draftState = await services.experience.getLocaleDraftState({
    id: selectedLocale.id,
    user: principal,
  })
  const editableLocale = draftState.effective

  const [
    videoLibrary,
    mediaLibrary,
    selectedLocaleLanguageId,
    activeLocaleDrafts,
  ] = await Promise.all([
    loadVideoRows(principal, {
      includeVideoIds: videoIdsFromExperienceBlocks(editableLocale.blocks),
      preferredLocale: selectedLocale.locale,
    }),
    mediaLibraryPromise,
    languageIdForLocale(selectedLocale.locale),
    prisma.contentRevision.findMany({
      where: {
        entityType: "ExperienceLocale",
        entityId: { in: experience.locales.map((locale) => locale.id) },
        status: "DRAFT",
      },
      select: { entityId: true, revisedAt: true },
    }),
  ])
  const activeDraftByLocaleId = new Map(
    activeLocaleDrafts.map((draft) => [draft.entityId, draft]),
  )

  const currentExperienceId = experience.id
  const canUploadImages = hasPermission(principal, "write:media-assets")

  async function duplicateExperienceAction() {
    "use server"

    const user = await requireSession()
    const services = createServices(prisma)

    return duplicateExperienceForEditor({
      duplicate: (args) => services.experience.duplicate(args),
      user,
      sourceExperienceId: currentExperienceId,
      selectedLocale: selectedLocale.locale,
      revalidate: () => revalidatePath("/dashboard/experiences"),
    })
  }

  async function uploadImageAssetAction(formData: FormData) {
    "use server"

    const user = await requireSession()
    const result = await uploadMediaAssetFromFormData({
      formData,
      user,
      imageOnly: true,
    })

    if (result.ok) {
      revalidatePath(`/dashboard/experiences/${currentExperienceId}`)
    }
    return result
  }

  const owner = experience.ownerId
    ? await prisma.user.findUnique({
        where: { id: experience.ownerId },
        select: { id: true, name: true, email: true },
      })
    : null

  const revisions = await prisma.contentRevision.findMany({
    where: {
      entityType: "ExperienceLocale",
      entityId: selectedLocale.id,
    },
    orderBy: { revisedAt: "desc" },
    take: 10,
  })

  const userIds = Array.from(
    new Set(
      revisions
        .map((revision) => revision.revisedBy)
        .filter((value): value is string => !!value),
    ),
  )
  const users =
    userIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
  const usersById = new Map(users.map((user) => [user.id, user]))
  const canonicalSnapshot = snapshotFromLocale(selectedLocale)
  const currentSnapshot = snapshotFromLocale(editableLocale)
  const activeDraft = draftState.activeDraft
  const historyRevisions = revisions.filter(
    (revision) => revision.id !== activeDraft?.id,
  )
  const activeDraftAuthor = activeDraft?.revisedBy
    ? usersById.get(activeDraft.revisedBy)
    : null
  const revisionEntries = [
    {
      id: `current-${selectedLocale.id}`,
      statusLabel: "ACTIVE",
      statusTone: activeDraft
        ? ("warning" as const)
        : statusTone(selectedLocale.status),
      reason: activeDraft
        ? "Shared draft"
        : selectedLocale.status === "PUBLISHED"
          ? "Currently published"
          : "Current unpublished version",
      summary: activeDraft
        ? summarizeSnapshotDiff(canonicalSnapshot, currentSnapshot)
        : "No staged changes",
      revisedAt: formatDateTime(
        activeDraft?.revisedAt ?? selectedLocale.updatedAt,
      ),
      revisedBy:
        activeDraftAuthor?.name?.trim() ||
        activeDraftAuthor?.email ||
        activeDraft?.revisedBy ||
        owner?.name?.trim() ||
        owner?.email ||
        "System",
      isActive: true,
    },
    ...historyRevisions.map((revision, index) => {
      const author = revision.revisedBy
        ? usersById.get(revision.revisedBy)
        : null
      const snapshot = normalizeLocaleSnapshot(revision.snapshot)
      const newerSnapshot =
        index === 0
          ? currentSnapshot
          : normalizeLocaleSnapshot(historyRevisions[index - 1]?.snapshot)

      return {
        id: revision.id,
        statusLabel: revision.status,
        statusTone: revisionTone(revision.status),
        reason: revision.appliedAt
          ? "Restored version"
          : revision.status === "HISTORICAL"
            ? "Historical version"
            : (revision.reason ?? "Revision recorded"),
        summary: revision.appliedAt
          ? `Restored on ${formatDateTime(revision.appliedAt)}`
          : summarizeSnapshotDiff(snapshot, newerSnapshot ?? currentSnapshot),
        revisedAt: formatDateTime(revision.revisedAt),
        revisedBy:
          author?.name?.trim() ||
          author?.email ||
          revision.revisedBy ||
          "System",
        isActive: false,
      }
    }),
  ]

  async function saveLocaleAction(formData: FormData) {
    "use server"

    const user = await requireSession()
    const services = createServices(prisma)
    const localeId = String(formData.get("id") ?? "")
    const blocksValue = String(formData.get("blocks") ?? "[]").trim() || "[]"

    let blocks: unknown
    try {
      blocks = JSON.parse(blocksValue)
    } catch {
      return { ok: false, error: "Blocks JSON must be valid JSON." }
    }

    try {
      await services.experience.updateLocale({
        input: {
          id: localeId,
          title: String(formData.get("title") ?? ""),
          slug: String(formData.get("slug") ?? ""),
          metaDescription: String(formData.get("metaDescription") ?? ""),
          ogTitle: String(formData.get("ogTitle") ?? ""),
          ogDescription: String(formData.get("ogDescription") ?? ""),
          ogImageUrl: String(formData.get("ogImageUrl") ?? "").trim() || null,
          pathSegment: String(formData.get("pathSegment") ?? "").trim() || null,
          isHomepage: formData.get("isHomepage") === "on",
          blocks,
        },
        user,
      })
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return {
          ok: false,
          error: "You do not have permission to edit this locale.",
        }
      }

      if (error instanceof Error) {
        return { ok: false, error: error.message }
      }

      return { ok: false, error: "Unable to save locale." }
    }

    revalidatePath("/dashboard/experiences")
    revalidatePath(`/dashboard/experiences/${id}`)
    const nextDraftState = await services.experience.getLocaleDraftState({
      id: localeId,
      user,
    })
    return {
      ok: true,
      previewUrl: draftPreviewUrl(
        env.WATCH_CANONICAL_ORIGIN,
        nextDraftState.activeDraft?.previewToken ?? null,
      ),
    }
  }

  async function publishLocaleAction(localeId: string) {
    "use server"

    const user = await requireSession()
    const services = createServices(prisma)

    try {
      await services.experience.publishLocale({
        input: { id: localeId },
        user,
      })
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return {
          ok: false,
          error: "You do not have permission to publish this locale.",
        }
      }

      if (error instanceof Error) {
        return { ok: false, error: error.message }
      }

      return { ok: false, error: "Unable to publish locale." }
    }

    revalidatePath("/dashboard/experiences")
    revalidatePath(`/dashboard/experiences/${id}`)
    return { ok: true }
  }

  async function discardLocaleDraftAction(localeId: string) {
    "use server"

    const user = await requireSession()
    const services = createServices(prisma)

    try {
      const canonical = await services.experience.discardLocaleDraft({
        input: { id: localeId },
        user,
      })
      revalidatePath("/dashboard/experiences")
      revalidatePath(`/dashboard/experiences/${id}`)
      return {
        ok: true,
        values: {
          title: canonical.title ?? "",
          slug: canonical.slug,
          metaDescription: canonical.metaDescription ?? "",
          ogTitle: canonical.ogTitle ?? "",
          ogDescription: canonical.ogDescription ?? "",
          ogImageUrl: canonical.ogImageUrl ?? "",
          pathSegment: canonical.pathSegment ?? "",
          isHomepage: canonical.isHomepage,
          blocksJson: JSON.stringify(canonical.blocks ?? [], null, 2),
        },
      }
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return {
          ok: false,
          error: "You do not have permission to discard this draft.",
        }
      }

      if (error instanceof Error) {
        return { ok: false, error: error.message }
      }

      return { ok: false, error: "Unable to discard draft." }
    }
  }

  async function createLocaleAction(formData: FormData) {
    "use server"

    const user = await requireSession()
    const services = createServices(prisma)
    const locale = String(formData.get("locale") ?? "").trim()
    const blocksValue = String(formData.get("blocks") ?? "[]").trim() || "[]"

    let blocks: unknown
    try {
      blocks = JSON.parse(blocksValue)
    } catch {
      return { ok: false, error: "Blocks JSON must be valid JSON." }
    }

    try {
      const created = await services.experience.createLocale({
        input: {
          experienceId: currentExperienceId,
          locale,
          title: String(formData.get("title") ?? ""),
          slug: String(formData.get("slug") ?? ""),
          metaDescription: String(formData.get("metaDescription") ?? ""),
          ogTitle: String(formData.get("ogTitle") ?? ""),
          ogDescription: String(formData.get("ogDescription") ?? ""),
          ogImageUrl: String(formData.get("ogImageUrl") ?? "").trim() || null,
          pathSegment: String(formData.get("pathSegment") ?? "").trim() || null,
          isHomepage: formData.get("isHomepage") === "on",
          blocks,
        },
        user,
      })

      revalidatePath("/dashboard/experiences")
      revalidatePath(`/dashboard/experiences/${id}`)
      return {
        ok: true,
        href: `/dashboard/experiences/${currentExperienceId}?locale=${created.locale}`,
      }
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return {
          ok: false,
          error: "You do not have permission to add locales.",
        }
      }

      if (error instanceof Error) {
        return { ok: false, error: error.message }
      }

      return { ok: false, error: "Unable to add locale." }
    }
  }

  async function restoreRevisionAction(revisionId: string) {
    "use server"

    const user = await requireSession()
    const services = createServices(prisma)

    try {
      await services.experience.restoreLocaleRevision({
        input: { revisionId },
        user,
      })
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return {
          ok: false,
          error: "You do not have permission to restore this revision.",
        }
      }

      if (error instanceof Error) {
        return { ok: false, error: error.message }
      }

      return { ok: false, error: "Unable to restore revision." }
    }

    revalidatePath("/dashboard/experiences")
    revalidatePath(`/dashboard/experiences/${id}`)
    return { ok: true }
  }

  async function listChatThreads() {
    "use server"
    const user = await requireSession()
    return listChatThreadsCore(
      { prisma, user },
      { experienceLocaleId: selectedLocale.id },
    )
  }

  async function createChatThread(input: { firstPrompt: string }) {
    "use server"
    const user = await requireSession()
    return createChatThreadCore(
      { prisma, user },
      {
        experienceLocaleId: selectedLocale.id,
        firstPrompt: input.firstPrompt,
      },
    )
  }

  async function archiveChatThread(threadId: string) {
    "use server"
    const user = await requireSession()
    await archiveChatThreadCore({ prisma, user }, { threadId })
  }

  async function getChatMessages(threadId: string) {
    "use server"
    const user = await requireSession()
    return getChatMessagesCore({ prisma, user }, { threadId })
  }

  async function loadVideosByIdsAction(videoIds: readonly string[]) {
    "use server"
    const user = await requireSession()
    if (videoIds.length === 0) return []
    return loadVideoRows(user, {
      includeVideoIds: videoIds,
      preferredLocale: selectedLocale.locale,
    })
  }

  async function loadVideoCollectionChildrenAction(parentVideoId: string) {
    "use server"
    const user = await requireSession()
    return loadVideoCollectionChildren(user, parentVideoId, {
      preferredLocale: selectedLocale.locale,
    })
  }

  async function searchVideoLibraryAction(
    query: string,
    context?: {
      category?: VideoLibraryCategory
      client?: AdminVideoLibrarySearchTraceClient
    },
  ) {
    "use server"
    const user = await requireSession()
    const normalizedQuery = query.trim()
    const category = parseVideoLibraryCategory(context?.category)
    if (!normalizedQuery) {
      return loadVideoRows(user, {
        category,
        preferredLocale: selectedLocale.locale,
      })
    }
    const services = createServices(prisma)
    const targetLanguageSlug = await languageSlugForLocale(
      selectedLocale.locale,
    )
    const client = context?.client ?? "experience-editor-video-picker"
    const startedAt = new Date()
    // Call the service directly so editor picker keystrokes use the new search
    // stack, then writes a client-identified admin trace for operator review.
    try {
      const response = await services.watchSearch.search({
        query: normalizedQuery,
        targetLanguageSlug,
        displayLanguageSlug: targetLanguageSlug,
        routeLanguageSlug: targetLanguageSlug,
        acceptLanguage: selectedLocale.locale,
        limit: 30,
        resultTypes: ["video"],
      })
      const videoIds = response.results
        .filter((result) => result.type === "video")
        .map((result) => result.id)
      const rows = await loadVideoRows(user, {
        includeVideoIds: videoIds,
        preferredLocale: selectedLocale.locale,
      })
      const filteredRows = rows.filter((row) =>
        matchesVideoLibraryCategory(row.label, category),
      )
      const byId = new Map(filteredRows.map((row) => [row.key, row]))
      const orderedRows = videoIds.flatMap((id) => {
        const row = byId.get(id)
        return row ? [row] : []
      })
      await recordAdminVideoLibrarySearchTraceSafely({
        query: normalizedQuery,
        locale: selectedLocale.locale,
        client,
        response,
        resultIds: orderedRows.map((row) => row.key),
        hydratedResultCount: orderedRows.length,
        targetLanguageSlug,
        startedAt,
        completedAt: new Date(),
      })
      return orderedRows
    } catch (error) {
      await recordAdminVideoLibrarySearchTraceSafely({
        query: normalizedQuery,
        locale: selectedLocale.locale,
        client,
        targetLanguageSlug,
        startedAt,
        completedAt: new Date(),
        outcome: "failed",
        traceClass:
          error instanceof Error ? error.constructor.name : "UnknownError",
      })
      throw error
    }
  }

  async function generateDraftAction(input: {
    prompt: string
    currentTitle?: string
    currentMetaDescription?: string
    threadId?: string
    mode?: "full" | "quick"
  }) {
    "use server"
    const user = await requireSession()
    return runGenerateDraftAction(
      { prisma, user },
      {
        localeId: selectedLocale.id,
        locale: selectedLocale.locale,
        prompt: input.prompt,
        currentTitle: input.currentTitle,
        currentMetaDescription: input.currentMetaDescription,
        threadId: input.threadId,
        mode: input.mode,
      },
    )
  }

  async function generateSectionAction(input: { anchorVideoId: string }) {
    "use server"
    const user = await requireSession()
    return runGenerateSectionAction(
      { prisma, user },
      {
        localeId: selectedLocale.id,
        locale: selectedLocale.locale,
        anchorVideoId: input.anchorVideoId,
      },
    )
  }

  async function generateVariantAction(input: { personaId: string }) {
    "use server"
    const user = await requireSession()
    return runGenerateVariantAction(
      { prisma, user },
      {
        sourceLocaleId: selectedLocale.id,
        locale: selectedLocale.locale,
        personaId: input.personaId,
      },
    )
  }

  return (
    <ExperienceEditorWithChat
      key={`${selectedLocale.id}:${selectedLocale.updatedAt.toISOString()}:${activeDraft?.id ?? "canonical"}:${activeDraft?.revisedAt.toISOString() ?? ""}`}
      experienceLocaleId={selectedLocale.id}
      locale={selectedLocale.locale}
      chatActions={{
        listThreads: listChatThreads,
        createThread: createChatThread,
        archiveThread: archiveChatThread,
        getMessages: getChatMessages,
      }}
      canPublish={hasPermission(principal, "publish:experiences")}
      hasPublishedVersion={selectedLocale.publishedAt !== null}
      hasDraft={activeDraft !== null}
      draftSavedAt={activeDraft ? formatDateTime(activeDraft.revisedAt) : null}
      previewUrl={draftPreviewUrl(
        env.WATCH_CANONICAL_ORIGIN,
        activeDraft?.previewToken ?? null,
      )}
      publishedSlug={
        selectedLocale.publishedAt !== null ? selectedLocale.slug : null
      }
      calendarDate={new Date().toISOString().slice(0, 10)}
      watchOrigin={env.WATCH_CANONICAL_ORIGIN}
      initialValues={{
        localeId: selectedLocale.id,
        videoLanguageId: selectedLocaleLanguageId,
        title: editableLocale.title ?? "",
        slug: editableLocale.slug,
        metaDescription: editableLocale.metaDescription ?? "",
        ogTitle: editableLocale.ogTitle ?? "",
        ogDescription: editableLocale.ogDescription ?? "",
        ogImageUrl: editableLocale.ogImageUrl ?? "",
        pathSegment: editableLocale.pathSegment ?? "",
        isHomepage: editableLocale.isHomepage,
        isTemplate: experience.isTemplate,
        blocksJson: JSON.stringify(editableLocale.blocks ?? [], null, 2),
      }}
      localeEntries={experience.locales.map((locale) => ({
        id: locale.id,
        code: locale.locale,
        title: locale.title?.trim() || "Untitled Locale",
        href: `/dashboard/experiences/${experience.id}?locale=${locale.locale}`,
        stateLabel: activeDraftByLocaleId.has(locale.id)
          ? "SHARED DRAFT"
          : locale.status,
        stateTone: activeDraftByLocaleId.has(locale.id)
          ? "warning"
          : statusTone(locale.status),
        active: locale.id === selectedLocale.id,
      }))}
      revisionEntries={revisionEntries}
      videoLibrary={videoLibrary}
      loadVideosByIdsAction={loadVideosByIdsAction}
      loadVideoCollectionChildrenAction={loadVideoCollectionChildrenAction}
      searchVideoLibraryAction={searchVideoLibraryAction}
      mediaLibrary={mediaLibrary}
      canUploadImages={canUploadImages}
      saveAction={saveLocaleAction}
      duplicateAction={
        hasPermission(principal, "write:experiences")
          ? duplicateExperienceAction
          : undefined
      }
      publishAction={publishLocaleAction}
      discardAction={discardLocaleDraftAction}
      createLocaleAction={createLocaleAction}
      restoreAction={restoreRevisionAction}
      uploadImageAction={uploadImageAssetAction}
      generateDraftAction={generateDraftAction}
      generateSectionAction={generateSectionAction}
      generateVariantAction={generateVariantAction}
    />
  )
}
