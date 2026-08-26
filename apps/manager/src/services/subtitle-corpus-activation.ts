import {
  corpusActivationInputSchema,
  SHA256,
  sha256Bytes,
  SUBTITLE_EVAL_LOCK_DIGEST,
  SUBTITLE_EVAL_MANIFEST_DIGEST,
  subtitleEvalLockSchema,
  subtitleEvalManifestSchema,
  languageIdentitySchema,
} from "@/features/subtitle-lab/subtitle-lab-contract"
import {
  type SubtitleEvalArtifactBackend,
  writeImmutableSubtitleEvalArtifact,
} from "@/services/subtitle-eval-artifacts"
import type { z } from "zod"

const MAX_CORE_VTT_BYTES = 512 * 1024

type LanguageIdentity = z.infer<typeof languageIdentitySchema>

export type ActivatedCorpusCell = {
  caseId: string
  collectionKey: string
  videoId: string
  editionIdentity: string
  sourceLanguageId: string
  sourceLanguageSlug: string
  sourceTrackIdentity: string
  targetLanguageId: string
  targetLanguageSlug: string
  referenceTrackIdentity: string
  sourceSnapshot: SnapshotImport
  referenceSnapshot: SnapshotImport
  metadata: Record<string, unknown>
}

type SnapshotImport = {
  sha256: string
  rawSha256: string
  clippedSha256: string
  objectKey: string
  byteLength: string
}

export type ActivatedSubtitleCorpus = {
  manifestDigest: string
  lockDigest: string
  authority: string
  certification: Record<string, never>
  supersedesVersionId?: string
  cells: ActivatedCorpusCell[]
}

export type SubtitleCorpusActivationOptions = {
  fetchImpl?: typeof fetch
  artifactBackend?: SubtitleEvalArtifactBackend
  expectedManifestDigest?: string
  expectedLockDigest?: string
  allowedCoreHosts?: readonly string[]
}

export async function activateSubtitleEvalCorpus(
  rawInput: unknown,
  options: SubtitleCorpusActivationOptions = {},
): Promise<ActivatedSubtitleCorpus> {
  const input = corpusActivationInputSchema.parse(rawInput)
  const expectedManifestDigest =
    options.expectedManifestDigest ?? SUBTITLE_EVAL_MANIFEST_DIGEST
  const expectedLockDigest =
    options.expectedLockDigest ?? SUBTITLE_EVAL_LOCK_DIGEST
  if (
    sha256Bytes(input.manifestJson) !== expectedManifestDigest ||
    sha256Bytes(input.lockJson) !== expectedLockDigest
  ) {
    throw new Error("Packaged subtitle corpus identity did not match.")
  }
  const manifest = subtitleEvalManifestSchema.parse(
    JSON.parse(input.manifestJson),
  )
  const lock = subtitleEvalLockSchema
    .extend({ manifestSha256: SHA256 })
    .parse(JSON.parse(input.lockJson))
  if (lock.manifestSha256 !== expectedManifestDigest) {
    throw new Error("Subtitle corpus lock did not bind the packaged manifest.")
  }
  assertLockedTrackCoverage(manifest, lock)
  assertUniqueLanguageMappings(input.languageIdentities, manifest.languages)
  const languageByBcp47 = new Map(
    input.languageIdentities.map((identity) => [identity.bcp47, identity]),
  )
  for (const language of manifest.languages) {
    const mapped = languageByBcp47.get(language.bcp47)
    if (!mapped || mapped.coreLanguageId !== language.coreLanguageId) {
      throw new Error("Exact Admin language mapping is missing.")
    }
  }

  const fetched = new Map<string, Promise<DownloadedTrack>>()
  const fetchTrack = (track: (typeof lock.tracks)[number], clip: Clip) => {
    const key = `${track.subtitleId}:${track.sourceSha256}:${track.clippedSha256}`
    let promise = fetched.get(key)
    if (!promise) {
      promise = downloadAndFreezeTrack(track, clip, options)
      fetched.set(key, promise)
    }
    return promise
  }

  const cells: ActivatedCorpusCell[] = []
  for (const benchmarkCase of manifest.cases) {
    const caseTracks = lock.tracks.filter(
      (track) => track.caseId === benchmarkCase.id,
    )
    const sourceTracks = caseTracks.filter(
      (track) =>
        track.role === "source" && track.language === manifest.sourceLanguage,
    )
    if (sourceTracks.length !== 1) {
      throw new Error("Every corpus case must have exactly one source track.")
    }
    const sourceTrack = sourceTracks[0]!
    const source = await fetchTrack(sourceTrack, benchmarkCase.clip)
    const sourceLanguage = languageByBcp47.get(sourceTrack.language)!
    for (const targetLanguage of manifest.targetLanguages) {
      const references = caseTracks.filter(
        (track) =>
          track.role === "reference" && track.language === targetLanguage,
      )
      if (references.length !== 1) {
        throw new Error("Every corpus case-language must have one reference.")
      }
      const referenceTrack = references[0]!
      const reference = await fetchTrack(referenceTrack, benchmarkCase.clip)
      const target = languageByBcp47.get(targetLanguage)!
      cells.push({
        caseId: benchmarkCase.id,
        collectionKey: benchmarkCase.collection,
        videoId: benchmarkCase.videoId,
        editionIdentity: benchmarkCase.coreVideoEditionId,
        sourceLanguageId: sourceLanguage.languageId,
        sourceLanguageSlug: sourceLanguage.languageSlug,
        sourceTrackIdentity: sourceTrack.subtitleId,
        targetLanguageId: target.languageId,
        targetLanguageSlug: target.languageSlug,
        referenceTrackIdentity: referenceTrack.subtitleId,
        sourceSnapshot: source.snapshot,
        referenceSnapshot: reference.snapshot,
        metadata: {
          schemaVersion: "subtitle-eval-corpus-cell/v1",
          targetBcp47: targetLanguage,
          sourceBcp47: manifest.sourceLanguage,
          case: benchmarkCase,
          sourceTrack: publicTrackIdentity(sourceTrack),
          referenceTrack: publicTrackIdentity(referenceTrack),
          sourceByteLength: Number(source.snapshot.byteLength),
          referenceByteLength: Number(reference.snapshot.byteLength),
        },
      })
    }
  }
  if (cells.length > 20) throw new Error("Packaged corpus exceeds V1 ceiling.")
  return {
    manifestDigest: expectedManifestDigest,
    lockDigest: expectedLockDigest,
    authority: manifest.referenceAuthority,
    certification: {},
    ...(input.supersedesVersionId
      ? { supersedesVersionId: input.supersedesVersionId }
      : {}),
    cells,
  }
}

