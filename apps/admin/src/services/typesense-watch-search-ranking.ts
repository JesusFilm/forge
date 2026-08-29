export type WatchSearchRankingMode = "TITLE_AND_BRAND" | "SEMANTIC"

export const WATCH_SEARCH_LEGACY_RANKING_IMPLEMENTATION = "legacy-rrf"
/**
 * Application-side ranking identity for the Candidate lane.
 *
 * v2 adds the `container` watchability tier to the rank ladder, which sorts
 * between `target_subtitle` and `related_language`. That changes which member
 * represents a canonical group, so a qualification recorded against v1 no
 * longer describes this behaviour. Bumping the identity forces requalification
 * while leaving the physical collections — whose field manifest is unchanged —
 * valid; the separate application revision is deliberately NOT bumped.
 */
export const WATCH_SEARCH_TITLE_AND_BRAND_RANKING_IMPLEMENTATION =
  "title-and-brand-v2"

export type WatchSearchRankingImplementation =
  | typeof WATCH_SEARCH_LEGACY_RANKING_IMPLEMENTATION
  | typeof WATCH_SEARCH_TITLE_AND_BRAND_RANKING_IMPLEMENTATION

export type WatchSearchRankingLaneEvidence = {
  rank: number
  contribution: number
}

export type WatchSearchRankingGroup = {
  canonicalVideoId: string
  fusedScore: number
  wholeTitleMatch: boolean
  titleValues: readonly string[]
  metadataValues: readonly string[]
  laneEvidence: {
    title: WatchSearchRankingLaneEvidence | null
    metadata: WatchSearchRankingLaneEvidence | null
    semantic: WatchSearchRankingLaneEvidence | null
  }
}

export type WatchSearchTitleNormalization = {
  normalized: string
  compact: string
  core: string
  compactCore: string
  coreTokens: readonly string[]
}

export type WatchSearchRankingEvidenceTier =
  | "NORMALIZED_WHOLE_TITLE"
  | "UNIQUE_TITLE_CORE"
  | "ANCHOR_TITLE"
  | "ANCHOR_METADATA"
  | "SEMANTIC_FILL"

export type WatchSearchRankingAnchor = {
  normalized: string
  core: string
  compactCore: string
  coreTokens: readonly string[]
  sourceCanonicalVideoId: string
  matchKind: "NORMALIZED_WHOLE_TITLE" | "TITLE_CORE"
}

export type RankedWatchSearchGroup<TGroup extends WatchSearchRankingGroup> = {
  group: TGroup
  evidenceTier: WatchSearchRankingEvidenceTier
}

const LEADING_ARTICLES = new Set(["a", "an", "the"])
const TRAILING_CONTENT_WORDS = new Set([
  "collection",
  "collections",
  "series",
  "video",
  "videos",
])
const DIRECT_NEGATIVE_METADATA_WORDS = new Set([
  "excluding",
  "unaffiliated",
  "unlike",
  "versus",
])
const COMPARISON_METADATA_WORDS = new Set([
  "alongside",
  "and",
  "featuring",
  "or",
  "versus",
  "vs",
  "with",
])
const MAX_TITLE_BRAND_PROMOTION_LANE_RANK = 100

const EVIDENCE_TIER_RANK: Readonly<
  Record<WatchSearchRankingEvidenceTier, number>
> = {
  NORMALIZED_WHOLE_TITLE: 0,
  UNIQUE_TITLE_CORE: 1,
  ANCHOR_TITLE: 2,
  ANCHOR_METADATA: 3,
  SEMANTIC_FILL: 4,
}

const RELATIONSHIP_METADATA_WORDS = new Set([
  "affiliate",
  "affiliated",
  "affiliation",
  "associate",
  "associated",
  "association",
  "connect",
  "connected",
  "connection",
  "official",
  "relate",
  "related",
  "relationship",
])

