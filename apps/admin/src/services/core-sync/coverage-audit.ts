import type { PrismaClient } from "@prisma/client"
import { coreQuery } from "./core-client"
import { fetchCoreImageIdSet } from "./phases/sync-video-images"

export type CoverageAuditStatus = "covered" | "missing" | "empty-ok"

export type CoverageAuditCheck = {
  key: string
  label: string
  adminCount: number
  coreCount?: number
  status: CoverageAuditStatus
  confidence: "row-count" | "relationship-count" | "core-count"
}

export type CoverageAudit = {
  generatedAt: string
  status: "pass" | "review"
  checks: CoverageAuditCheck[]
}

type CountDelegate = {
  count: (args?: unknown) => Promise<number>
}

type CheckConfig = {
  key: string
  label: string
  delegate: keyof PrismaClient
  args?: unknown
  confidence: CoverageAuditCheck["confidence"]
  emptyOk?: boolean
  // When present, the check compares `adminCount` against this Core-side
  // count instead of the row-count/empty-ok heuristic. A failed Core read
  // must not fail the sync, so callers degrade to the row-count heuristic
  // on error (see runCoverageAudit below).
  fetchCoreCount?: () => Promise<number>
}

const VIDEO_SUBTITLES_COUNT_QUERY = `
  query VideoSubtitlesCount {
    videoSubtitlesCount
  }
`

async function fetchCoreVideoSubtitlesCount(): Promise<number> {
  const result = await coreQuery<{ videoSubtitlesCount: number }>(
    VIDEO_SUBTITLES_COUNT_QUERY,
  )
  const count = result.data?.videoSubtitlesCount
  if (typeof count !== "number") {
    throw new Error("Core videoSubtitlesCount is missing")
  }
  return count
}

async function fetchCoreVideoImagesCount(): Promise<number> {
  const { ids } = await fetchCoreImageIdSet()
  return ids.size
}

const CHECKS: CheckConfig[] = [
  {
    key: "languages",
    label: "Languages",
    delegate: "language",
    args: { where: { source: "CORE", deletedAt: null } },
    confidence: "row-count",
  },
  {
    key: "languageLocales",
    label: "Language locales",
    delegate: "languageLocale",
    args: { where: { source: "CORE", deletedAt: null } },
    confidence: "relationship-count",
  },
  {
    key: "countries",
    label: "Countries",
    delegate: "country",
    args: { where: { source: "CORE", deletedAt: null } },
    confidence: "row-count",
  },
  {
    key: "countryLocales",
    label: "Country locales",
    delegate: "countryLocale",
    args: { where: { source: "CORE", deletedAt: null } },
    confidence: "relationship-count",
  },
  {
    key: "continentLocales",
    label: "Continent locales",
    delegate: "continentLocale",
    args: { where: { source: "CORE", deletedAt: null } },
    confidence: "relationship-count",
  },
  {
    key: "countryLanguages",
    label: "Country-language relations",
    delegate: "countryLanguage",
    args: { where: { source: "CORE", deletedAt: null } },
    confidence: "relationship-count",
  },
  {
    key: "keywords",
    label: "Keywords",
    delegate: "keyword",
    args: { where: { source: "CORE", deletedAt: null } },
    confidence: "row-count",
  },
  {
    key: "videos",
    label: "Videos",
    delegate: "video",
    args: { where: { source: "CORE", deletedAt: null } },
    confidence: "row-count",
  },
  {
    key: "videoLocales",
    label: "Video locales",
    delegate: "videoLocale",
    confidence: "relationship-count",
  },
  {
    key: "videoImages",
    label: "Video images",
    delegate: "videoImage",
    args: { where: { source: "CORE", deletedAt: null, coreId: { not: null } } },
    // Falls back to "row-count" if the Core read fails; see fetchCoreCount.
    confidence: "row-count",
    fetchCoreCount: fetchCoreVideoImagesCount,
  },
  {
    key: "videoSubtitles",
    label: "Video subtitles",
    delegate: "videoSubtitle",
    args: { where: { source: "CORE", deletedAt: null, coreId: { not: null } } },
    // Falls back to "row-count" if the Core read fails; see fetchCoreCount.
    confidence: "row-count",
    fetchCoreCount: fetchCoreVideoSubtitlesCount,
  },
  {
    key: "videoStudyQuestions",
    label: "Video study questions",
    delegate: "videoStudyQuestion",
    args: { where: { source: "CORE", deletedAt: null } },
    confidence: "relationship-count",
  },
  {
    key: "bibleCitations",
    label: "Bible citations",
    delegate: "bibleCitation",
    args: { where: { source: "CORE", deletedAt: null } },
    confidence: "relationship-count",
  },
  {
    key: "videoKeywords",
    label: "Video-keyword relations",
    delegate: "videoKeyword",
    confidence: "relationship-count",
  },
  {
    key: "videoRelations",
    label: "Video parent-child relations",
    delegate: "videoRelation",
    confidence: "relationship-count",
    emptyOk: true,
  },
  {
    key: "videoDubs",
    label: "Video dubs",
    delegate: "videoDub",
    args: { where: { source: "CORE", deletedAt: null } },
    confidence: "row-count",
  },
  {
    key: "videoDubDownloads",
    label: "Video dub downloads",
    delegate: "videoDubDownload",
    args: { where: { source: "CORE", deletedAt: null } },
    confidence: "relationship-count",
  },
  {
    key: "videoEditions",
    label: "Video editions",
    delegate: "videoEdition",
    args: { where: { source: "CORE", deletedAt: null } },
    confidence: "row-count",
  },
  {
    key: "muxVideos",
    label: "Mux videos",
    delegate: "muxVideo",
    args: { where: { source: "CORE", deletedAt: null } },
    confidence: "row-count",
    emptyOk: true,
  },
]

export async function runCoverageAudit(
  prisma: PrismaClient,
): Promise<CoverageAudit> {
  const checks = await Promise.all(
    CHECKS.map(async (check) => {
      const delegate = prisma[check.delegate] as unknown as CountDelegate
      const adminCount = await delegate.count(check.args)

      if (check.fetchCoreCount) {
        try {
          const coreCount = await check.fetchCoreCount()
          return {
            key: check.key,
            label: check.label,
            adminCount,
            coreCount,
            confidence: "core-count",
            status: adminCount < coreCount ? "missing" : "covered",
          } satisfies CoverageAuditCheck
        } catch (err) {
          console.error(
            JSON.stringify({
              event: "core-sync.coverage-audit.core-count-unavailable",
              key: check.key,
              error: err instanceof Error ? err.message : String(err),
            }),
          )
          return {
            key: check.key,
            label: check.label,
            adminCount,
            confidence: "row-count",
            status:
              adminCount > 0
                ? "covered"
                : check.emptyOk
                  ? "empty-ok"
                  : "missing",
          } satisfies CoverageAuditCheck
        }
      }

      return {
        key: check.key,
        label: check.label,
        adminCount,
        confidence: check.confidence,
        status:
          adminCount > 0 ? "covered" : check.emptyOk ? "empty-ok" : "missing",
      } satisfies CoverageAuditCheck
    }),
  )

  return {
    generatedAt: new Date().toISOString(),
    status: checks.some((check) => check.status === "missing")
      ? "review"
      : "pass",
    checks,
  }
}
