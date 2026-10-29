import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
vi.mock("@/config/env", () => ({ env: {} }))
import { readArtifact, writeArtifact } from "./storage"
import { applyStoredTranscriptCorrections } from "./enrichment-execution-corrections"
it("applies exact-match judgments to canonical local artifacts and preserves raw bytes", async () => {
  const assetId = `pr1087-${randomUUID()}`
  const original = {
    text: "Jesus was good",
    segments: [{ start: 0, end: 2, text: "Jesus was good" }],
    language: "en",
    resolvedProvider: "mux",
  }
  try {
    await writeArtifact({
      assetId,
      artifactType: "transcript",
      ext: "json",
      body: JSON.stringify(original),
    })
    const result = await applyStoredTranscriptCorrections(assetId, {
      status: "reviewed",
      basis: "model_knowledge",
      contentDomain: "bible_story",
      confidence: 1,
      checkedReferenceCount: 1,
      candidateCount: 1,
      flaggedCount: 0,
      likelyBibleReferences: [],
      findings: [
        {
          action: "apply_candidate",
          category: "scripture_phrase",
          segmentIndex: 0,
          start: 0,
          end: 2,
          originalText: "good",
          correctedText: "kind",
          confidence: 1,
          basis: "model_knowledge",
          rationale: "Fixture judgment",
        },
      ],
    })
    expect(result.changed).toBe(true)
    expect(result.summary.appliedCount).toBe(1)
    const read = async (key: string, ext = "json") =>
      new TextDecoder().decode(await readArtifact(assetId, key, ext))
    expect(JSON.parse(await read("transcript-raw"))).toEqual(original)
    expect(JSON.parse(await read("transcript"))).toMatchObject({
      text: "Jesus was kind",
      resolvedProvider: "mux",
    })
    expect(await read("subtitles", "vtt")).toContain("Jesus was kind")
    expect(await read("subtitles-raw", "vtt")).toContain("Jesus was good")
    expect(JSON.parse(await read("transcript-correction-report"))).toBeDefined()
  } finally {
    await rm(join(process.cwd(), ".tmp/artifacts", assetId), {
      recursive: true,
      force: true,
    })
  }
})
