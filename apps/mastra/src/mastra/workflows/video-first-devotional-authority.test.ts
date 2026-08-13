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
  // Both seams shipped unwired once: production ran them on in-code prompts
  // while every sibling read its prompt from the Workspace, which quietly took
  // the owner's closing-line and point-selection rules off the surface she can
  // edit without a deploy. Nothing failed, because no test looked at the call
  // site. This pins the SOURCE of each prompt, so dropping either override
  // turns this red rather than silently changing what the pipeline writes.
  it("threads authored prompts into the point picker and the conclusion writer", () => {
    for (const required of [
      "authored.prompts.prompts.pointPicker",
      "authored.prompts.prompts.conclusion",
      "pickPoints: (options)",
      "writeConclusion: (options)",
      "value: { devotional, safety, quality, notes },",
    ]) {
      expect(workflowSource, required).toContain(required)
    }

    // The explaining seam. Both the picker's chosen-points rationale and every
    // critic's issues/suggestions are produced through it, and with no caller
    // passing it they were computed and dropped. COUNTED, not merely present:
    // there are two call sites (content composition and the quality gate), and a
    // `toContain("log,")` still passes when one of them loses it — which is how
    // the first version of this pin failed its own falsification.
    expect(workflowSource.match(/^\s+log,$/gm) ?? []).toHaveLength(2)
  })

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
