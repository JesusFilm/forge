import { createHash } from "node:crypto"
import path from "node:path"

import type { WorkspaceFilesystem } from "@mastra/core/workspace"

import {
  DEVOTIONAL_AUTHORED_PATHS,
  DevotionalAuthoredDataError,
  loadBrandProfile,
  loadHolidayTable,
  loadMusicProfiles,
  loadNarrationPolicy,
  loadPromptBundle,
  loadRenderDocument,
  loadSafetyPolicy,
  loadVoiceProfiles,
  type DevotionalAuthoredDataReader,
} from "../authored-data"
import {
  parseJesusFilmCatalogDocument,
  type JesusFilmChapter,
} from "../jesus-film-catalog"
import {
  parseJesusFilmPassagesDocument,
  type ChapterPassage,
} from "../jesus-film-passages"
import {
  parseReflectionDocument,
  type ReflectionCorpora,
  type ReflectionEntry,
} from "../reflection-corpus"
import { parseWebBibleDocument, type WebBible } from "../web-bible"
import { toNativeWorkspaceFilesystemPath } from "./inventory"
import type { DevotionalSourceRef } from "./state-schema"
import { readVerifiedWorkspaceSource } from "./verified-read"

export type DevotionalAttemptAuthoredData = {
  prompts: Awaited<ReturnType<typeof loadPromptBundle>>
  safety: Awaited<ReturnType<typeof loadSafetyPolicy>>
  holidays: Awaited<ReturnType<typeof loadHolidayTable>>
  voices: Awaited<ReturnType<typeof loadVoiceProfiles>>
  music: Awaited<ReturnType<typeof loadMusicProfiles>>
  narration: Awaited<ReturnType<typeof loadNarrationPolicy>>
  brand: Awaited<ReturnType<typeof loadBrandProfile>>
  render: Awaited<ReturnType<typeof loadRenderDocument>>
  chapters: readonly JesusFilmChapter[]
  passages: readonly ChapterPassage[]
  scripture: WebBible
  corpora: ReflectionCorpora
}

async function readVerified(
  filesystem: WorkspaceFilesystem,
  ref: DevotionalSourceRef,
): Promise<string> {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    await readVerifiedWorkspaceSource(filesystem, ref),
  )
}

export function createAttemptAuthoredDataReader(options: {
  filesystem: WorkspaceFilesystem
  sources: readonly DevotionalSourceRef[]
}): DevotionalAuthoredDataReader {
  const sources = new Map(
    options.sources.map((source) => [source.path, source]),
  )
  return {
    async readRequired(requiredPath) {
      const source = sources.get(requiredPath)
      if (!source) {
        throw new DevotionalAuthoredDataError(
          "missing",
          requiredPath,
          "required document was not selected from the committed catalog",
        )
      }
      return {
        path: source.path,
        text: await readVerified(options.filesystem, source),
        digest: source.digest,
        etag: source.etag,
        modifiedAt: new Date(source.modifiedAt),
      }
    },
  }
}

/** Live, stable singleton reads for Studio-invoked devotional agents. Workflow
 * attempts use the digest-pinned reader above instead. */
export function createLiveWorkspaceAuthoredDataReader(
  filesystem: WorkspaceFilesystem,
): DevotionalAuthoredDataReader {
  return {
    async readRequired(requiredPath) {
      const nativePath = toNativeWorkspaceFilesystemPath(requiredPath)
      try {
        const before = await filesystem.stat(nativePath)
        const value = await filesystem.readFile(nativePath)
        const bytes = typeof value === "string" ? Buffer.from(value) : value
        const after = await filesystem.stat(nativePath)
        if (
          before.size !== after.size ||
          before.modifiedAt.getTime() !== after.modifiedAt.getTime() ||
          bytes.byteLength !== after.size
        ) {
          throw new Error("stat changed during read")
        }
        return {
          path: requiredPath,
          text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          digest: createHash("sha256").update(bytes).digest("hex"),
          modifiedAt: after.modifiedAt,
        }
      } catch (cause) {
        throw new DevotionalAuthoredDataError(
          "missing",
          requiredPath,
          "live Workspace document is unavailable or unstable",
          cause,
        )
      }
    },
  }
}

function isDocumentation(source: DevotionalSourceRef): boolean {
  return path.posix.basename(source.path).toLowerCase() === "readme.md"
}

