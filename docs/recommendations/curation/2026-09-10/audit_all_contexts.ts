/** Read-only local catalog audit. Run from apps/admin; see all-context-coverage-report.md. */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { once } from "node:events"
import { parseArgs } from "node:util"
import { prisma } from "../../../../apps/admin/src/db/client"
import { hydrateCuratedVideos } from "../../../../apps/admin/src/services/recommendations/curated-pools.catalog"
import { CuratedPoolsService } from "../../../../apps/admin/src/services/recommendations/curated-pools.service"
import {
  CURATED_POOL_VALIDATION_VERSION,
  materializeCuratedContext,
  parseCuratedPoolSource,
  type CuratedPoolContext,
} from "../../../../apps/admin/src/services/recommendations/curated-pools.types"
import { AVAILABLE_UI_LOCALES } from "../../../../apps/web/src/i18n/generated-ui-locales"
import { createVideoIdentityDuplicateReasonResolver } from "../../../../apps/admin/src/services/video-dedup"

async function main() {
  const directory = dirname(resolve(process.argv[1]))
  const { values } = parseArgs({
    options: {
      "raw-dir": { type: "string" },
      "output-dir": { type: "string", default: directory },
      "verify-only": { type: "boolean", default: false },
    },
  })
  if (!values["raw-dir"]) throw new Error("Provide --raw-dir outside /tmp")
  const rawDir = resolve(values["raw-dir"])
  const outputDir = resolve(values["output-dir"]!)
  const requirement = { requestedCount: 6, excludedReserve: 24 }
  const sourceBytes = await readFile(
    resolve(directory, "admin-preview-source.json"),
  )
  const source = parseCuratedPoolSource(JSON.parse(sourceBytes.toString()))
  const sourceIds = source.candidates.flatMap((row) => [
    row.coreVideoId,
    ...row.alternateCoreVideoIds,
  ])
  const themes = source.themeVocabulary.map((row) => row.key)
  type Language = { audioLanguageSlug: string; coreLanguageId: string }
  type Display = {
    videoId: string
    locale: string
    title: string
    languageSlug: string | null
  }
  type InventoryVideo = {
    videoId: string
    coreVideoId: string
    visible: boolean
    imageUrl: string | null
  }
  type Dub = { videoId: string; audioLanguageSlug: string }
  type Materialized = ReturnType<typeof materializeCuratedContext>
  type Counts = {
    atLeast6: number
    atLeast30: number
    atLeast44: number
    oneTo5: number
    zero: number
  }
  const emptyCounts = (): Counts => ({
    atLeast6: 0,
    atLeast30: 0,
    atLeast44: 0,
    oneTo5: 0,
    zero: 0,
  })
  function addCount(counts: Counts, count: number) {
    for (const depth of [6, 30, 44] as const)
      if (count >= depth) counts[`atLeast${depth}`]++
    if (count > 0 && count < 6) counts.oneTo5++
    if (count === 0) counts.zero++
  }
  function validImage(value: string | null) {
    try {
      return (
        value !== null &&
        value.length <= 2048 &&
        new URL(value).protocol === "https:"
      )
    } catch {
      return false
    }
  }
  function csv(values: unknown[]) {
    return (
      values
        .map((value) => {
          const text = String(value ?? "")
          return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
        })
        .join(",") + "\n"
    )
  }
  async function writeJson(path: string, value: unknown) {
    await writeFile(path, JSON.stringify(value, null, 2) + "\n")
  }

  await mkdir(rawDir, { recursive: true })
  await mkdir(outputDir, { recursive: true })
  try {
    const extractSnapshot = () =>
      prisma.$transaction(
        async (db) => {
          await db.$executeRaw`SET TRANSACTION READ ONLY`
          const [database] = await db.$queryRaw<
            { database: string; snapshotAt: string }[]
          >`
      SELECT current_database()::text AS database, transaction_timestamp()::text AS "snapshotAt"`
          if (database.database !== "forge_feat477_20260910") {
            throw new Error(
              "This audit is scoped to isolated local database forge_feat477_20260910",
            )
          }
          const languages = await db.$queryRaw<Language[]>`
      SELECT slug AS "audioLanguageSlug", core_id AS "coreLanguageId"
      FROM language WHERE deleted_at IS NULL AND slug IS NOT NULL ORDER BY slug`
          const videos = await db.$queryRaw<InventoryVideo[]>`
      SELECT video.id AS "videoId", video.core_id AS "coreVideoId",
        (video.deleted_at IS NULL AND NOT ('watch' = ANY(video.restrict_view_platforms))
          AND video.slug ~ '^[a-z0-9_-]+$') AS visible, image.url AS "imageUrl"
      FROM video LEFT JOIN LATERAL (
        SELECT COALESCE(NULLIF(BTRIM(art.mobile_cinematic_high), ''), NULLIF(BTRIM(art.video_still), ''),
          NULLIF(BTRIM(art.thumbnail), ''), NULLIF(BTRIM(art.url), '')) AS url
        FROM video_image art WHERE art.video_id = video.id AND art.deleted_at IS NULL
          AND COALESCE(NULLIF(BTRIM(art.mobile_cinematic_high), ''), NULLIF(BTRIM(art.video_still), ''),
            NULLIF(BTRIM(art.thumbnail), ''), NULLIF(BTRIM(art.url), '')) ~ '^https://'
        ORDER BY art.created_at, art.id LIMIT 1
      ) image ON true ORDER BY video.id`
          const displays = await db.$queryRaw<Display[]>`
      SELECT video_id AS "videoId", locale, title, language_slug AS "languageSlug"
      FROM video_locale WHERE status = 'published' AND deleted_at IS NULL
        AND NULLIF(BTRIM(title), '') IS NOT NULL AND LENGTH(title) <= 512
      ORDER BY locale, video_id, language_core_id ASC NULLS LAST, id`
          const dubs = await db.$queryRaw<Dub[]>`
      SELECT DISTINCT dub.video_id AS "videoId", language.slug AS "audioLanguageSlug"
      FROM video_dub dub JOIN language ON language.id = dub.language_id AND language.deleted_at IS NULL
      JOIN mux_video mux ON mux.id = dub.mux_video_id AND mux.deleted_at IS NULL
        AND NULLIF(BTRIM(mux.playback_id), '') IS NOT NULL AND LENGTH(mux.playback_id) <= 512
      LEFT JOIN video_edition edition ON edition.id = dub.video_edition_id
      WHERE dub.deleted_at IS NULL AND dub.published = true
        AND (dub.video_edition_id IS NULL OR edition.deleted_at IS NULL) AND language.slug IS NOT NULL`
          const sourceVideoIds = videos
            .filter((row) => sourceIds.includes(row.coreVideoId))
            .map((row) => row.videoId)
          const knownDisplayLocales = new Set(displays.map((row) => row.locale))
          const localesWithDisplay = AVAILABLE_UI_LOCALES.filter((locale) =>
            knownDisplayLocales.has(locale),
          )
          const english = languages.find(
            (row) => row.audioLanguageSlug === "english",
          )!
          const hydratedByLocale: Record<
            string,
            Awaited<ReturnType<typeof hydrateCuratedVideos>>
          > = {}
          // No display rows means every candidate fails before dedup; one sentinel locale
          // hydrates common artwork/Watch visibility while preserving the actual SQL rules.
          for (const locale of [...localesWithDisplay, "zz-audit-missing"]) {
            hydratedByLocale[locale] = await hydrateCuratedVideos(
              db,
              sourceVideoIds,
              { locale, ...english },
            )
            console.log(
              `Extracted ${locale}: ${hydratedByLocale[locale].length} editorial references`,
            )
          }
          return {
            database,
            languages,
            videos,
            displays,
            dubs,
            hydratedByLocale,
          }
        },
        { isolationLevel: "RepeatableRead", timeout: 600_000, maxWait: 10_000 },
      )
    const snapshotPath = resolve(rawDir, "all-context-catalog-snapshot.json")
    // verify-only consumes this script's already preserved extraction, then compares
    // it with a fresh read by the official service. It never mutates database data.
    const extracted: Awaited<ReturnType<typeof extractSnapshot>> = values[
      "verify-only"
    ]
      ? JSON.parse(await readFile(snapshotPath, "utf8"))
      : await extractSnapshot()
    if (!values["verify-only"]) await writeJson(snapshotPath, extracted)
    const { database, languages, videos, displays, dubs, hydratedByLocale } =
      extracted
    const displayByLocale = new Map<string, Map<string, Display[]>>()
    for (const row of displays) {
      const byVideo =
        displayByLocale.get(row.locale) ?? new Map<string, Display[]>()
      const rows = byVideo.get(row.videoId) ?? []
      rows.push(row)
      byVideo.set(row.videoId, rows)
      displayByLocale.set(row.locale, byVideo)
    }
    const dubsByLanguage = new Map(
      languages.map((row) => [row.audioLanguageSlug, new Set<string>()]),
    )
    for (const row of dubs)
      dubsByLanguage.get(row.audioLanguageSlug)?.add(row.videoId)
    const validInventoryIds = new Set(
      videos
        .filter((row) => row.visible && validImage(row.imageUrl))
        .map((row) => row.videoId),
    )
    const videoById = new Map(videos.map((row) => [row.videoId, row]))
    const unresolved = sourceIds.filter(
      (id) => !videos.some((video) => video.coreVideoId === id),
    )
    const makeHydrated = (context: CuratedPoolContext) => {
      const base =
        hydratedByLocale[context.locale] ?? hydratedByLocale["zz-audit-missing"]
      const localized = displayByLocale.get(context.locale)
      const audioIds = dubsByLanguage.get(context.audioLanguageSlug)!
      return base.map((row) => {
        const choices = localized?.get(row.videoId) ?? []
        const display =
          choices.find(
            (choice) => choice.languageSlug === context.audioLanguageSlug,
          ) ?? choices[0]
        const rejectionReasons = row.rejectionReasons.filter(
          (reason) =>
            !["locale_unpublished", "exact_audio_unavailable"].includes(reason),
        )
        if (!display) rejectionReasons.push("locale_unpublished")
        if (!audioIds.has(row.videoId))
          rejectionReasons.push("exact_audio_unavailable")
        return { ...row, videoTitle: display?.title ?? "", rejectionReasons }
      })
    }
    const crossCheckContexts = [
      ["en", "english"],
      ["fr", "french"],
      ["hi", "hindi"],
      ["ta", "tamil"],
      ["en", "dagaari-northern"],
      ["en", "american-sign-language"],
      ["en", "arabic-najdi"],
      ["en", "english-african"],
      ["en", "french-african"],
      ["en", "aguna"],
      ["es", "spanish-latin-american"],
      ["ar", "arabic-modern-standard"],
      ["zh-Hans", "english"],
      ["zh-Hant", "english"],
      ["zh-Hans", "mandarin-china"],
      ["de", "english"],
      ["fr", "hindi"],
      ["ab", "english"],
    ].map(([locale, slug]) => {
      const language = languages.find((row) => row.audioLanguageSlug === slug)
      assert(language, `Missing crosscheck audio language ${slug}`)
      assert(
        AVAILABLE_UI_LOCALES.includes(
          locale as (typeof AVAILABLE_UI_LOCALES)[number],
        ),
        `Missing crosscheck website locale ${locale}`,
      )
      return { locale, ...language }
    })
    const official = await new CuratedPoolsService({ prisma }).audit({
      source,
      contexts: crossCheckContexts,
      requirement,
    })
    const crossChecks = official.contexts.map((expected) => {
      const actual = materializeCuratedContext(
        source,
        makeHydrated(expected),
        expected,
        true,
        requirement,
      ).coverage
      // Reason set equality matters; SQL hydration emits a stable order independent of
      // our batched reconstruction, so compare sorted core-ID/reason pairs.
      const normalized = (row: typeof expected) => ({
        ...row,
        rejected: [...row.rejected].sort((a, b) =>
          `${a.coreVideoId}:${a.reason}`.localeCompare(
            `${b.coreVideoId}:${b.reason}`,
          ),
        ),
      })
      assert.deepEqual(normalized(actual), normalized(expected))
      return {
        locale: expected.locale,
        audioLanguageSlug: expected.audioLanguageSlug,
        startUnique: expected.startUnique,
        passedEquivalence: true,
      }
    })
    await writeJson(
      resolve(outputDir, "all-context-equivalence-checks.json"),
      crossChecks,
    )
    // Inspect the only default-Web context with fewer than six starters but an
    // optimistic catalog-ID count of at least six. Multiple Admin IDs may still
    // represent the same film under runtime identity rules.
    const sparseLanguage = languages.find(
      (row) => row.audioLanguageSlug === "arabic-najdi",
    )!
    const sparseVideos = (
      await hydrateCuratedVideos(
        prisma,
        [...dubsByLanguage.get(sparseLanguage.audioLanguageSlug)!],
        { locale: "ar", ...sparseLanguage },
      )
    )
      .filter((row) => row.rejectionReasons.length === 0)
      .sort((a, b) => a.videoCoreId.localeCompare(b.videoCoreId))
    const duplicateReason = createVideoIdentityDuplicateReasonResolver()
    const kept: typeof sparseVideos = []
    const sparseRows = sparseVideos.map((row) => {
      const prior = kept.find((item) => duplicateReason(row, item))
      if (!prior) kept.push(row)
      return {
        coreVideoId: row.videoCoreId,
        title: row.videoTitle,
        duplicateOf: prior?.videoCoreId ?? null,
        duplicateReason: prior ? duplicateReason(row, prior) : null,
      }
    })
    await writeJson(
      resolve(outputDir, "all-context-arabic-najdi-inventory.json"),
      {
        context: { locale: "ar", ...sparseLanguage },
        eligibleAdminIds: sparseVideos.length,
        deterministicGreedyUnique: kept.length,
        rows: sparseRows,
      },
    )
    if (values["verify-only"]) {
      const summaryPath = resolve(
        outputDir,
        "all-context-coverage-summary.json",
      )
      const summary = JSON.parse(await readFile(summaryPath, "utf8"))
      summary.officialServiceEquivalenceChecks = crossChecks.length
      summary.equivalenceCheckedAt = official.checkedAt
      await writeJson(summaryPath, summary)
      console.log(
        JSON.stringify({
          officialServiceEquivalenceChecks: crossChecks.length,
          passed: true,
        }),
      )
      return
    }
    const reasons = [
      "editorial_review_pending",
      "watch_unavailable",
      "locale_unpublished",
      "exact_audio_unavailable",
      "artwork_unavailable",
      "canonical_duplicate",
      "video_unresolved",
    ]
    const columns = [
      "locale",
      "audioLanguageSlug",
      "coreLanguageId",
      "startUnique",
      "unionUnique",
      "atLeast6",
      "atLeast30",
      "atLeast44",
      "eligibleVideoIdsUpperBound",
      ...themes.map((key) => `pool:${key}`),
      ...reasons.map((key) => `rejected:${key}`),
    ]
    const fullPath = resolve(rawDir, "all-context-coverage.csv")
    const stream = createWriteStream(fullPath)
    stream.write(csv(columns))
    const globalCounts = emptyCounts()
    const inventoryCounts = emptyCounts()
    const localeSummaries = []
    const grouped = new Map<string, { locales: string[]; rows: string[] }>()
    let unionAddsInventory = 0
    let computationCount = 0
    const representatives: {
      context: CuratedPoolContext
      startVideoCoreIds: string[]
      poolCounts: Record<string, number>
    }[] = []
    for (const locale of AVAILABLE_UI_LOCALES) {
      const counts = emptyCounts()
      const inventory = emptyCounts()
      const poolCoverage = Object.fromEntries(
        themes.map((key) => [key, emptyCounts()]),
      )
      const patterns = new Map<string, Materialized>()
      const rows: string[] = []
      const localized = displayByLocale.get(locale)
      const inventoryIds = new Set(
        [...validInventoryIds].filter((id) => localized?.has(id)),
      )
      for (const language of languages) {
        const context = { locale, ...language }
        const hydrated = makeHydrated(context)
        const signature = JSON.stringify(
          hydrated.map((row) => [row.videoTitle, row.rejectionReasons]),
        )
        let materialized = patterns.get(signature)
        if (!materialized) {
          materialized = materializeCuratedContext(
            source,
            hydrated,
            context,
            true,
            requirement,
          )
          patterns.set(signature, materialized)
          computationCount++
        }
        const row = materialized.coverage
        const upperBound = [
          ...dubsByLanguage.get(language.audioLanguageSlug)!,
        ].filter((id) => inventoryIds.has(id)).length
        addCount(counts, row.startUnique)
        addCount(globalCounts, row.startUnique)
        addCount(inventory, upperBound)
        addCount(inventoryCounts, upperBound)
        for (const key of themes)
          addCount(poolCoverage[key], row.poolCounts[key])
        if (row.unionUnique > row.startUnique) unionAddsInventory++
        const rejected = new Map<string, number>()
        for (const item of row.rejected)
          rejected.set(item.reason, (rejected.get(item.reason) ?? 0) + 1)
        for (const reason of rejected.keys())
          assert(
            reasons.includes(reason),
            `Unexpected rejection reason: ${reason}`,
          )
        const rest = [
          language.audioLanguageSlug,
          language.coreLanguageId,
          row.startUnique,
          row.unionUnique,
          row.startUnique >= 6,
          row.startUnique >= 30,
          row.startUnique >= 44,
          upperBound,
          ...themes.map((key) => row.poolCounts[key]),
          ...reasons.map((key) => rejected.get(key) ?? 0),
        ]
        rows.push(csv(rest))
        if (!stream.write(csv([locale, ...rest]))) await once(stream, "drain")
        if (
          crossCheckContexts.some(
            (item) =>
              item.locale === locale &&
              item.audioLanguageSlug === language.audioLanguageSlug,
          )
        ) {
          representatives.push({
            context,
            startVideoCoreIds: materialized.pools
              .get("start")!
              .map((id) => videoById.get(id)!.coreVideoId),
            poolCounts: row.poolCounts,
          })
        }
      }
      const digest = createHash("sha256").update(rows.join("")).digest("hex")
      const group = grouped.get(digest) ?? { locales: [], rows }
      group.locales.push(locale)
      grouped.set(digest, group)
      localeSummaries.push({
        locale,
        publishedVideoIds: localized?.size ?? 0,
        starterCoverage: counts,
        inventoryUpperBoundCoverage: inventory,
        poolCoverage,
        uniqueEligibilityPatterns: patterns.size,
        matrixGroupDigest: digest,
      })
      console.log(
        `Checked ${locale}: ${counts.atLeast6}/${languages.length} supply six; ${patterns.size} distinct editorial patterns`,
      )
    }
    stream.end()
    await once(stream, "finish")
    const groups = [...grouped.entries()].map(([digest, group], index) => ({
      id: `group-${String(index + 1).padStart(2, "0")}`,
      digest,
      locales: group.locales,
      rows: group.rows,
    }))
    const compactCsv =
      csv(["localeGroup", ...columns.slice(1)]) +
      groups
        .flatMap((group) => group.rows.map((row) => `${group.id},${row}`))
        .join("")
    await writeFile(
      resolve(outputDir, "all-context-grouped-coverage.csv"),
      compactCsv,
    )
    await writeJson(
      resolve(outputDir, "all-context-locale-groups.json"),
      groups.map(({ rows: _rows, ...group }) => group),
    )
    await writeJson(
      resolve(outputDir, "all-context-locale-summary.json"),
      localeSummaries,
    )
    await writeJson(
      resolve(outputDir, "all-context-representative-pools.json"),
      representatives,
    )
    const summary = {
      status:
        "all-supported-locales-local-snapshot-metadata-audit-not-production-or-media-health-validation",
      ...database,
      completedAt: new Date().toISOString(),
      validationVersion: CURATED_POOL_VALIDATION_VERSION,
      sourceVersion: source.version,
      sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
      websiteLocaleCount: AVAILABLE_UI_LOCALES.length,
      audioLanguageCount: languages.length,
      contextCount: AVAILABLE_UI_LOCALES.length * languages.length,
      websiteLocalesWithPublishedDisplay: localeSummaries
        .filter((row) => row.publishedVideoIds > 0)
        .map((row) => row.locale),
      websiteLocalesWithoutPublishedDisplay: localeSummaries
        .filter((row) => row.publishedVideoIds === 0)
        .map((row) => row.locale),
      databaseDisplayLocalesNotExactWebsiteLocales: [
        ...displayByLocale.keys(),
      ].filter(
        (locale) =>
          !AVAILABLE_UI_LOCALES.includes(
            locale as (typeof AVAILABLE_UI_LOCALES)[number],
          ),
      ),
      unknownCoreVideoIds: unresolved,
      requirement,
      starterCoverage: globalCounts,
      inventoryUpperBoundCoverage: inventoryCounts,
      interestPoolsAddUniqueInventoryContexts: unionAddsInventory,
      distinctEditorialComputations: computationCount,
      losslessLocaleMatrixGroups: groups.length,
      officialServiceEquivalenceChecks: crossChecks.length,
      fullCsvPath: fullPath,
      fullCsvSha256: createHash("sha256")
        .update(await readFile(fullPath))
        .digest("hex"),
      inventoryInterpretation:
        "Distinct eligible Admin IDs including uncurated videos, before canonical dedup; optimistic ceiling, not a recommendation guarantee",
    }
    await writeJson(
      resolve(outputDir, "all-context-coverage-summary.json"),
      summary,
    )
    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
