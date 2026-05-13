/**
 * Batch verification CLI — the cutover gate (plan-003 U8).
 *
 * Thin shim over `src/parity/batch-verification.ts`: parses argv,
 * resolves env (bearer, endpoints, base origin), constructs real
 * GraphQL fetchers, then hands off to `runBatchVerification`. The
 * orchestration loop, gate logic, and JSON-report shape live in the
 * module so they're typechecked and unit-tested.
 *
 * Usage:
 *   WEB_ADMIN_API_KEYS=<key> \
 *   STRAPI_GRAPHQL_URL=... \
 *   ADMIN_GRAPHQL_URL=... \
 *   STRAPI_PUBLIC_ORIGIN=... \
 *   pnpm tsx packages/graphql/scripts/run-batch-verification.ts \
 *     [--sample 100] [--concurrency 5] [--out path.json]
 *     [--allow-list path.json] [--since 2026-05-12T00:00:00Z] [--anonymous]
 *
 * Exit codes:
 *   0  Gate PASSED.
 *   1  Gate FAILED.
 *   2  Misconfiguration (bad args, missing env, allow-list parse error).
 *
 * NOTE: the script imports from the relative module path under
 * `src/parity/` rather than `@forge/graphql/parity`. Mirrors the
 * `capture-parity-fixture.ts` convention — running scripts via tsx
 * during local development resolves relative source paths without
 * waiting for a workspace build step.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import {
  BearerMissingError,
  HELP_TEXT,
  buildReport,
  combineAllowLists,
  formatSummary,
  parseAllowListFile,
  parseArgs,
  postGraphQL,
  readBearerFromEnv,
  runBatchVerification,
  sanitizeError,
  type BatchReport,
  type CorpusEntry,
  type Fetchers,
} from "../src/parity/batch-verification"
import type { AdminExperienceLocaleInput } from "../src/parity/normalize-admin"
import type { StrapiExperienceInput } from "../src/parity/normalize-strapi"

// ---------------------------------------------------------------------------
// GraphQL queries — kept inline to avoid pulling apps/admin / apps/web
// fragment modules into this dev-only script. Queries match the parity
// normalizer input shapes (StrapiExperienceInput / AdminExperienceLocaleInput).
// Operators iterating on fields should update these in lockstep with the
// normalizer types in src/parity/.
// ---------------------------------------------------------------------------

const STRAPI_CORPUS_QUERY = /* GraphQL */ `
  query ParityCorpusEnumerate {
    experiences(
      filters: { isTemplate: { eq: false }, publishedAt: { notNull: true } }
      pagination: { limit: -1 }
    ) {
      slug
      locale
      updatedAt
    }
  }
`

const STRAPI_EXPERIENCE_QUERY = /* GraphQL */ `
  query ParityExperienceBySlug($slug: String!, $locale: I18NLocaleCode!) {
    experiences(
      filters: { slug: { eq: $slug } }
      locale: $locale
      pagination: { limit: 1 }
    ) {
      documentId
      slug
      locale
      title
      metaDescription
      ogImage {
        url
        width
        height
        alternativeText
      }
      # REL-03: pagination: { limit: -1 } prevents Strapi v5's silent 10-row
      # nested-relation cap from truncating block counts on rich experiences,
      # which would surface as false structural diffs in the cutover gate.
      blocks(pagination: { limit: -1 }) {
        __typename
      }
    }
  }
`

