import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const workflowSource = readFileSync(
  new URL("./video-first-devotional.ts", import.meta.url),
  "utf8",
)
const attemptDataSource = readFileSync(
  new URL(
    "../../services/devotional/workspace/attempt-data.ts",
    import.meta.url,
  ),
  "utf8",
)
const mastraRegistrationSource = readFileSync(
  new URL("../index.ts", import.meta.url),
  "utf8",
)

describe("video-first devotional runtime authority", () => {
  it("does not import compiled corpora, catalogs, or default prompts", () => {
    for (const forbidden of [
      "JESUS_FILM_CHAPTERS",
      "JESUS_FILM_PASSAGES",
      "loadReflectionCorpora",
      "DEVOTIONAL_CORPUS_DIR",
      "COPY_SYSTEM_PROMPT",
      "SAFETY_SYSTEM_PROMPT",
      "SYSTEM_PROMPT",
      "WRITER_SYSTEM_PROMPT",
    ]) {
      expect(workflowSource, forbidden).not.toContain(forbidden)
    }

    expect(workflowSource).toContain("loadDevotionalAttemptAuthoredData")
  })

  it("does not use a reusable local devotional cache", () => {
    for (const forbidden of [
      "devotional-cache",
      "devo/cache",
      "attemptCacheDirFor",
      "cacheDirFor",
      "loadCachedAudio",
      "loadCachedDevo",
      "saveCachedAudio",
      "saveCachedDevo",
      "clearCachedDevotional",
    ]) {
      expect(workflowSource, forbidden).not.toContain(forbidden)
    }
  })

  it("does not import the legacy JSON clip ledger or its lock protocol", () => {
    for (const forbidden of [
      "used-clips-ledger",
      "createUsedClipsStore",
      "used-clips.json",
      ".lock",
    ]) {
      expect(workflowSource, forbidden).not.toContain(forbidden)
    }

    expect(workflowSource).toContain("getPostgresUsedClipsStore")
  })

  it("does not fall back to tracked Workspace fixtures", () => {
    const productionSource = `${workflowSource}\n${attemptDataSource}`
    for (const forbidden of [
      "apps/mastra/devotional-workspace",
      "devotional-workspace/inputs",
      "process.cwd()",
      "import.meta.dirname",
    ]) {
      expect(productionSource, forbidden).not.toContain(forbidden)
    }
  })

  it("is the only registered devotional generation workflow", () => {
    expect(mastraRegistrationSource).toContain("videoFirstDevotionalWorkflow")
    expect(mastraRegistrationSource).not.toContain("dailyDevotionalWorkflow")
  })
})
