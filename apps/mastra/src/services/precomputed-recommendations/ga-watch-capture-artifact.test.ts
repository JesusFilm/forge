import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  gaCaptureCanonicalJson,
  gaCaptureContentDigest,
  openGaWatchCaptureArtifact,
  sealGaWatchCaptureArtifact,
  writeGaWatchCapturePage,
} from "./ga-watch-capture-artifact"

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

describe("sealed GA Watch aggregate artifact", () => {
  it("round-trips bounded aggregate pages without retaining referrer query strings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-capture-"))
    directories.push(directory)
    const start = await writeGaWatchCapturePage({
      directory,
      kind: "start_page",
      pageOffset: 0,
      rowCount: 1,
      rows: [
        {
          pagePath: "/watch/source.html/english.html",
          mediaComponentId: "media",
          starts: 7,
          rowIdentityDigest: "a".repeat(64),
        },
      ],
    })
    const referrer = await writeGaWatchCapturePage({
      directory,
      kind: "referrer_page",
      pageOffset: 0,
      rowCount: 1,
      rows: [
        {
          sourcePath: "/watch/source.html/english.html",
          targetPath: "/watch/target.html/english.html",
          pagePath: "/watch/target.html/english.html",
          sourcePatternIds: [0],
          status: "candidate",
          mediaComponentId: "media",
          starts: 3,
          rowIdentityDigest: "b".repeat(64),
        },
      ],
    })
    const sealed = await sealGaWatchCaptureArtifact({
      directory,
      header: {
        version: "ga_watch_capture_v1",
        generationId: "generation-one",
        generationInputDigest: "c".repeat(64),
        sourceSetDigest: "d".repeat(64),
        inputCutoff: "2026-10-06T00:00:00.000Z",
        selectedCorpusDigest: "e".repeat(64),
        candidatePoolDigest: "f".repeat(64),
        routeMappingDigest: "1".repeat(64),
        querySpecDigest: "2".repeat(64),
        sourcePatternTableDigest: "3".repeat(64),
        propertyId: "320198532",
        propertyTimeZone: "America/New_York",
        requestedStart: "2022-08-06",
        requestedEnd: "2026-10-05",
        usableStart: "2022-08-08",
        usableEnd: "2026-10-05",
        sourceAvailability: { usableStart: "2022-08-08" },
        baseQualification: { evidenceKind: "referrer_navigation_v1" },
        baseQualificationDigest: "4".repeat(64),
        requestedCoverageDigest: "5".repeat(64),
        usableCoverageDigest: "6".repeat(64),
        captureStartedAt: "2026-10-07T00:00:00.000Z",
        captureCompletedAt: "2026-10-07T00:01:00.000Z",
        verification: "two_matching_passes",
        startRows: 1,
        referrerRows: 1,
        startPages: 1,
        referrerPages: 1,
        startContentDigest: gaCaptureContentDigest("start_page", [start]),
        referrerContentDigest: gaCaptureContentDigest("referrer_page", [
          referrer,
        ]),
        physicalHttpAttempts: 6,
        physicalSucceededCalls: 5,
      },
      pages: [start, referrer],
      locatorIndex: {
        sourcePatterns: ["/watch/source\\.html"],
        pagesBySourcePattern: [[0]],
      },
    })
    const bytes = await readFile(sealed.path)
    expect(bytes.includes(Buffer.from("FORGEGA1"))).toBe(true)
    expect(bytes.includes(Buffer.from("secret=viewer"))).toBe(false)
    const opened = await openGaWatchCaptureArtifact({
      path: sealed.path,
      expectedSha256: sealed.artifactSha256,
      expectedBytes: sealed.artifactBytes,
    })
    expect(opened.header.startRows).toBe(1)
    expect(await opened.readPage(start)).toEqual([
      {
        pagePath: "/watch/source.html/english.html",
        mediaComponentId: "media",
        starts: 7,
        rowIdentityDigest: "a".repeat(64),
      },
    ])
    expect(await opened.readLocatorIndex()).toEqual({
      sourcePatterns: ["/watch/source\\.html"],
      pagesBySourcePattern: [[0]],
    })
    await writeFile(
      sealed.path,
      Buffer.concat([bytes.subarray(0, -1), Buffer.from([bytes.at(-1)! ^ 1])]),
    )
    await expect(
      openGaWatchCaptureArtifact({
        path: sealed.path,
        expectedSha256: sealed.artifactSha256,
        expectedBytes: sealed.artifactBytes,
      }),
    ).rejects.toThrow()
    const oversizedBlock = {
      ...sealed.header.blocks[0]!,
      rawBytes: 8 * 1024 * 1024,
    }
    const oversizedHeader = {
      ...sealed.header,
      blocks: [
        ...Array.from({ length: 129 }, () => oversizedBlock),
        ...sealed.header.blocks.slice(1),
      ],
    }
    const oversizedHeaderBytes = Buffer.from(
      gaCaptureCanonicalJson(oversizedHeader),
    )
    const length = Buffer.alloc(4)
    length.writeUInt32BE(oversizedHeaderBytes.length)
    const forgedBytes = Buffer.concat([
      Buffer.from("FORGEGA1", "ascii"),
      length,
      oversizedHeaderBytes,
    ])
    const forgedPath = join(directory, "forged.bin")
    await writeFile(forgedPath, forgedBytes)
    await expect(
      openGaWatchCaptureArtifact({
        path: forgedPath,
        expectedSha256: createHash("sha256").update(forgedBytes).digest("hex"),
        expectedBytes: forgedBytes.length,
      }),
    ).rejects.toMatchObject({ code: "ga_capture_raw_total_cap" })
  })

  it("refuses a page before staging when its raw-byte budget is exhausted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ga-capture-raw-cap-"))
    directories.push(directory)
    await expect(
      writeGaWatchCapturePage({
        directory,
        kind: "start_page",
        pageOffset: 0,
        rowCount: 1,
        rows: [{ pagePath: "/watch/source.html", starts: 1 }],
        remainingRawBytes: 1,
      }),
    ).rejects.toMatchObject({ code: "ga_capture_raw_total_cap" })
    await expect(
      readFile(join(directory, "start_page-0.gz")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    })
  })
})