// Per-kind block selections — every field admin's Pothos type exposes.
// Required because normalize-admin runs BlocksSchema.safeParse(), which
// rejects unknown fields AND missing required fields. Using the per-kind
// renderer fragments would NOT work: they alias names to Strapi vocab
// (e.g., `mediaDescription: description`) for the renderer's prop shape,
// which Zod would reject. Native admin field names only.
const BLOCK_LEAF_FRAGMENTS = /* GraphQL */ `
  fragment LeafAdventCountdown on AdventCountdownBlock {
    __typename
    t
    sectionKey
    backgroundColor
    imageUrl
    imageAssetId
    locale
    title
    scripture
    scriptureReference
  }
  fragment LeafBibleQuotesCarousel on BibleQuotesCarouselBlock {
    __typename
    t
    sectionKey
    backgroundColor
    imageUrl
    imageAssetId
    heading
    quotes {
      reference
      text
      backgroundImageUrl
      backgroundImageAssetId
      ctaEnabled
      ctaLabel
      ctaLink
      attribution
      imageUrl
      imageAssetId
      backgroundColor
    }
  }
  fragment LeafCard on CardBlock {
    __typename
    t
    sectionKey
    backgroundColor
    title
    description
    mediaUrl
    mediaAssetId
    link
    variant
  }
  fragment LeafContainerSlot on ContainerSlotBlock {
    __typename
    t
    backgroundColor
    backgroundImageUrl
    backgroundImageAssetId
    gridSpan
    spans {
      xs
      sm
      md
      lg
      xl
    }
  }
  fragment LeafCta on CtaBlock {
    __typename
    t
    sectionKey
    backgroundColor
    imageUrl
    imageAssetId
    heading
    body
    buttonLabel
    buttonLink
    variant
  }
  fragment LeafEasterDates on EasterDatesBlock {
    __typename
    t
    sectionKey
    backgroundColor
    imageUrl
    imageAssetId
    locale
    easterDatesTitle
    orthodoxEasterEnabled
    orthodoxEasterLabel
    passoverEnabled
    passoverLabel
    westernEasterEnabled
    westernEasterLabel
  }
  fragment LeafInfoBlocks on InfoBlocksBlock {
    __typename
    t
    sectionKey
    backgroundColor
    imageUrl
    imageAssetId
    heading
    intro
    description
    widthPercent
    blocks {
      title
      body
      icon
    }
  }
  fragment LeafMediaCollection on MediaCollectionBlock {
    __typename
    t
    sectionKey
    backgroundColor
    imageUrl
    imageAssetId
    categoryLabel
    variant
    itemsSource
    title
    subtitle
    description
    ctaLink
    ctaLabel
    showItemNumbers
    footerText
    items {
      videoId
      imageOverrideUrl
      imageOverrideAssetId
      titleOverride
      subtitleOverride
      labelOverride
      collectionSize
      imageUrl
      imageAssetId
      linkToSectionKey
    }
  }
  fragment LeafNavigationCarousel on NavigationCarouselBlock {
    __typename
    t
    sectionKey
    backgroundColor
    imageUrl
    imageAssetId
    items {
      title
      category
      contentId
      imageUrl
      imageAssetId
      backgroundColor
    }
  }
  fragment LeafPromoBanner on PromoBannerBlock {
    __typename
    t
    sectionKey
    backgroundColor
    imageUrl
    imageAssetId
    heading
    intro
    description
    ctaEnabled
    ctaLabel
    ctaLink
    widthPercent
  }
  fragment LeafQuizButton on QuizButtonBlock {
    __typename
    t
    sectionKey
    buttonText
    iframeSrc
  }
  fragment LeafRelatedQuestions on RelatedQuestionsBlock {
    __typename
    t
    sectionKey
    backgroundColor
    imageUrl
    imageAssetId
    heading
    ctaEnabled
    ctaLabel
    ctaLink
    questions {
      question
      answer
    }
  }
  fragment LeafText on TextBlock {
    __typename
    t
    sectionKey
    backgroundColor
    imageUrl
    imageAssetId
    heading
    headingLevel
    subtitle
    variant
    contentParagraphs
  }
  fragment LeafVideo on VideoBlock {
    __typename
    t
    sectionKey
    title
    titleSource
    subtitle
    subtitleSource
    mediaUrl
    mediaAssetId
    streamingUrl
    videoId
    useRouteVideo
    autoplay
    loop
    muted
    showControls
    clipStartSeconds
    clipEndSeconds
  }
  fragment LeafVideoCarousel on VideoCarouselBlock {
    __typename
    t
    sectionKey
    backgroundColor
    imageUrl
    imageAssetId
    itemsSource
    title
    subtitle
    description
    items {
      videoId
      imageUrl
      imageAssetId
      imageOverrideUrl
      imageOverrideAssetId
      streamingUrl
      backgroundColor
    }
  }
  fragment LeafVideoHero on VideoHeroBlock {
    __typename
    t
    sectionKey
    heading
    headingSource
    subheading
    subheadingSource
    ctaEnabled
    ctaLabel
    ctaLink
    streamingUrl
    videoId
    useRouteVideo
    autoplay
    loop
    muted
    showControls
    clipStartSeconds
    clipEndSeconds
  }
  fragment LeafVideoRecommendations on VideoRecommendationsBlock {
    __typename
    t
    sectionKey
    backgroundColor
    imageUrl
    title
    description
    sourceVideoId
    sourceSceneIndex
    limit
  }
`

