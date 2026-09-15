import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import {
  downloadCoreVtt,
  fetchCoreSubtitleRows,
  type CoreSubtitleRow,
} from "./core-client"
import {
  SubtitleEvalCorpusLockSchema,
  SubtitleEvalManifestSchema,
  type SubtitleEvalCorpusLock,
  type SubtitleEvalManifest,
  type SubtitleEvalTrackLock,
} from "./types"
import { cropVttCues, parseVtt, serializeVtt } from "./vtt"

export type LoadedSubtitleEvalManifest = {
  manifest: SubtitleEvalManifest
  bytes: Uint8Array
  sha256: string
}

export type PrepareSubtitleEvalCorpusInput = {
  manifestPath: string
  lockPath: string
  corpusDirectory: string
  refreshLock?: boolean
  fetchImpl?: typeof fetch
  coreApiUrl?: string
  now?: () => Date
}

export async function loadSubtitleEvalManifest(
  manifestPath: string,
): Promise<LoadedSubtitleEvalManifest> {
  const bytes = new Uint8Array(await readFile(manifestPath))
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new Error(
      `Subtitle eval manifest is not valid JSON: ${manifestPath}`,
      {
        cause: error,
      },
    )
  }
  return {
    manifest: SubtitleEvalManifestSchema.parse(value),
    bytes,
    sha256: sha256(bytes),
  }
}

export async function loadSubtitleEvalCorpusLock(lockPath: string): Promise<{
  lock: SubtitleEvalCorpusLock
  bytes: Uint8Array
  sha256: string
}> {
  const bytes = new Uint8Array(await readFile(lockPath))
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new Error(
      `Subtitle eval corpus lock is not valid JSON: ${lockPath}`,
      {
        cause: error,
      },
    )
  }
  return {
    lock: SubtitleEvalCorpusLockSchema.parse(value),
    bytes,
    sha256: sha256(bytes),
  }
}

export async function prepareSubtitleEvalCorpus(
  input: PrepareSubtitleEvalCorpusInput,
): Promise<SubtitleEvalCorpusLock> {
  const loaded = await loadSubtitleEvalManifest(input.manifestPath)
  const tracks: SubtitleEvalTrackLock[] = []
  const cachedVtts = new Map<string, string>()
  const languageByCode = new Map(
    loaded.manifest.languages.map((language) => [language.bcp47, language]),
  )
  const requestedLanguages = [
    loaded.manifest.sourceLanguage,
    ...loaded.manifest.targetLanguages,
  ]

  for (const benchmarkCase of loaded.manifest.cases) {
    const rows = await fetchCoreSubtitleRows({
      videoId: benchmarkCase.videoId,
      coreApiUrl: input.coreApiUrl,
      fetchImpl: input.fetchImpl,
    })

    for (const languageCode of requestedLanguages) {
      const language = languageByCode.get(languageCode)
      if (!language) {
        throw new Error(`Missing manifest language definition: ${languageCode}`)
      }
      const row = selectTrack(rows, {
        caseId: benchmarkCase.id,
        videoId: benchmarkCase.videoId,
        edition: benchmarkCase.edition,
        coreVideoEditionId: benchmarkCase.coreVideoEditionId,
        coreLanguageId: language.coreLanguageId,
        languageCode,
      })
      const sourceVtt = await downloadCoreVtt({
        sourceUrl: row.vttSrc!,
        fetchImpl: input.fetchImpl,
      })
      const clippedCues = cropVttCues(
        parseVtt(sourceVtt),
        benchmarkCase.clip.startSeconds,
        benchmarkCase.clip.endSeconds,
      )
      if (clippedCues.length === 0) {
        throw new Error(
          `No ${languageCode} cues overlap ${benchmarkCase.id} clip`,
        )
      }

      const clippedVtt = serializeVtt(clippedCues)
      const relativePath = `${benchmarkCase.id}/${languageCode.toLowerCase()}.vtt`
      cachedVtts.set(relativePath, clippedVtt)
      tracks.push({
        caseId: benchmarkCase.id,
        role:
          languageCode === loaded.manifest.sourceLanguage
            ? "source"
            : "reference",
        language: languageCode,
        coreLanguageId: language.coreLanguageId,
        subtitleId: row.id,
        videoId: row.videoId,
        edition: row.edition,
        coreVideoEditionId: row.videoEdition.id,
        primary: row.primary,
        ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}),
        sourceUrl: row.vttSrc!,
        sourceSha256: sha256(sourceVtt),
        clippedSha256: sha256(clippedVtt),
        cueCount: clippedCues.length,
        relativePath,
      })
    }
  }

  tracks.sort(
    (left, right) =>
      left.caseId.localeCompare(right.caseId) ||
      left.language.localeCompare(right.language),
  )
  const lock = SubtitleEvalCorpusLockSchema.parse({
    schemaVersion: "subtitle-translation-eval-corpus-lock/v1",
    manifestSha256: loaded.sha256,
    resolvedAt: (input.now ?? (() => new Date()))().toISOString(),
    tracks,
  })

  const existingLock = await readExistingLock(input.lockPath)
  if (!input.refreshLock) {
    if (!existingLock) {
      throw new Error(
        "Subtitle eval corpus lock is missing; rerun with --refresh-lock to create it intentionally",
      )
    }
    assertLockMatches(existingLock, lock)
  }

  await Promise.all(
    [...cachedVtts.entries()].map(async ([relativePath, body]) => {
      const path = resolveCorpusPath(input.corpusDirectory, relativePath)
      await atomicWrite(path, body)
    }),
  )

  if (input.refreshLock) {
    await atomicWrite(input.lockPath, `${JSON.stringify(lock, null, 2)}\n`)
  }
  return input.refreshLock ? lock : existingLock!
}

