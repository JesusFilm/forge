import type { PrismaClient } from "@prisma/client"

export type CoverageAuditStatus = "covered" | "missing" | "empty-ok"

export type CoverageAuditCheck = {
  key: string
  label: string
  adminCount: number
  status: CoverageAuditStatus
  confidence: "row-count" | "relationship-count"
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
    args: { where: { source: "CORE", deletedAt: null } },
    confidence: "relationship-count",
  },
  {
    key: "videoSubtitles",
    label: "Video subtitles",
    delegate: "videoSubtitle",
    args: { where: { source: "CORE", deletedAt: null } },
    confidence: "relationship-count",
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
