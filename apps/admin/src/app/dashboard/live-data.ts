import type { LocaleStatus, VideoDub } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { prisma } from "@/db/client"
import { getAdminLocale } from "@/i18n/server"
import { createServices } from "@/services"

function isMissingTableError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2021"
  )
}

type ExperienceLocaleRow = {
  experienceId: string
  locale: string
  slug: string
  title: string | null
  status: LocaleStatus
  updatedAt: Date
}

type VideoLocaleRow = {
  videoId: string
  locale: string
  title: string | null
  updatedAt: Date
}

type VideoDubRow = VideoDub & {
  language: {
    bcp47: string | null
    iso3: string | null
    slug: string | null
  } | null
}

function preferredLocaleCodes(locale: string) {
  const base = locale.split("-")[0]
  return base && base !== locale ? [locale, base] : [locale]
}

function choosePreferredLocale<T extends { locale: string }>(
  locales: readonly T[],
  preferred: string,
) {
  const priority = preferredLocaleCodes(preferred)
  for (const code of priority) {
    const exact = locales.find((item) => item.locale === code)
    if (exact) return exact
  }

  for (const code of priority) {
    const partial = locales.find((item) => item.locale.startsWith(code))
    if (partial) return partial
  }

  return locales[0]
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

function statusTone(status: LocaleStatus): "success" | "warning" | "danger" {
  if (status === "PUBLISHED") return "success"
  if (status === "ARCHIVED") return "danger"
  return "warning"
}

function sourceLabel(
  videoSource: "INTERNAL" | "YOUTUBE" | "CLOUDFLARE" | "MUX" | null,
) {
  if (videoSource === "MUX") return { label: "Mux", tone: "info" as const }
  if (videoSource === "CLOUDFLARE") {
    return { label: "Cloudflare", tone: "success" as const }
  }
  if (videoSource === "YOUTUBE") {
    return { label: "YouTube", tone: "warning" as const }
  }
  return { label: "Internal", tone: "muted" as const }
}

function formatDuration(dubs: VideoDubRow[]): string {
  const dub = dubs.find((item) => item.lengthInMilliseconds || item.duration)
  if (!dub) return "--:--"

  const seconds =
    dub.lengthInMilliseconds != null
      ? Number(dub.lengthInMilliseconds / BigInt(1000))
      : (dub.duration ?? 0)

  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

function dubCoverage(dubs: VideoDubRow[]): string {
  const tags = dubs
    .map(
      (dub) => dub.language?.bcp47 ?? dub.language?.iso3 ?? dub.language?.slug,
    )
    .filter((tag): tag is string => !!tag)
    .slice(0, 4)
    .map((tag) => tag.toUpperCase())

  return tags.length ? tags.join(", ") : "N/A"
}

export async function loadExperienceRows(principal: Principal) {
  const services = createServices(prisma)
  const locale = await getAdminLocale()
  let experiences: Awaited<ReturnType<typeof services.experience.list>>
  try {
    experiences = await services.experience.list({
      input: { limit: 50, offset: 0, includeArchived: false },
      user: principal,
      query: {},
    })
  } catch (error) {
    if (isMissingTableError(error)) {
      return []
    }
    throw error
  }

  const ids = experiences.map((item) => item.id)
  let locales: ExperienceLocaleRow[] = []
  try {
    locales = await prisma.experienceLocale.findMany({
      where: { experienceId: { in: ids } },
      select: {
        experienceId: true,
        locale: true,
        slug: true,
        title: true,
        status: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    })
  } catch (error) {
    if (isMissingTableError(error)) {
      return []
    }
    throw error
  }

  const localesByExperience = new Map<string, typeof locales>()
  for (const item of locales) {
    const current = localesByExperience.get(item.experienceId) ?? []
    current.push(item)
    localesByExperience.set(item.experienceId, current)
  }

  return experiences.map((experience) => {
    const experienceLocales = localesByExperience.get(experience.id) ?? []
    const localeRow = choosePreferredLocale(experienceLocales, locale)
    const title = localeRow?.title?.trim() || "Untitled Experience"
    const slug = localeRow?.slug ?? experience.id
    const status = localeRow?.status ?? "DRAFT"
    const owner = experience.ownerId?.slice(0, 8) ?? "SYSTEM"

    return {
      key: experience.id,
      title,
      slug: `/exp/${slug}`,
      owner,
      statusLabel: status,
      statusTone: statusTone(status),
      embedding: status === "PUBLISHED" ? "READY" : "PENDING",
      updated: formatDateTime(experience.updatedAt),
    }
  })
}

export async function loadVideoRows(principal: Principal) {
  const services = createServices(prisma)
  const locale = await getAdminLocale()
  let videos: Awaited<ReturnType<typeof services.video.list>>
  try {
    videos = await services.video.list({
      input: { limit: 30, offset: 0 },
      user: principal,
      query: {},
    })
  } catch (error) {
    if (isMissingTableError(error)) {
      return []
    }
    throw error
  }

  const ids = videos.map((item) => item.id)
  let videoLocales: VideoLocaleRow[] = []
  let videoDubs: VideoDubRow[] = []
  try {
    ;[videoLocales, videoDubs] = await Promise.all([
      prisma.videoLocale.findMany({
        where: { videoId: { in: ids } },
        select: {
          videoId: true,
          locale: true,
          title: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.videoDub.findMany({
        where: { videoId: { in: ids }, deletedAt: null },
        include: {
          language: {
            select: {
              bcp47: true,
              iso3: true,
              slug: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 12 * Math.max(ids.length, 1),
      }),
    ])
  } catch (error) {
    if (isMissingTableError(error)) {
      return []
    }
    throw error
  }

  const localesByVideo = new Map<string, typeof videoLocales>()
  for (const item of videoLocales) {
    const current = localesByVideo.get(item.videoId) ?? []
    current.push(item)
    localesByVideo.set(item.videoId, current)
  }

  const dubsByVideo = new Map<string, VideoDubRow[]>()
  for (const item of videoDubs) {
    const current = dubsByVideo.get(item.videoId) ?? []
    current.push(item)
    dubsByVideo.set(item.videoId, current)
  }

  return videos.map((video) => {
    const localeRows = localesByVideo.get(video.id) ?? []
    const dubRows = dubsByVideo.get(video.id) ?? []
    const localeRow = choosePreferredLocale(localeRows, locale)
    const title = localeRow?.title?.trim() || video.slug
    const source = sourceLabel(video.videoSource)

    return {
      key: video.id,
      title,
      id: video.coreId,
      sourceLabel: source.label,
      sourceTone: source.tone,
      dubs: dubCoverage(dubRows),
      updated: formatDateTime(video.updatedAt),
      duration: formatDuration(dubRows),
    }
  })
}