// Container.content unfolds into a narrower union (no SectionBlock /
// ContainerBlock — admin's schema forbids those at the container slot).
const CONTAINER_CONTENT_FRAGMENT = /* GraphQL */ `
  fragment AdminContainerContent on ContainerContentBlock {
    __typename
    ... on AdventCountdownBlock {
      ...LeafAdventCountdown
    }
    ... on BibleQuotesCarouselBlock {
      ...LeafBibleQuotesCarousel
    }
    ... on CardBlock {
      ...LeafCard
    }
    ... on ContainerSlotBlock {
      ...LeafContainerSlot
    }
    ... on CtaBlock {
      ...LeafCta
    }
    ... on EasterDatesBlock {
      ...LeafEasterDates
    }
    ... on MediaCollectionBlock {
      ...LeafMediaCollection
    }
    ... on RelatedQuestionsBlock {
      ...LeafRelatedQuestions
    }
    ... on TextBlock {
      ...LeafText
    }
    ... on VideoBlock {
      ...LeafVideo
    }
  }
`

// Section.content allows containers (and therefore nested ContainerContent).
const SECTION_CONTENT_FRAGMENT = /* GraphQL */ `
  fragment AdminSectionContent on SectionContentBlock {
    __typename
    ... on BibleQuotesCarouselBlock {
      ...LeafBibleQuotesCarousel
    }
    ... on CardBlock {
      ...LeafCard
    }
    ... on ContainerBlock {
      __typename
      t
      sectionKey
      backgroundColor
      backgroundImageUrl
      backgroundImageAssetId
      content {
        ...AdminContainerContent
      }
    }
    ... on CtaBlock {
      ...LeafCta
    }
    ... on InfoBlocksBlock {
      ...LeafInfoBlocks
    }
    ... on MediaCollectionBlock {
      ...LeafMediaCollection
    }
    ... on NavigationCarouselBlock {
      ...LeafNavigationCarousel
    }
    ... on PromoBannerBlock {
      ...LeafPromoBanner
    }
    ... on QuizButtonBlock {
      ...LeafQuizButton
    }
    ... on RelatedQuestionsBlock {
      ...LeafRelatedQuestions
    }
    ... on TextBlock {
      ...LeafText
    }
    ... on VideoBlock {
      ...LeafVideo
    }
    ... on VideoCarouselBlock {
      ...LeafVideoCarousel
    }
  }
`