type Clip = { startSeconds: number; endSeconds: number }
type DownloadedTrack = { snapshot: SnapshotImport }

async function downloadAndFreezeTrack(
  track: {
    role: "source" | "reference"
    sourceUrl: string
    sourceSha256: string
    clippedSha256: string
    cueCount: number
  },
  clip: Clip,
  options: SubtitleCorpusActivationOptions,
): Promise<DownloadedTrack> {
  assertAllowedCoreUrl(track.sourceUrl, options.allowedCoreHosts)
  const response = await (options.fetchImpl ?? fetch)(track.sourceUrl, {
    signal: AbortSignal.timeout(30_000),
    redirect: "manual",
  })
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error("Core subtitle snapshot redirect was rejected.")
  }
  if (!response.ok) throw new Error("Core subtitle snapshot download failed.")
  assertAllowedCoreUrl(
    response.url || track.sourceUrl,
    options.allowedCoreHosts,
  )
  const rawBytes = await readBoundedResponse(response, MAX_CORE_VTT_BYTES)
  if (sha256Bytes(rawBytes) !== track.sourceSha256) {
    throw new Error("Core subtitle snapshot digest drifted.")
  }
  const clippedVtt = serializeVtt(
    cropVtt(parseVtt(new TextDecoder().decode(rawBytes)), clip),
  )
  if (sha256Bytes(clippedVtt) !== track.clippedSha256) {
    throw new Error("Core subtitle clipped digest drifted.")
  }
  const cues = parseVtt(clippedVtt)
  if (cues.length !== track.cueCount) {
    throw new Error("Core subtitle cue identity drifted.")
  }
  const artifact = await writeImmutableSubtitleEvalArtifact(
    {
      kind: track.role,
      body: clippedVtt,
      mediaType: "text/vtt",
      expectedSha256: track.clippedSha256,
    },
    options.artifactBackend,
  )
  return {
    snapshot: {
      sha256: artifact.sha256,
      rawSha256: track.sourceSha256,
      clippedSha256: track.clippedSha256,
      objectKey: artifact.objectKey,
      byteLength: String(artifact.byteLength),
    },
  }
}

export async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
) {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error("Core subtitle snapshot exceeded the byte ceiling.")
  }
  if (!response.body) throw new Error("Core subtitle snapshot body is empty.")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    byteLength += value.byteLength
    if (byteLength > maximumBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error("Core subtitle snapshot exceeded the byte ceiling.")
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export function assertAllowedCoreUrl(
  rawUrl: string,
  allowedHosts: readonly string[] = ["api-media-core.jesusfilm.org"],
) {
  const url = new URL(rawUrl)
  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== "" ||
    !allowedHosts.includes(url.hostname)
  ) {
    throw new Error("Locked Core subtitle URL is not allowed.")
  }
}

type Cue = { start: number; end: number; text: string }

function parseVtt(value: string): Cue[] {
  const normalized = value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
  const lines = normalized.split("\n")
  if (lines[0]?.trim().split(/\s+/)[0] !== "WEBVTT") {
    throw new Error("Core subtitle is not VTT.")
  }
  const cues: Cue[] = []
  let index = 1
  while (index < lines.length) {
    while (index < lines.length && !lines[index]!.trim()) index++
    if (index >= lines.length) break
    let timing = lines[index]!.trim()
    if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(timing)) {
      while (index < lines.length && lines[index]!.trim()) index++
      continue
    }
    if (!timing.includes("-->")) timing = lines[++index]?.trim() ?? ""
    const match = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(timing)
    if (!match) throw new Error("Core subtitle timing is invalid.")
    index++
    const text: string[] = []
    while (index < lines.length && lines[index]!.trim())
      text.push(lines[index++]!)
    const cleaned = text
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&nbsp;", " ")
      .replaceAll("&lrm;", "")
      .replaceAll("&rlm;", "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n")
    if (cleaned)
      cues.push({
        start: timestamp(match[1]!),
        end: timestamp(match[2]!),
        text: cleaned,
      })
  }
  return cues
}

