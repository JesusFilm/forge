import { createHash } from "node:crypto"

import type { SourceCatalog, Video } from "./source-generation"

/** Changing the ranking or its reserves creates a different build input. */
export const CANDIDATE_RETRIEVAL_REVISION = "selected-catalog-lexical-v2"

const LEXICAL_DEPTH = 40
const EXACT_PER_LANE = 12
const METADATA_ONLY_RESERVE = 8
const READ_CONCURRENCY = 4
const STOP_WORDS = new Set(
  "a about after all also an and are as at be been before but by can could do for from had has have he her his how i if in into is it its like may more most not of on one or our out over she so some such than that the their them there these they this those through to was we were what when where which who will with would you your".split(
    " ",
  ),
)

type Counter = Map<string, number>
type Score = Map<number, number>
type VectorIndex = {
  vectors: Array<Map<string, number>>
  postings: Map<string, Array<[number, number]>>
}

class CandidateRetrievalError extends Error {
  readonly code = "input_stale" as const

  constructor(
    readonly reason:
      | "chunk_order_changed"
      | "cursor_stalled"
      | "selected_transcript_incomplete"
      | "duplicate_video",
  ) {
    super("input_stale")
  }
}

function countWords(counter: Counter, text: string, multiplier = 1): void {
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []) {
    if (STOP_WORDS.has(word)) continue
    counter.set(word, (counter.get(word) ?? 0) + multiplier)
  }
}

function exactValues(values: readonly string[]): Set<string> {
  return new Set(
    values.map((value) => value.toLowerCase().trim()).filter(Boolean),
  )
}

function vectors(counters: readonly Counter[]): VectorIndex {
  const documentFrequency = new Map<string, number>()
  for (const counter of counters)
    for (const term of counter.keys())
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
  const postings = new Map<string, Array<[number, number]>>()
  const normalized = counters.map((counter, index) => {
    const weighted = new Map<string, number>()
    let squared = 0
    for (const [term, frequency] of counter) {
      const df = documentFrequency.get(term)!
      if (df > counters.length / 2) continue
      const idf = Math.log(1 + (counters.length - df + 0.5) / (df + 0.5))
      const value = (1 + Math.log(frequency)) * idf
      weighted.set(term, value)
      squared += value * value
    }
    const norm = Math.sqrt(squared)
    for (const [term, value] of weighted) {
      const weight = value / norm
      weighted.set(term, weight)
      const list = postings.get(term) ?? []
      list.push([index, weight])
      postings.set(term, list)
    }
    return weighted
  })
  return { vectors: normalized, postings }
}

function cosine(index: number, input: VectorIndex): Score {
  const scores: Score = new Map()
  for (const [term, sourceWeight] of input.vectors[index])
    for (const [target, weight] of input.postings.get(term) ?? []) {
      if (target === index) continue
      scores.set(target, (scores.get(target) ?? 0) + sourceWeight * weight)
    }
  return scores
}

function reverseValues(sets: readonly Set<string>[]): Map<string, number[]> {
  const reverse = new Map<string, number[]>()
  sets.forEach((values, index) => {
    for (const value of values) {
      const list = reverse.get(value) ?? []
      list.push(index)
      reverse.set(value, list)
    }
  })
  return reverse
}

function exactOverlap(
  index: number,
  values: readonly Set<string>[],
  reverse: Map<string, number[]>,
): Score {
  const intersections: Score = new Map()
  for (const value of values[index])
    for (const target of reverse.get(value) ?? []) {
      if (target === index) continue
      intersections.set(target, (intersections.get(target) ?? 0) + 1)
    }
  return new Map(
    [...intersections].map(([target, count]) => [
      target,
      count / (values[index].size + values[target].size - count),
    ]),
  )
}

function rank(scores: Score, ids: readonly string[], blocked: Set<number>) {
  return [...scores]
    .filter(([target, score]) => !blocked.has(target) && score > 0)
    .sort((a, b) => b[1] - a[1] || (ids[a[0]] < ids[b[0]] ? -1 : 1))
    .map(([target]) => target)
}