// Top-level ExperienceBlock union — every kind plus the two nested
// section/container content shapes.
const ADMIN_EXPERIENCE_QUERY = /* GraphQL */ `
  ${BLOCK_LEAF_FRAGMENTS}
  ${CONTAINER_CONTENT_FRAGMENT}
  ${SECTION_CONTENT_FRAGMENT}
  query ParityAdminExperienceBySlug($slug: String!, $locale: String!) {
    experienceBySlug(slug: $slug, locale: $locale) {
      id
      slug
      locale
      title
      # F1: admin's field is metaDescription; alias to "description" so the
      # response shape matches AdminExperienceLocaleInput's Strapi-vocab
      # "description" key (the normalizer's adapted input type).
      description: metaDescription
      ogImageUrl
      blocks {
        __typename
        ... on AdventCountdownBlock {
          ...LeafAdventCountdown
        }
        ... on BibleQuotesCarouselBlock {
          ...LeafBibleQuotesCarousel
        }
        ... on CardBlock {
          ...LeafCard
        }
        ... on ContainerBlock {
          __typename
          t
          sectionKey
          backgroundColor
          backgroundImageUrl
          backgroundImageAssetId
          content {
            ...AdminContainerContent
          }
        }
        ... on CtaBlock {
          ...LeafCta
        }
        ... on EasterDatesBlock {
          ...LeafEasterDates
        }
        ... on InfoBlocksBlock {
          ...LeafInfoBlocks
        }
        ... on MediaCollectionBlock {
          ...LeafMediaCollection
        }
        ... on NavigationCarouselBlock {
          ...LeafNavigationCarousel
        }
        ... on PromoBannerBlock {
          ...LeafPromoBanner
        }
        ... on RelatedQuestionsBlock {
          ...LeafRelatedQuestions
        }
        ... on SectionBlock {
          __typename
          t
          sectionKey
          backgroundColor
          backgroundImageUrl
          backgroundImageAssetId
          blurHash
          backgroundOpacity
          dynamicBackgroundImage
          staticOverlay
          content {
            ...AdminSectionContent
          }
        }
        ... on TextBlock {
          ...LeafText
        }
        ... on VideoBlock {
          ...LeafVideo
        }
        ... on VideoCarouselBlock {
          ...LeafVideoCarousel
        }
        ... on VideoHeroBlock {
          ...LeafVideoHero
        }
        ... on VideoRecommendationsBlock {
          ...LeafVideoRecommendations
        }
      }
    }
  }
`

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

type EnvConfig = {
  readonly strapiUrl: string
  readonly adminUrl: string
  readonly baseOrigin: string
}

function readEnv(env: NodeJS.ProcessEnv): EnvConfig {
  const strapiUrl = env.STRAPI_GRAPHQL_URL
  const adminUrl = env.ADMIN_GRAPHQL_URL
  const baseOrigin = env.STRAPI_PUBLIC_ORIGIN
  if (!strapiUrl) {
    throw new Error("STRAPI_GRAPHQL_URL is required")
  }
  if (!adminUrl) {
    throw new Error("ADMIN_GRAPHQL_URL is required")
  }
  if (!baseOrigin) {
    throw new Error("STRAPI_PUBLIC_ORIGIN is required")
  }
  return { strapiUrl, adminUrl, baseOrigin }
}

// ---------------------------------------------------------------------------
// Fetcher construction
// ---------------------------------------------------------------------------

function buildFetchers(env: EnvConfig, bearer: string | null): Fetchers {
  const enumerateCorpus = async (): Promise<ReadonlyArray<CorpusEntry>> => {
    const body = (await postGraphQL({
      url: env.strapiUrl,
      query: STRAPI_CORPUS_QUERY,
      bearer: null, // corpus enumeration goes through Strapi (anonymous OK)
    })) as {
      data?: {
        experiences?: Array<{
          slug?: string | null
          locale?: string | null
          updatedAt?: string | null
        }>
      }
    }
    const rows = body?.data?.experiences ?? []
    const entries: CorpusEntry[] = []
    for (const row of rows) {
      if (typeof row?.slug !== "string" || typeof row?.locale !== "string")
        continue
      entries.push({
        slug: row.slug,
        locale: row.locale,
        updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
      })
    }
    // Sort oldest-first so the stratified sampler's head/tail windows
    // line up with editorial recency.
    entries.sort((a, b) => {
      const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0
      const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0
      return ta - tb
    })
    return entries
  }

  const fetchStrapi = async (
    slug: string,
    locale: string,
  ): Promise<StrapiExperienceInput> => {
    const body = (await postGraphQL({
      url: env.strapiUrl,
      query: STRAPI_EXPERIENCE_QUERY,
      variables: { slug, locale },
      bearer: null,
    })) as { data?: { experiences?: ReadonlyArray<StrapiExperienceInput> } }
    const row = body?.data?.experiences?.[0]
    if (!row) {
      throw new Error(
        `Strapi: no experience found for slug=${slug} locale=${locale}`,
      )
    }
    return row
  }

  const fetchAdmin = async (
    slug: string,
    locale: string,
  ): Promise<AdminExperienceLocaleInput> => {
    const body = (await postGraphQL({
      url: env.adminUrl,
      query: ADMIN_EXPERIENCE_QUERY,
      variables: { slug, locale },
      bearer,
    })) as { data?: { experienceBySlug?: AdminExperienceLocaleInput | null } }
    const row = body?.data?.experienceBySlug
    if (!row) {
      throw new Error(
        `admin: no experience found for slug=${slug} locale=${locale}`,
      )
    }
    return row
  }

  return { enumerateCorpus, fetchStrapi, fetchAdmin }
}