function cropVtt(cues: Cue[], clip: Clip) {
  return cues
    .filter((cue) => cue.end > clip.startSeconds && cue.start < clip.endSeconds)
    .map((cue) => ({
      ...cue,
      start: Math.max(cue.start, clip.startSeconds),
      end: Math.min(cue.end, clip.endSeconds),
    }))
    .filter((cue) => cue.end > cue.start)
}

function serializeVtt(cues: Cue[]) {
  return `WEBVTT\n\n${cues
    .map(
      (cue) =>
        `${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${cue.text}`,
    )
    .join("\n\n")}\n`
}

function timestamp(value: string) {
  const parts = value.replace(",", ".").split(":").map(Number)
  if (parts.length !== 2 && parts.length !== 3)
    throw new Error("Invalid VTT timestamp.")
  const [hours, minutes, seconds] =
    parts.length === 3 ? parts : [0, parts[0]!, parts[1]!]
  if (![hours, minutes, seconds].every(Number.isFinite))
    throw new Error("Invalid VTT timestamp.")
  return hours! * 3_600 + minutes! * 60 + seconds!
}

function formatTimestamp(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1_000))
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1_000)
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds % 1_000).padStart(3, "0")}`
}

function publicTrackIdentity(track: {
  role: string
  language: string
  coreLanguageId: string
  subtitleId: string
  videoId: string
  edition: string
  coreVideoEditionId: string
  cueCount: number
}) {
  return {
    role: track.role,
    language: track.language,
    coreLanguageId: track.coreLanguageId,
    subtitleId: track.subtitleId,
    videoId: track.videoId,
    edition: track.edition,
    coreVideoEditionId: track.coreVideoEditionId,
    cueCount: track.cueCount,
  }
}

export function assertUniqueLanguageMappings(
  values: LanguageIdentity[],
  manifestLanguages: ReadonlyArray<{ bcp47: string; coreLanguageId: string }>,
) {
  if (values.length !== manifestLanguages.length) {
    throw new Error("Language mappings must exactly cover the manifest.")
  }
  const uniqueFields: Array<keyof LanguageIdentity> = [
    "bcp47",
    "coreLanguageId",
    "languageId",
    "languageSlug",
  ]
  for (const field of uniqueFields) {
    const seen = new Set<string>()
    for (const value of values) {
      if (seen.has(value[field])) {
        throw new Error("Language mappings must be unique.")
      }
      seen.add(value[field])
    }
  }
  const mappingByBcp47 = new Map(values.map((value) => [value.bcp47, value]))
  const covered = new Set<string>()
  for (const language of manifestLanguages) {
    const mapping = mappingByBcp47.get(language.bcp47)
    if (!mapping || mapping.coreLanguageId !== language.coreLanguageId) {
      throw new Error("Language mappings must exactly cover the manifest.")
    }
    covered.add(language.bcp47)
  }
  if (covered.size !== values.length) {
    throw new Error("Language mappings must exactly cover the manifest.")
  }
}

export function assertLockedTrackCoverage(
  manifest: z.infer<typeof subtitleEvalManifestSchema>,
  lock: { tracks: z.infer<typeof subtitleEvalLockSchema>["tracks"] },
) {
  const cases = new Map(manifest.cases.map((item) => [item.id, item]))
  const languages = new Map(
    manifest.languages.map((language) => [language.bcp47, language]),
  )
  const expected = new Set<string>()
  for (const item of manifest.cases) {
    expected.add(`${item.id}\u0000source\u0000${manifest.sourceLanguage}`)
    for (const language of manifest.targetLanguages) {
      expected.add(`${item.id}\u0000reference\u0000${language}`)
    }
  }
  if (lock.tracks.length !== expected.size) {
    throw new Error(
      "Locked subtitle tracks did not exactly cover the manifest.",
    )
  }
  const seen = new Set<string>()
  const subtitleIds = new Set<string>()
  for (const track of lock.tracks) {
    const item = cases.get(track.caseId)
    const language = languages.get(track.language)
    const identity = `${track.caseId}\u0000${track.role}\u0000${track.language}`
    if (
      !item ||
      !language ||
      !expected.has(identity) ||
      seen.has(identity) ||
      subtitleIds.has(track.subtitleId) ||
      track.coreLanguageId !== language.coreLanguageId ||
      track.videoId !== item.videoId ||
      track.edition !== item.edition ||
      track.coreVideoEditionId !== item.coreVideoEditionId ||
      track.primary !== (track.role === "source")
    ) {
      throw new Error(
        "Locked subtitle track identity did not match the manifest.",
      )
    }
    seen.add(identity)
    subtitleIds.add(track.subtitleId)
  }
}