function duplicateContent(
  candidate: Video,
  kept: Video,
  directlyRelated: boolean,
): boolean {
  if (
    candidate.coreId &&
    kept.coreId &&
    (candidate.coreId.startsWith(kept.coreId) ||
      kept.coreId.startsWith(candidate.coreId))
  )
    return !(
      candidate.coreId !== kept.coreId &&
      candidate.title &&
      kept.title &&
      candidate.title !== kept.title &&
      directlyRelated
    )
  return Boolean(
    candidate.title && kept.title && candidate.title === kept.title,
  )
}

async function readSelectedChunks(
  catalog: SourceCatalog,
  video: Video,
  cutoff: string,
) {
  const terms: Counter = new Map()
  const hash = createHash("sha256")
  const byTranscript = new Map<string, number>()
  const selected = video.transcriptSelection
    ? new Map(
        video.transcriptSelection.selected.map((item) => [
          item.transcriptId,
          item,
        ]),
      )
    : null
  const indices = new Map<string, Set<number>>()
  let afterChunkId: string | undefined
  let lastChunkId: string | undefined
  let count = 0
  let hasNonEnglish = false
  do {
    const page = await catalog.chunks({
      videoId: video.id,
      cutoff,
      afterChunkId,
    })
    for (const chunk of page.chunks) {
      if (lastChunkId && chunk.id <= lastChunkId)
        throw new CandidateRetrievalError("chunk_order_changed")
      if (selected) {
        const transcript = selected.get(chunk.transcriptId)
        if (
          !transcript ||
          transcript.language !== chunk.language ||
          chunk.chunkIndex < 0 ||
          chunk.chunkIndex >= transcript.totalChunks
        )
          throw new CandidateRetrievalError("selected_transcript_incomplete")
        const seen = indices.get(chunk.transcriptId) ?? new Set<number>()
        if (seen.has(chunk.chunkIndex))
          throw new CandidateRetrievalError("selected_transcript_incomplete")
        seen.add(chunk.chunkIndex)
        indices.set(chunk.transcriptId, seen)
      }
      lastChunkId = chunk.id
      count += 1
      hasNonEnglish ||= chunk.language !== "en"
      byTranscript.set(
        chunk.transcriptId,
        (byTranscript.get(chunk.transcriptId) ?? 0) + 1,
      )
      hash.update(
        JSON.stringify([
          chunk.id,
          chunk.transcriptId,
          chunk.language,
          chunk.chunkIndex,
          chunk.text,
        ]),
      )
      countWords(terms, chunk.text)
    }
    if (page.nextCursor && page.nextCursor === afterChunkId)
      throw new CandidateRetrievalError("cursor_stalled")
    afterChunkId = page.nextCursor ?? undefined
  } while (afterChunkId)
  if (selected) {
    if (
      selected.size !== byTranscript.size ||
      [...selected].some(
        ([id, transcript]) =>
          byTranscript.get(id) !== transcript.totalChunks ||
          indices.get(id)?.size !== transcript.totalChunks,
      )
    )
      throw new CandidateRetrievalError("selected_transcript_incomplete")
  }
  return { terms, chunkDigest: hash.digest("hex"), count, hasNonEnglish }
}