function addReflection(
  corpora: ReflectionCorpora,
  sourcePath: string,
  entry: ReflectionEntry,
): void {
  const identity = `${sourcePath}\n${entry.source}`.toLowerCase()
  if (identity.includes("spurgeon")) {
    corpora.spurgeon.push(entry)
  } else if (identity.includes("ryle") || entry.osisRef?.startsWith("Matt.")) {
    corpora.ryleMatthew.push(entry)
  } else if (
    identity.includes("henry") ||
    /^(?:Mark|Luke|John)\./u.test(entry.osisRef ?? "")
  ) {
    corpora.matthewHenry.push(entry)
  } else {
    // Content-only files have no passage metadata. They remain usable as
    // thematic sources through the existing scored rotation.
    corpora.spurgeon.push(entry)
  }
}

async function loadScripture(options: {
  filesystem: WorkspaceFilesystem
  sources: readonly DevotionalSourceRef[]
}): Promise<WebBible> {
  const verses: Record<string, string> = {}
  for (const source of options.sources) {
    if (source.category !== "scripture" || isDocumentation(source)) continue
    let parsed: WebBible
    try {
      parsed = parseWebBibleDocument({
        path: source.path,
        content: await readVerified(options.filesystem, source),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new DevotionalAuthoredDataError(
        "invalid",
        source.path,
        `selected scripture source could not be loaded: ${message}`,
        error,
      )
    }
    for (const [reference, text] of Object.entries(parsed.verses)) {
      const previous = verses[reference]
      if (previous != null && previous !== text) {
        throw new DevotionalAuthoredDataError(
          "invalid",
          source.path,
          `conflicting scripture text for ${reference}`,
        )
      }
    }
    for (const [reference, text] of Object.entries(parsed.verses)) {
      verses[reference] = text
    }
  }
  if (Object.keys(verses).length === 0) {
    throw new DevotionalAuthoredDataError(
      "invalid",
      "/inputs/scripture",
      "no valid WEB scripture corpus was selected",
    )
  }
  return { verses }
}

async function loadCorpora(options: {
  filesystem: WorkspaceFilesystem
  sources: readonly DevotionalSourceRef[]
}): Promise<ReflectionCorpora> {
  const corpora: ReflectionCorpora = {
    ryleMatthew: [],
    matthewHenry: [],
    spurgeon: [],
  }
  for (const source of options.sources) {
    if (source.category !== "reflections" || isDocumentation(source)) continue
    const entries = parseReflectionDocument({
      path: source.path,
      content: await readVerified(options.filesystem, source),
    })
    for (const entry of entries) addReflection(corpora, source.path, entry)
  }
  if (
    corpora.ryleMatthew.length === 0 &&
    corpora.matthewHenry.length === 0 &&
    corpora.spurgeon.length === 0
  ) {
    throw new DevotionalAuthoredDataError(
      "invalid",
      "/inputs/reflections",
      "no valid reflection source was selected",
    )
  }
  return corpora
}

/** Load and validate the exact committed source set for one attempt. */
export async function loadDevotionalAttemptAuthoredData(options: {
  filesystem: WorkspaceFilesystem
  sources: readonly DevotionalSourceRef[]
}): Promise<DevotionalAttemptAuthoredData> {
  const reader = createAttemptAuthoredDataReader(options)
  const [
    prompts,
    safety,
    holidays,
    voices,
    music,
    narration,
    brand,
    render,
    catalogDocument,
    passageDocument,
    scripture,
    corpora,
  ] = await Promise.all([
    loadPromptBundle(reader),
    loadSafetyPolicy(reader),
    loadHolidayTable(reader),
    loadVoiceProfiles(reader),
    loadMusicProfiles(reader),
    loadNarrationPolicy(reader),
    loadBrandProfile(reader),
    loadRenderDocument(reader),
    reader.readRequired(DEVOTIONAL_AUTHORED_PATHS.videoCatalog),
    reader.readRequired(DEVOTIONAL_AUTHORED_PATHS.videoPassages),
    loadScripture(options),
    loadCorpora(options),
  ])
  return {
    prompts,
    safety,
    holidays,
    voices,
    music,
    narration,
    brand,
    render,
    chapters: parseJesusFilmCatalogDocument({
      path: catalogDocument.path,
      content: catalogDocument.text,
    }),
    passages: parseJesusFilmPassagesDocument({
      path: passageDocument.path,
      content: passageDocument.text,
    }),
    scripture,
    corpora,
  }
}