export async function readVerifiedCorpusTrack(input: {
  corpusDirectory: string
  track: SubtitleEvalTrackLock
}): Promise<string> {
  const path = resolveCorpusPath(
    input.corpusDirectory,
    input.track.relativePath,
  )
  const body = await readFile(path, "utf8").catch((error: unknown) => {
    throw new Error(
      `Missing cached subtitle eval track ${input.track.caseId}/${input.track.language}; run eval:subtitles:prepare first`,
      { cause: error },
    )
  })
  const actualSha256 = sha256(body)
  if (actualSha256 !== input.track.clippedSha256) {
    throw new Error(
      `Cached subtitle eval track checksum mismatch: ${input.track.relativePath}`,
    )
  }
  return body
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function selectTrack(
  rows: readonly CoreSubtitleRow[],
  expected: {
    caseId: string
    videoId: string
    edition: string
    coreVideoEditionId: string
    coreLanguageId: string
    languageCode: string
  },
): CoreSubtitleRow {
  const matches = rows.filter(
    (row) =>
      row.videoId === expected.videoId &&
      row.edition === expected.edition &&
      row.videoEdition.id === expected.coreVideoEditionId &&
      row.languageId === expected.coreLanguageId &&
      row.vttSrc != null,
  )
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${expected.caseId}/${expected.languageCode} Core subtitle track for edition ${expected.edition}; found ${matches.length}`,
    )
  }
  return matches[0]!
}

async function readExistingLock(
  lockPath: string,
): Promise<SubtitleEvalCorpusLock | undefined> {
  try {
    return (await loadSubtitleEvalCorpusLock(lockPath)).lock
  } catch (error) {
    if (
      typeof error === "object" &&
      error != null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined
    }
    throw error
  }
}

function assertLockMatches(
  expected: SubtitleEvalCorpusLock,
  actual: SubtitleEvalCorpusLock,
): void {
  if (expected.manifestSha256 !== actual.manifestSha256) {
    throw new Error(
      "Subtitle eval manifest changed; rerun with --refresh-lock after reviewing the corpus identity",
    )
  }
  if (JSON.stringify(expected.tracks) !== JSON.stringify(actual.tracks)) {
    throw new Error(
      "Core subtitle identity or bytes drifted from corpus.lock.json; inspect the change before using --refresh-lock",
    )
  }
}

function resolveCorpusPath(
  corpusDirectory: string,
  relativePath: string,
): string {
  const root = resolve(corpusDirectory)
  const path = resolve(root, relativePath)
  if (!path.startsWith(`${root}/`)) {
    throw new Error("Subtitle eval corpus path escaped its root")
  }
  return path
}

async function atomicWrite(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, body, { flag: "wx" })
  await rename(temporaryPath, path)
}