function normalizedTokens(value: string, locale = "en"): string[] {
  return value
    .normalize("NFKC")
    .replace(/([\p{Ll}\p{Nd}])(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/[\p{P}\p{S}_]+/gu, " ")
    .toLocaleLowerCase(locale)
    .replace(/\u0307/gu, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function displayTokens(value: string): string[] {
  return value
    .normalize("NFKC")
    .replace(/([\p{Ll}\p{Nd}])(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/[\p{P}\p{S}_]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

export function normalizeWatchSearchTitle(
  value: string,
  locale = "en",
): WatchSearchTitleNormalization {
  const tokens = normalizedTokens(value, locale)
  const coreTokens = [...tokens]
  if (LEADING_ARTICLES.has(coreTokens[0] ?? "")) coreTokens.shift()
  while (TRAILING_CONTENT_WORDS.has(coreTokens.at(-1) ?? "")) {
    coreTokens.pop()
  }

  return {
    normalized: tokens.join(" "),
    compact: tokens.join(""),
    core: coreTokens.join(" "),
    compactCore: coreTokens.join(""),
    coreTokens,
  }
}

function containsTokenSequence(
  values: readonly string[],
  sequence: readonly string[],
): number {
  if (sequence.length === 0 || sequence.length > values.length) return -1
  for (let index = 0; index <= values.length - sequence.length; index += 1) {
    if (sequence.every((token, offset) => values[index + offset] === token)) {
      return index
    }
  }
  return -1
}

function titleEvidenceTier(
  query: WatchSearchTitleNormalization,
  anchor: WatchSearchRankingAnchor,
  normalizedTitles: readonly WatchSearchTitleNormalization[],
): WatchSearchRankingEvidenceTier | null {
  if (
    normalizedTitles.some(
      (title) =>
        title.normalized === query.normalized ||
        (title.compact === query.compact &&
          title.compactCore === query.compactCore),
    )
  ) {
    return "NORMALIZED_WHOLE_TITLE"
  }
  if (
    normalizedTitles.some(
      (title) =>
        title.compactCore.length > 0 &&
        title.compactCore === anchor.compactCore,
    )
  ) {
    return "UNIQUE_TITLE_CORE"
  }
  if (
    normalizedTitles.some(
      (title) =>
        containsTokenSequence(title.coreTokens, anchor.coreTokens) >= 0,
    )
  ) {
    return "ANCHOR_TITLE"
  }
  return null
}

function hasNegativeOrMultiBrandContext(
  originalValue: string,
  tokens: readonly string[],
  anchorStart: number,
  anchorLength: number,
): boolean {
  const prefix = tokens.slice(Math.max(0, anchorStart - 8), anchorStart)
  const suffixStart = anchorStart + anchorLength
  const suffix = tokens.slice(suffixStart, suffixStart + 8)
  const hasRelationalNegation = (context: readonly string[]) =>
    context.some(
      (token, negationIndex) =>
        (token === "no" || token === "not" || token === "without") &&
        context
          .slice(negationIndex + 1, negationIndex + 6)
          .some((candidate) => RELATIONSHIP_METADATA_WORDS.has(candidate)),
    )
  const hasExplicitUnrelatedRelationship =
    prefix.at(-1) === "unrelated" ||
    (prefix.at(-2) === "unrelated" && prefix.at(-1) === "to") ||
    (suffix[0] === "is" && suffix[1] === "unrelated") ||
    suffix[0] === "unrelated"
  if (
    prefix.some((token) => DIRECT_NEGATIVE_METADATA_WORDS.has(token)) ||
    suffix.some((token) => DIRECT_NEGATIVE_METADATA_WORDS.has(token)) ||
    hasRelationalNegation(prefix) ||
    hasRelationalNegation(suffix) ||
    hasExplicitUnrelatedRelationship
  ) {
    return true
  }

  const originalTokens = displayTokens(originalValue)
  const hasBrandShapedContext = (rawContext: readonly string[]) => {
    const beginsWithArticle = LEADING_ARTICLES.has(
      rawContext[0]?.toLocaleLowerCase("en") ?? "",
    )
    const context = rawContext.filter(
      (value) => !LEADING_ARTICLES.has(value.toLocaleLowerCase("en")),
    )
    const first = context[0] ?? ""
    const second = context[1] ?? ""
    const isAcronym =
      /\p{L}/u.test(first) &&
      first.length > 1 &&
      first === first.toLocaleUpperCase("en") &&
      first !== first.toLocaleLowerCase("en")
    const isTitleCase = (value: string) =>
      /^\p{Lu}[\p{L}\p{N}'’-]*$/u.test(value)
    return (
      isAcronym ||
      (isTitleCase(first) && (beginsWithArticle || isTitleCase(second)))
    )
  }
  const hasFollowingBrand = suffix.some((token, suffixIndex) => {
    if (!COMPARISON_METADATA_WORDS.has(token)) return false
    const cueIndex = suffixStart + suffixIndex
    return hasBrandShapedContext(
      originalTokens.slice(cueIndex + 1, cueIndex + 4),
    )
  })
  const prefixStart = anchorStart - prefix.length
  const hasPrecedingBrand = prefix.some((token, prefixIndex) => {
    if (!COMPARISON_METADATA_WORDS.has(token)) return false
    const cueIndex = prefixStart + prefixIndex
    return hasBrandShapedContext(
      originalTokens.slice(Math.max(0, cueIndex - 3), cueIndex),
    )
  })
  return hasFollowingBrand || hasPrecedingBrand
}

function hasPreciseAnchorMetadata(
  values: readonly string[],
  anchor: WatchSearchRankingAnchor,
  locale: string,
): boolean {
  if (anchor.coreTokens.length < 2) return false
  return values.some((value) => {
    const tokens = normalizedTokens(value, locale)
    const anchorStart = containsTokenSequence(tokens, anchor.coreTokens)
    return (
      anchorStart >= 0 &&
      !hasNegativeOrMultiBrandContext(
        value,
        tokens,
        anchorStart,
        anchor.coreTokens.length,
      )
    )
  })
}

type AnchorCandidate = {
  group: WatchSearchRankingGroup
  title: WatchSearchTitleNormalization
  matchKind: WatchSearchRankingAnchor["matchKind"]
  priority: number
}

type PreparedRankingGroup<TGroup extends WatchSearchRankingGroup> = {
  group: TGroup
  normalizedTitles: readonly WatchSearchTitleNormalization[]
}

function compareAnchorCandidates(
  left: AnchorCandidate,
  right: AnchorCandidate,
): number {
  if (left.priority !== right.priority) return left.priority - right.priority
  const rankDelta =
    (left.group.laneEvidence.title?.rank ?? Number.MAX_SAFE_INTEGER) -
    (right.group.laneEvidence.title?.rank ?? Number.MAX_SAFE_INTEGER)
  if (rankDelta !== 0) return rankDelta
  return left.group.canonicalVideoId.localeCompare(right.group.canonicalVideoId)
}

function selectRankingAnchor<TGroup extends WatchSearchRankingGroup>(
  query: WatchSearchTitleNormalization,
  groups: readonly PreparedRankingGroup<TGroup>[],
): WatchSearchRankingAnchor | null {
  if (query.coreTokens.length === 0) return null
  let selected: AnchorCandidate | null = null
  const titleCoreCanonicalIds = new Set<string>()

  for (const { group, normalizedTitles } of groups) {
    if (
      !group.laneEvidence.title ||
      group.laneEvidence.title.rank > MAX_TITLE_BRAND_PROMOTION_LANE_RANK
    ) {
      continue
    }
    for (const title of normalizedTitles) {
      const wholeTitle =
        title.normalized === query.normalized ||
        (title.compact === query.compact &&
          title.compactCore === query.compactCore)
      const candidate = wholeTitle
        ? {
            group,
            title,
            matchKind: "NORMALIZED_WHOLE_TITLE" as const,
            priority: 0,
          }
        : query.compactCore.length > 0 &&
            title.compactCore === query.compactCore &&
            title.coreTokens.length > 1
          ? {
              group,
              title,
              matchKind: "TITLE_CORE" as const,
              priority: 1,
            }
          : null
      if (!candidate) continue
      if (candidate.matchKind === "TITLE_CORE") {
        titleCoreCanonicalIds.add(group.canonicalVideoId)
      }
      if (!selected || compareAnchorCandidates(candidate, selected) < 0) {
        selected = candidate
      }
    }
  }

  if (!selected) return null
  if (selected.matchKind === "TITLE_CORE" && titleCoreCanonicalIds.size > 1) {
    return null
  }

  return {
    normalized: query.normalized,
    core: selected.title.core,
    compactCore: selected.title.compactCore,
    coreTokens: selected.title.coreTokens,
    sourceCanonicalVideoId: selected.group.canonicalVideoId,
    matchKind: selected.matchKind,
  }
}

export function compareSemanticRankingGroups<
  TGroup extends WatchSearchRankingGroup,
>(left: TGroup, right: TGroup): number {
  const wholeTitleDelta =
    Number(right.wholeTitleMatch) - Number(left.wholeTitleMatch)
  if (wholeTitleDelta !== 0) return wholeTitleDelta
  const fusedScoreDelta = right.fusedScore - left.fusedScore
  if (fusedScoreDelta !== 0) return fusedScoreDelta
  return left.canonicalVideoId.localeCompare(right.canonicalVideoId)
}

function evidenceTierForGroup(
  query: WatchSearchTitleNormalization,
  anchor: WatchSearchRankingAnchor,
  group: WatchSearchRankingGroup,
  normalizedTitles: readonly WatchSearchTitleNormalization[],
  locale: string,
): WatchSearchRankingEvidenceTier {
  const titleTier =
    group.laneEvidence.title != null &&
    group.laneEvidence.title.rank <= MAX_TITLE_BRAND_PROMOTION_LANE_RANK
      ? titleEvidenceTier(query, anchor, normalizedTitles)
      : null
  if (titleTier) return titleTier
  if (hasPreciseAnchorMetadata(group.metadataValues, anchor, locale)) {
    if (
      group.laneEvidence.metadata == null ||
      group.laneEvidence.metadata.rank > MAX_TITLE_BRAND_PROMOTION_LANE_RANK
    ) {
      return "SEMANTIC_FILL"
    }
    return "ANCHOR_METADATA"
  }
  return "SEMANTIC_FILL"
}

export function classifyWatchSearchGroups<
  TGroup extends WatchSearchRankingGroup,
>(
  queryValue: string,
  groups: readonly TGroup[],
  locale = "en",
): {
  mode: WatchSearchRankingMode
  anchor: WatchSearchRankingAnchor | null
  groups: Array<RankedWatchSearchGroup<TGroup>>
} {
  const query = normalizeWatchSearchTitle(queryValue, locale)
  const preparedGroups = groups.map((group) => ({
    group,
    normalizedTitles: group.titleValues.map((title) =>
      normalizeWatchSearchTitle(title, locale),
    ),
  }))
  const anchor = selectRankingAnchor(query, preparedGroups)
  if (!anchor) {
    return {
      mode: "SEMANTIC",
      anchor: null,
      groups: groups.map((group) => ({
        group,
        evidenceTier: "SEMANTIC_FILL",
      })),
    }
  }

  return {
    mode: "TITLE_AND_BRAND",
    anchor,
    groups: preparedGroups.map(({ group, normalizedTitles }) => ({
      group,
      evidenceTier: evidenceTierForGroup(
        query,
        anchor,
        group,
        normalizedTitles,
        locale,
      ),
    })),
  }
}

export function rankWatchSearchGroups<TGroup extends WatchSearchRankingGroup>(
  queryValue: string,
  groups: readonly TGroup[],
  locale = "en",
): {
  mode: WatchSearchRankingMode
  anchor: WatchSearchRankingAnchor | null
  groups: Array<RankedWatchSearchGroup<TGroup>>
} {
  const classified = classifyWatchSearchGroups(queryValue, groups, locale)
  return {
    ...classified,
    groups: [...classified.groups].sort((left, right) => {
      if (classified.mode === "TITLE_AND_BRAND") {
        const tierDelta =
          EVIDENCE_TIER_RANK[left.evidenceTier] -
          EVIDENCE_TIER_RANK[right.evidenceTier]
        if (tierDelta !== 0) return tierDelta
      }
      return compareSemanticRankingGroups(left.group, right.group)
    }),
  }
}