export async function buildCandidateRetrieval(
  catalog: SourceCatalog,
  videos: readonly Video[],
  cutoff: string,
): Promise<{
  selectedCorpusDigest: string
  candidatePoolDigest: string
  candidateIdsBySource: Map<string, string[]>
}> {
  const ordered = [...videos].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
  const ids = ordered.map((video) => video.id)
  const byId = new Map(ids.map((id, index) => [id, index]))
  if (byId.size !== ids.length)
    throw new CandidateRetrievalError("duplicate_video")
  const selectedCorpusHash = createHash("sha256")
  const transcriptCounters: Counter[] = []
  const metadataOnly = new Set<number>()
  const fallback = new Set<number>()
  for (let start = 0; start < ordered.length; start += READ_CONCURRENCY) {
    const batch = ordered.slice(start, start + READ_CONCURRENCY)
    const results = await Promise.all(
      batch.map((video) => readSelectedChunks(catalog, video, cutoff)),
    )
    results.forEach((result, offset) => {
      const index = start + offset
      transcriptCounters[index] = result.terms
      if (!result.count) metadataOnly.add(index)
      if (result.hasNonEnglish) fallback.add(index)
      selectedCorpusHash.update(
        JSON.stringify([
          ordered[index].id,
          ordered[index].transcriptSelection ?? null,
          result.chunkDigest,
        ]),
      )
    })
  }
  const metadataCounters = ordered.map((video) => {
    const counter: Counter = new Map()
    countWords(counter, video.title, 3)
    countWords(counter, video.description)
    return counter
  })
  const metadataIndex = vectors(metadataCounters)
  const transcriptIndex = vectors(transcriptCounters)
  const keywordValues = ordered.map((video) => exactValues(video.keywords))
  const bibleValues = ordered.map((video) => exactValues(video.bibleCitations))
  const keywordReverse = reverseValues(keywordValues)
  const bibleReverse = reverseValues(bibleValues)
  const relations = ordered.map(() => new Set<number>())
  ordered.forEach((video, source) => {
    for (const id of [...video.parentVideoIds, ...video.childVideoIds]) {
      const target = byId.get(id)
      if (target === undefined || target === source) continue
      relations[source].add(target)
      relations[target].add(source)
    }
  })
  const candidateIdsBySource = new Map<string, string[]>()
  const poolHash = createHash("sha256").update(CANDIDATE_RETRIEVAL_REVISION)
  ordered.forEach((video, source) => {
    const blocked = new Set<number>([source])
    ordered.forEach((target, index) => {
      if (
        index !== source &&
        duplicateContent(target, video, relations[source].has(index))
      )
        blocked.add(index)
    })
    const lanes = [
      rank(cosine(source, metadataIndex), ids, blocked),
      rank(cosine(source, transcriptIndex), ids, blocked),
      rank(exactOverlap(source, keywordValues, keywordReverse), ids, blocked),
      rank(exactOverlap(source, bibleValues, bibleReverse), ids, blocked),
      rank(
        new Map([...relations[source]].map((target) => [target, 1])),
        ids,
        blocked,
      ),
    ]
    const fused: Score = new Map()
    for (const lane of lanes)
      lane.forEach((target, rank) =>
        fused.set(target, (fused.get(target) ?? 0) + 1 / (61 + rank)),
      )
    const orderedTargets = rank(fused, ids, blocked)
    for (let target = 0; target < ids.length; target++)
      if (!blocked.has(target) && !fused.has(target))
        orderedTargets.push(target)
    const chosen = new Set(orderedTargets.slice(0, LEXICAL_DEPTH))
    for (const target of relations[source])
      if (!blocked.has(target)) chosen.add(target)
    for (const lane of [lanes[2], lanes[3]])
      for (const target of lane.slice(0, EXACT_PER_LANE)) chosen.add(target)
    let reserved = 0
    for (const target of orderedTargets) {
      if (!metadataOnly.has(target)) continue
      chosen.add(target)
      reserved += 1
      if (reserved >= METADATA_ONLY_RESERVE) break
    }
    for (const target of fallback) if (!blocked.has(target)) chosen.add(target)
    // Canonicalize before model scoring. Protected lanes remain unbounded;
    // lexical depth is only a minimum when duplicate identities are removed.
    const targetRank = new Map(
      orderedTargets.map((target, index) => [target, index]),
    )
    const structuralPriority = (target: number) =>
      relations[source].has(target)
        ? 2
        : [...relations[target]].some((related) => chosen.has(related))
          ? 1
          : 0
    const preferred = orderedTargets
      .filter((target) => chosen.has(target))
      .sort(
        (a, b) =>
          structuralPriority(b) - structuralPriority(a) ||
          targetRank.get(a)! - targetRank.get(b)!,
      )
    const unique = new Set<number>()
    const appendUnique = (target: number) => {
      if (
        [...unique].some((prior) =>
          duplicateContent(
            ordered[target],
            ordered[prior],
            relations[target].has(prior),
          ),
        )
      )
        return
      unique.add(target)
    }
    for (const target of preferred) appendUnique(target)
    for (const target of orderedTargets) {
      if (unique.size >= LEXICAL_DEPTH) break
      appendUnique(target)
    }
    const candidates = orderedTargets
      .filter((target) => unique.has(target))
      .map((target) => ids[target])
    candidateIdsBySource.set(video.id, candidates)
    poolHash.update(JSON.stringify([video.id, candidates]))
  })
  return {
    selectedCorpusDigest: selectedCorpusHash.digest("hex"),
    candidatePoolDigest: poolHash.digest("hex"),
    candidateIdsBySource,
  }
}
