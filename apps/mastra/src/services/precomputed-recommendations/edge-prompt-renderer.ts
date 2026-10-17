import { isDeepStrictEqual } from "node:util"

export class EdgePromptRenderError extends Error {
  constructor(
    readonly code:
      | "edge_prompt_not_lossless"
      | "edge_prompt_encoding_invalid"
      | "edge_prompt_fact_missing"
      | "edge_prompt_passage_missing",
  ) {
    super(code)
    this.name = "EdgePromptRenderError"
  }
}

/** A lossless wire encoding of the existing shared-edge-v1 model document. */
export type EdgePromptDocument = {
  members: Array<{
    source: { metadata: { videoId: string }; profile: unknown }
    candidates: Array<{
      poolRank: number
      metadata: { videoId: string }
      profile: unknown
    }>
    historical: null | {
      definitions: unknown
      sourceEngagement: unknown
      candidates: unknown[]
    }
  }>
  spanOffers: Array<{
    spanId: string
    sourceVideoId: string
    targetVideoId: string
    videoId: string
    chunkId: string
    startChar: number
    endChar: number
    textSha256: string
    excerpt: string
    language: string
  }>
  spanOfferCoverage: Array<{
    sourceVideoId: string
    targetVideoId: string
    policy: string
    sourceAvailable: number
    targetAvailable: number
    offered: number
  }>
}

type Passage = Pick<
  EdgePromptDocument["spanOffers"][number],
  | "videoId"
  | "chunkId"
  | "startChar"
  | "endChar"
  | "textSha256"
  | "excerpt"
  | "language"
>

type CompactPrompt = {
  encoding: "shared-edge-v1-dictionary-1"
  readingGuide: string
  videoFacts: Array<{ metadata: { videoId: string }; profile: unknown }>
  historicalDefinitions: unknown[]
  members: Array<{
    sourceFact: number
    candidates: Array<{ poolRank: number; fact: number }>
    historical: null | {
      definitionIndex: number
      sourceEngagement: unknown
      candidates: unknown[]
    }
  }>
  passages: Passage[]
  spanOfferGroups: Array<{
    sourceVideoId: string
    targetVideoId: string
    offers: Array<[spanId: string, passageIndex: number]>
  }>
  spanOfferCoverage: EdgePromptDocument["spanOfferCoverage"]
}

const READING_GUIDE =
  "Each member's sourceFact and candidate fact index resolves in videoFacts; each fact contains the complete metadata and profile. Each historical definitionIndex resolves in historicalDefinitions. Each spanOfferGroup is one source/target pair; each [spanId,passageIndex] offers that span ID only for that pair, and passageIndex resolves the complete passage in passages. Select transcript evidence only from IDs offered for the chosen source/target pair."

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8")
}

/** Pure report; real saved fixtures can be passed in without reserving a call. */
export function renderEdgePrompt(input: EdgePromptDocument): {
  prompt: string
  legacyPrompt: string
  byteReport: {
    legacyBytes: number
    compactBytes: number
    savedBytes: number
    offerCount: number
    uniquePassageCount: number
  }
} {
  const legacy = JSON.stringify(input)
  const facts: CompactPrompt["videoFacts"] = []
  const factIndex = new Map<string, number>()
  const definitions: unknown[] = []
  const definitionIndex = new Map<string, number>()
  const indexOf = <T>(value: T, values: T[], indexes: Map<string, number>) => {
    const key = JSON.stringify(value)
    const prior = indexes.get(key)
    if (prior !== undefined) return prior
    const index = values.length
    values.push(value)
    indexes.set(key, index)
    return index
  }
  const members: CompactPrompt["members"] = input.members.map((member) => ({
    sourceFact: indexOf(member.source, facts, factIndex),
    candidates: member.candidates.map((candidate) => ({
      poolRank: candidate.poolRank,
      fact: indexOf(
        { metadata: candidate.metadata, profile: candidate.profile },
        facts,
        factIndex,
      ),
    })),
    historical: member.historical && {
      definitionIndex: indexOf(
        member.historical.definitions,
        definitions,
        definitionIndex,
      ),
      sourceEngagement: member.historical.sourceEngagement,
      candidates: member.historical.candidates,
    },
  }))
  const passages: Passage[] = []
  const passageIndex = new Map<string, number>()
  const groups: CompactPrompt["spanOfferGroups"] = []
  for (const {
    spanId,
    sourceVideoId,
    targetVideoId,
    ...passage
  } of input.spanOffers) {
    let group = groups.at(-1)
    if (
      !group ||
      group.sourceVideoId !== sourceVideoId ||
      group.targetVideoId !== targetVideoId
    ) {
      group = { sourceVideoId, targetVideoId, offers: [] }
      groups.push(group)
    }
    group.offers.push([spanId, indexOf(passage, passages, passageIndex)])
  }
  const compact: CompactPrompt = {
    encoding: "shared-edge-v1-dictionary-1",
    readingGuide: READING_GUIDE,
    videoFacts: facts,
    historicalDefinitions: definitions,
    members,
    passages,
    spanOfferGroups: groups,
    spanOfferCoverage: input.spanOfferCoverage,
  }
  // A future semantic field must fail closed until this encoding carries it.
  if (!isDeepStrictEqual(decodeEdgePrompt(compact), JSON.parse(legacy)))
    throw new EdgePromptRenderError("edge_prompt_not_lossless")
  const prompt = JSON.stringify(compact)
  const legacyBytes = utf8Bytes(legacy)
  const compactBytes = utf8Bytes(prompt)
  return {
    prompt,
    legacyPrompt: legacy,
    byteReport: {
      legacyBytes,
      compactBytes,
      savedBytes: legacyBytes - compactBytes,
      offerCount: input.spanOffers.length,
      uniquePassageCount: passages.length,
    },
  }
}

/** Reconstructs the original document for offline fixture and compatibility checks. */
export function decodeEdgePrompt(
  value: EdgePromptDocument | CompactPrompt,
): EdgePromptDocument {
  if (!("encoding" in value)) return value
  if (value.encoding !== "shared-edge-v1-dictionary-1")
    throw new EdgePromptRenderError("edge_prompt_encoding_invalid")
  return {
    members: value.members.map((member) => {
      const source = value.videoFacts[member.sourceFact]
      if (!source) throw new EdgePromptRenderError("edge_prompt_fact_missing")
      return {
        source,
        candidates: member.candidates.map((candidate) => {
          const fact = value.videoFacts[candidate.fact]
          if (!fact) throw new EdgePromptRenderError("edge_prompt_fact_missing")
          return { poolRank: candidate.poolRank, ...fact }
        }),
        historical: member.historical && {
          definitions:
            value.historicalDefinitions[member.historical.definitionIndex],
          sourceEngagement: member.historical.sourceEngagement,
          candidates: member.historical.candidates,
        },
      }
    }),
    spanOffers: value.spanOfferGroups.flatMap((group) =>
      group.offers.map(([spanId, passageIndex]) => {
        const passage = value.passages[passageIndex]
        if (!passage)
          throw new EdgePromptRenderError("edge_prompt_passage_missing")
        return {
          spanId,
          sourceVideoId: group.sourceVideoId,
          targetVideoId: group.targetVideoId,
          ...passage,
        }
      }),
    ),
    spanOfferCoverage: value.spanOfferCoverage,
  }
}
