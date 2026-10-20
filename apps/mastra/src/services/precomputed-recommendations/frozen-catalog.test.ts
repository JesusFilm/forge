import { createHash } from "node:crypto"
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { loadFrozenCatalog } from "./frozen-catalog"
import type { Video } from "./source-generation"
import { readCompleteSelectedChunks } from "./selected-transcript"
import { gaWatchRouteMappingDigest } from "./ga-watch-history"

const scope = {
  generationId: "generation",
  generationInputDigest: "a".repeat(64),
  inputCutoff: "2026-10-13T00:00:00.000Z",
}
const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})
function snapshot() {
  const video: Video = {
    id: "video",
    coreId: "core",
    slug: "original-slug",
    locale: "en",
    title: "An original story",
    description: "Original description",
    descriptionTruncated: false,
    keywords: [],
    keywordsTruncated: false,
    bibleCitations: [],
    bibleCitationsTruncated: false,
    parentVideoIds: [],
    childVideoIds: [],
    transcriptLanguages: ["es"],
    transcriptSelection: {
      policy: "english-per-edition-with-complete-fallback-v1",
      availableTranscriptCount: 1,
      incompleteTranscriptCount: 0,
      skippedEditionCount: 0,
      selected: [
        {
          language: "es",
          totalChunks: 22,
          transcriptId: "transcript",
          videoEditionId: "edition",
        },
      ],
    },
    watchRouteIdentity: {
      basis: "current_catalog_cutoff_fenced",
      parentSlugs: ["original-parent"],
      playableAudioLanguageSlugs: ["spanish"],
      truncated: false,
    },
  }
  return {
    version: "frozen_catalog_v1",
    ...scope,
    entries: [
      {
        video,
        chunks: Array.from({ length: 22 }, (_, index) => ({
          id: `chunk-${String(index).padStart(2, "0")}`,
          transcriptId: "transcript",
          language: "es",
          chunkIndex: index,
          text: `Historia completa ${index}.`,
        })),
      },
    ],
  }
}
async function file(raw = snapshot()) {
  const directory = await mkdtemp(join(tmpdir(), "frozen-catalog-test-"))
  directories.push(directory)
  const path = join(directory, "catalog.json")
  const bytes = JSON.stringify(raw)
  await writeFile(path, bytes)
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    scope,
  }
}
describe("frozen local catalog", () => {
  it("refuses oversized files before reading their contents", async () => {
    const input = await file()
    await truncate(input.path, 32 * 1024 * 1024 + 1)
    await expect(loadFrozenCatalog(input)).rejects.toThrow(
      "frozen_catalog_invalid",
    )
  })
  it("preserves original routes and reads all selected chunks across pages", async () => {
    const source = snapshot()
    const catalog = await loadFrozenCatalog(await file(source))
    const video = await catalog.video({
      videoId: "video",
      cutoff: scope.inputCutoff,
    })
    function route(video: Video) {
      if (!video.watchRouteIdentity) throw new Error("Fixture route missing")
      return {
        id: video.id,
        slug: video.slug,
        watchRouteIdentity: video.watchRouteIdentity,
      }
    }
    expect(gaWatchRouteMappingDigest([route(video)])).toBe(
      gaWatchRouteMappingDigest(
        source.entries.map((entry) => route(entry.video)),
      ),
    )
    expect(
      (await readCompleteSelectedChunks(catalog, video, scope.inputCutoff))
        .chunks,
    ).toEqual(source.entries[0]!.chunks)
    video.title = "caller mutation"
    expect(
      (await catalog.video({ videoId: "video", cutoff: scope.inputCutoff }))
        .title,
    ).toBe("An original story")
  })
  it("rejects changed bytes even when their JSON is valid", async () => {
    const input = await file()
    await writeFile(
      input.path,
      JSON.stringify({ ...snapshot(), generationId: "other" }),
    )
    await expect(loadFrozenCatalog(input)).rejects.toThrow(
      "frozen_catalog_invalid",
    )
  })
  it.each(["generationId", "generationInputDigest", "inputCutoff"] as const)(
    "rejects a different %s",
    async (key) => {
      const input = await file()
      await expect(
        loadFrozenCatalog({
          ...input,
          scope: { ...scope, [key]: "different" },
        }),
      ).rejects.toThrow("frozen_catalog_invalid")
    },
  )
  it("rejects incomplete or duplicate selected chunks", async () => {
    const raw = snapshot()
    raw.entries[0]!.chunks.pop()
    await expect(loadFrozenCatalog(await file(raw))).rejects.toThrow(
      "input_stale",
    )
    const duplicate = snapshot()
    duplicate.entries[0]!.chunks[1] = duplicate.entries[0]!.chunks[0]!
    await expect(loadFrozenCatalog(await file(duplicate))).rejects.toThrow(
      "input_stale",
    )
  })
  it("rejects duplicate videos and unknown cursors or cutoffs", async () => {
    const raw = snapshot()
    raw.entries.push(raw.entries[0]!)
    await expect(loadFrozenCatalog(await file(raw))).rejects.toThrow(
      "frozen_catalog_invalid",
    )
    const catalog = await loadFrozenCatalog(await file())
    await expect(
      catalog.catalog({ cutoff: scope.inputCutoff, afterVideoId: "missing" }),
    ).rejects.toThrow("frozen_catalog_invalid")
    await expect(catalog.catalog({ cutoff: "changed" })).rejects.toThrow(
      "frozen_catalog_invalid",
    )
    await expect(
      catalog.chunks({
        cutoff: scope.inputCutoff,
        videoId: "video",
        afterChunkId: "missing",
      }),
    ).rejects.toThrow("frozen_catalog_invalid")
  })
  it("pages a sorted catalog without losing videos", async () => {
    const raw = snapshot()
    raw.entries = Array.from({ length: 41 }, (_, i) => ({
      ...raw.entries[0]!,
      video: {
        ...raw.entries[0]!.video,
        id: `video-${String(i).padStart(2, "0")}`,
      },
    }))
    const catalog = await loadFrozenCatalog(await file(raw))
    const first = await catalog.catalog({ cutoff: scope.inputCutoff })
    expect(first.videos).toHaveLength(40)
    expect(first.nextCursor).toBe("video-39")
    const last = await catalog.catalog({
      cutoff: scope.inputCutoff,
      afterVideoId: first.nextCursor!,
    })
    expect(last.videos.map((video) => video.id)).toEqual(["video-40"])
    expect(last.nextCursor).toBeNull()
  })
})
