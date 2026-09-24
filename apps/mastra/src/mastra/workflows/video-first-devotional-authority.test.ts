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
  // The prompt WIRING is asserted behaviourally in
  // video-first-devotional-authored-prompts.test.ts, which runs the real content
  // composition and checks what each service receives. Source-text assertions
  // used to stand in for that and were a poor substitute: they pass for a mention
  // in a comment and say nothing about what reaches a model.
  //
  // What stays here is what behaviour cannot see. The explaining seam produces
  // the picker's rationale and every critic's issues, and both used to be
  // computed and dropped because no caller passed it. A behavioural test would
  // have to assert on stdout to catch that; the durable end of it is the artifact
  // write, which is asserted directly. The seam is COUNTED, not merely present:
  // there are two call sites, and `toContain("log,")` still passed when one of
  // them lost it — which is how the first version of this pin failed its own
  // falsification.
  it("persists the run's reasoning and passes the log seam at both call sites", () => {
    expect(workflowSource).toContain(
      "value: { devotional, safety, quality, notes },",
    )
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
