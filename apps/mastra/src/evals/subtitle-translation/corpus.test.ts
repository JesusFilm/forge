import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { prepareSubtitleEvalCorpus } from "./corpus"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe("subtitle eval corpus preparation", () => {
  it("locks exact same-edition Core tracks and caches clipped VTT bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "subtitle-eval-corpus-"))
    temporaryDirectories.push(directory)
    const manifestPath = join(directory, "manifest.json")
    const lockPath = join(directory, "corpus.lock.json")
    const corpusDirectory = join(directory, "corpus")
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: "subtitle-translation-eval/v1",
        referenceAuthority: "provisional",
        referenceNotes: "Test reference.",
        sourceLanguage: "en",
        targetLanguages: ["es"],
        languages: [
          { bcp47: "en", coreLanguageId: "529", label: "English" },
          { bcp47: "es", coreLanguageId: "21028", label: "Spanish" },
        ],
        cases: [
          {
            id: "sample",
            videoId: "video-1",
            title: "Sample",
            collection: "Tests",
            edition: "base",
            coreVideoEditionId: "edition-1",
            clip: { startSeconds: 2, endSeconds: 8 },
          },
        ],
      }),
    )
    const vtt =
      "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello\n\n00:00:06.000 --> 00:00:09.000\nWorld\n"
    const rows = [
      coreRow("subtitle-en", "529", true, "en.vtt"),
      coreRow("subtitle-es", "21028", false, "es.vtt"),
    ]
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === "POST") {
        return Response.json({ data: { videoSubtitles: rows } })
      }
      return new Response(vtt, {
        status: 200,
        headers: { "content-type": "text/vtt" },
      })
    })

    const lock = await prepareSubtitleEvalCorpus({
      manifestPath,
      lockPath,
      corpusDirectory,
      refreshLock: true,
      fetchImpl,
      now: () => new Date("2026-08-20T00:00:00.000Z"),
    })

    expect(lock.tracks).toHaveLength(2)
    expect(lock.tracks.map((track) => track.subtitleId)).toEqual([
      "subtitle-en",
      "subtitle-es",
    ])
    expect(
      await readFile(join(corpusDirectory, "sample/en.vtt"), "utf8"),
    ).toContain("00:00:02.000 --> 00:00:04.000")
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({
      schemaVersion: "subtitle-translation-eval-corpus-lock/v1",
      resolvedAt: "2026-08-20T00:00:00.000Z",
    })
  })
})

function coreRow(
  id: string,
  languageId: string,
  primary: boolean,
  fileName: string,
) {
  return {
    id,
    videoId: "video-1",
    languageId,
    primary,
    edition: "base",
    vttSrc: `https://api-media-core.jesusfilm.org/video-1/${fileName}`,
    updatedAt: "2026-08-20T00:00:00.000Z",
    videoEdition: { id: "edition-1" },
  }
}