// ---------------------------------------------------------------------------
// Output path resolution
// ---------------------------------------------------------------------------

function defaultOutputPath(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0")
  const ts =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  return resolve(process.cwd(), `.tmp/batch-verification-${ts}.json`)
}

async function writeReport(path: string, report: BatchReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(report, null, 2), "utf8")
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`[run-batch-verification] ${(err as Error).message}\n`)
    process.stderr.write(HELP_TEXT)
    return 2
  }

  if (args.help) {
    process.stdout.write(HELP_TEXT)
    return 0
  }

  let bearer: string | null
  let env: EnvConfig
  try {
    bearer = readBearerFromEnv(process.env, args.anonymous)
    env = readEnv(process.env)
  } catch (err) {
    if (err instanceof BearerMissingError) {
      process.stderr.write(`[run-batch-verification] ${err.message}\n`)
      return 2
    }
    process.stderr.write(
      `[run-batch-verification] ${sanitizeError(err, bearer ?? null)}\n`,
    )
    return 2
  }

  // Load operator-supplied allow-list if provided.
  let operatorAllowList: ReturnType<typeof parseAllowListFile> = []
  if (args.allowList !== null) {
    try {
      const raw = await readFile(args.allowList, "utf8")
      operatorAllowList = parseAllowListFile(raw)
    } catch (err) {
      process.stderr.write(
        `[run-batch-verification] allow-list load failed: ${sanitizeError(err, bearer)}\n`,
      )
      return 2
    }
  }

  const fetchers = buildFetchers(env, bearer)
  const startedAt = new Date()
  const outputPath = args.out ?? defaultOutputPath(startedAt)

  let report: BatchReport
  try {
    report = await runBatchVerification({
      args,
      fetchers,
      bearer,
      baseOrigin: env.baseOrigin,
      allowList: combineAllowLists(operatorAllowList),
      now: () => startedAt,
      onSlugComplete: (slugReport, idx, total) => {
        const tag = slugReport.error
          ? `ERROR(${slugReport.error.side})`
          : slugReport.structural.count +
                slugReport.value.count +
                slugReport.order.count +
                slugReport.semantic.count >
              0
            ? "DIFFS"
            : "ok"
        process.stderr.write(
          `[${idx}/${total}] ${slugReport.slug}@${slugReport.locale} ${tag}\n`,
        )
      },
    })
  } catch (err) {
    // runBatchVerification catches per-slug errors; reaching this catch
    // means a corpus-enumeration or setup-time failure. Emit a minimal
    // report so operators see what we tried before bailing.
    process.stderr.write(
      `[run-batch-verification] corpus enumeration failed: ${sanitizeError(err, bearer)}\n`,
    )
    report = buildReport(startedAt.toISOString(), [])
  }

  await writeReport(outputPath, report)

  process.stdout.write(formatSummary(report) + "\n")
  process.stdout.write(`Report: ${outputPath}\n`)

  return report.gate === "PASSED" ? 0 : 1
}

main()
  .then((code) => {
    process.exit(code)
  })
  .catch((err: unknown) => {
    // Last-resort safety net — sanitization happens inside main() for
    // typed errors; this branch handles unanticipated throws (e.g.,
    // bug in the script wiring). We don't have a known bearer here,
    // so we redact aggressively.
    const msg =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    process.stderr.write(`[run-batch-verification] fatal: ${msg}\n`)
    process.exit(1)
  })
