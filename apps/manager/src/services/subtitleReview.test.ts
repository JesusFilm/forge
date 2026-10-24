import { createHash } from "node:crypto"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import type { JobRecord, JobArtifactManifest } from "@/types/job"

const seam = vi.hoisted(() => ({
  get: vi.fn(),
  cas: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}))
vi.mock("@/lib/state", () => ({
  getJob: seam.get,
  compareAndSwapJobArtifacts: seam.cas,
}))
vi.mock("@/services/storage", () => ({
  readArtifactBounded: seam.read,
  writeImmutableArtifact: seam.write,
}))
const vtt = (text: string) =>
  `WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n${text}\n`
const hash = (text: string) => createHash("sha256").update(text).digest("hex")
function job(id = "job-1"): JobRecord {
  return {
    id,
    muxAssetId: "shared",
    muxPlaybackId: "playback",
    languages: ["fr"],
    options: {},
    status: "completed",
    retries: 0,
    createdAt: "2026-10-24T00:00:00Z",
    updatedAt: "2026-10-24T00:00:00Z",
    artifacts: { "subtitles-fr": { kind: "downloadable" } },
    steps: [],
    errors: [],
  }
}
const jobs = new Map<string, JobRecord>()
const objects = new Map<string, string>()
async function token(id = "job-1", actorId = "operator") {
  const { signSubtitleReviewToken } =
    await import("@/lib/subtitle-review-session")
  return signSubtitleReviewToken({
    jobId: id,
    sourceArtifactKey: "subtitles-fr",
    targetLanguage: "fr",
    baseArtifactKey: "subtitles-fr",
    baseFingerprint: hash(vtt("source")),
    actorId,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  })
}
async function save(
  text: string,
  clientSaveId: string,
  opts: { id?: string; base?: string; editToken?: string } = {},
) {
  const { saveSubtitleReviewRevision } = await import("./subtitleReview")
  return saveSubtitleReviewRevision({
    jobId: opts.id ?? "job-1",
    editToken: opts.editToken ?? (await token(opts.id)),
    vtt: vtt(text),
    clientSaveId,
    baseArtifactFingerprint: opts.base ?? hash(vtt("source")),
  })
}
function cas(observed: JobRecord, artifacts: JobArtifactManifest) {
  const current = jobs.get(observed.id)!
  if (JSON.stringify(current.artifacts) !== JSON.stringify(observed.artifacts))
    return false
  current.artifacts = structuredClone(artifacts)
  return true
}
beforeEach(() => {
  vi.stubEnv("SUBTITLE_EDITOR_PUBLIC_URL", "https://editor.test")
  vi.stubEnv("SUBTITLE_REVIEW_SESSION_SECRET", "test-secret")
  jobs.clear()
  objects.clear()
  jobs.set("job-1", job())
  seam.get.mockImplementation(async (id: string) =>
    structuredClone(jobs.get(id) ?? null),
  )
  seam.cas.mockImplementation(cas)
  seam.read.mockImplementation(async (asset: string, key: string) =>
    Buffer.from(
      key === "subtitles-fr" ? vtt("source") : objects.get(`${asset}/${key}`)!,
    ),
  )
  seam.write.mockImplementation(
    async (input: { assetId: string; artifactType: string; body: string }) => {
      const key = `${input.assetId}/${input.artifactType}`
      if (objects.has(key) && objects.get(key) !== input.body)
        throw new Error("immutable collision")
      objects.set(key, input.body)
    },
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.resetAllMocks()
})
describe("review transition integrity", () => {
  it("F1: concurrent saves have one winner; no acknowledged revision loss", async () => {
    const editToken = await token()
    const results = await Promise.all([
      save("A", "a", { editToken }),
      save("B", "b", { editToken }),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual([
      {
        ok: false,
        reason: "stale_base",
        latestArtifactKey: expect.any(String),
      },
    ])
    const { getSubtitleReviewReport } = await import("@/lib/subtitle-review")
    expect(
      getSubtitleReviewReport(jobs.get("job-1")!.artifacts).revisions,
    ).toHaveLength(1)
  })
  it("F1: concurrent creates retain both launches and exactly one exchange consumes a launch", async () => {
    const api = await import("./subtitleReview")
    const create = () =>
      api.createSubtitleReviewSession({
        jobId: "job-1",
        sourceArtifactKey: "subtitles-fr",
        actorId: "operator",
      })
    const created = await Promise.all([create(), create()])
    const launchCode = new URL(created[0]!.editorUrl).searchParams.get(
      "launch",
    )!
    const exchanged = await Promise.all(
      [1, 2].map(() =>
        api.exchangeSubtitleReviewLaunchCode({ jobId: "job-1", launchCode }),
      ),
    )
    expect(exchanged.filter((r) => r.ok)).toHaveLength(1)
    expect(exchanged.filter((r) => !r.ok)).toEqual([
      { ok: false, reason: "invalid_launch" },
    ])
    const { getSubtitleReviewReport } = await import("@/lib/subtitle-review")
    expect(
      getSubtitleReviewReport(jobs.get("job-1")!.artifacts).launchSessions,
    ).toHaveLength(2)
  })
  it("F1: retries comparison after background artifact mutation without losing siblings", async () => {
    seam.cas
      .mockImplementationOnce((observed: JobRecord) => {
        jobs.get(observed.id)!.artifacts.background = {
          kind: "metadata",
          data: { done: true },
        }
        return false
      })
      .mockImplementation(cas)
    expect((await save("edit", "a")).ok).toBe(true)
    expect(jobs.get("job-1")!.artifacts.background).toEqual({
      kind: "metadata",
      data: { done: true },
    })
  })
  it("F2: two jobs sharing an asset keep separate acknowledged immutable bytes", async () => {
    jobs.set("job-2", job("job-2"))
    const a = await save("A", "a"),
      b = await save("B", "b", { id: "job-2" })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) throw new Error("save failed")
    expect(a.artifactKey).not.toBe(b.artifactKey)
    expect(hash(objects.get(`shared/${a.artifactKey}`)!)).toBe(
      a.contentFingerprint,
    )
    expect(hash(objects.get(`shared/${b.artifactKey}`)!)).toBe(
      b.contentFingerprint,
    )
  })
  it("F2: reconciles a committed but failed transport as an exact replay", async () => {
    seam.cas.mockImplementationOnce(
      (observed: JobRecord, artifacts: JobArtifactManifest) => {
        cas(observed, artifacts)
        throw new Error("reply lost")
      },
    )
    const result = await save("A", "a")
    expect(result).toMatchObject({ ok: true, status: "duplicate", revision: 1 })
    expect(objects.size).toBe(1)
  })
  it("F2: a failed persist followed by another save never rewrites the winner", async () => {
    const editToken = await token()
    seam.cas.mockResolvedValue(false)
    expect(await save("orphan", "orphan", { editToken })).toEqual({
      ok: false,
      reason: "persist_failed",
    })
    seam.cas.mockImplementation(cas)
    const result = await save("winner", "winner", { editToken })
    expect(result.ok).toBe(true)
    expect(await save("orphan", "orphan", { editToken })).toMatchObject({
      ok: false,
      reason: "stale_base",
    })
    if (result.ok)
      expect(hash(objects.get(`shared/${result.artifactKey}`)!)).toBe(
        result.contentFingerprint,
      )
  })
  it("F3: same ID replays equal content/base/actor/session only", async () => {
    const editToken = await token()
    const a = await save("A", "a", { editToken })
    expect(a.ok).toBe(true)
    expect(await save("A", "a", { editToken })).toMatchObject({
      ok: true,
      status: "duplicate",
    })
    expect(await save("B", "a", { editToken })).toEqual({
      ok: false,
      reason: "save_id_conflict",
    })
    expect(await save("A", "a", { editToken, base: hash(vtt("A")) })).toEqual({
      ok: false,
      reason: "save_id_conflict",
    })
    expect(
      await save("A", "a", { editToken: await token("job-1", "other") }),
    ).toEqual({ ok: false, reason: "save_id_conflict" })
  })
  it("does not deduplicate another ID by matching content", async () => {
    const editToken = await token()
    await save("A", "a", { editToken })
    expect(await save("A", "b", { editToken })).toMatchObject({
      ok: false,
      reason: "stale_base",
    })
    expect(
      await save("A", "b", { editToken, base: hash(vtt("A")) }),
    ).toMatchObject({ ok: true, status: "saved", revision: 2 })
  })
  it("bootstrap rejects a reviewed digest mismatch and preserves legacy readability", async () => {
    const editToken = await token()
    const saved = await save("A", "a", { editToken })
    const { bootstrapSubtitleReviewSession } = await import("./subtitleReview")
    expect(
      await bootstrapSubtitleReviewSession({ jobId: "job-1", editToken }),
    ).toMatchObject({ ok: true, vtt: vtt("A") })
    if (saved.ok) objects.set(`shared/${saved.artifactKey}`, vtt("corrupt"))
    expect(
      await bootstrapSubtitleReviewSession({ jobId: "job-1", editToken }),
    ).toEqual({ ok: false, reason: "artifact_not_found" })
  })
  it.each([
    "WEBVTT\n",
    "WEBVTT\n\n00:00:02.000 --> 00:00:01.000\nbackwards\n",
    vtt("x".repeat(8193)),
    vtt("x").repeat(5001),
  ])("bounds invalid VTT and cues", async (invalid) => {
    const { saveSubtitleReviewRevision } = await import("./subtitleReview")
    expect(
      await saveSubtitleReviewRevision({
        jobId: "job-1",
        editToken: await token(),
        vtt: invalid,
        clientSaveId: "a",
      }),
    ).toEqual({ ok: false, reason: "invalid_vtt" })
    expect(seam.write).not.toHaveBeenCalled()
  })
  it("rejects invalid tokens before looking up state", async () => {
    expect(await save("A", "a", { editToken: "invalid" })).toEqual({
      ok: false,
      reason: "invalid_token",
    })
    expect(seam.get).not.toHaveBeenCalled()
  })
  it("IR1F2: 1024 unverified chosen IDs cannot deny a genuine new launch", async () => {
    const { createSubtitleReviewSession, exchangeSubtitleReviewLaunchCode } =
      await import("./subtitleReview")
    for (let i = 0; i < 1024; i++) {
      await exchangeSubtitleReviewLaunchCode({
        jobId: `missing-${i}`,
        launchCode: "invalid",
      })
    }
    const launch = await createSubtitleReviewSession({
      jobId: "job-1",
      sourceArtifactKey: "subtitles-fr",
      actorId: "operator",
    })
    const result = await exchangeSubtitleReviewLaunchCode({
      jobId: "job-1",
      launchCode: new URL(launch.editorUrl).searchParams.get("launch")!,
    })
    expect(result.ok).toBe(true)
  })
  it("limits unknown and invalid known-job attempts without reserving verified capacity; expires failures", async () => {
    vi.useFakeTimers()
    try {
      const { createSubtitleReviewSession, exchangeSubtitleReviewLaunchCode } =
        await import("./subtitleReview")
      for (const jobId of ["missing", "job-1"]) {
        const reason = jobId === "missing" ? "job_not_found" : "invalid_launch"
        for (let i = 0; i < 10; i++)
          expect(
            await exchangeSubtitleReviewLaunchCode({
              jobId,
              launchCode: "invalid",
            }),
          ).toEqual({ ok: false, reason })
        const reads = seam.get.mock.calls.length
        expect(
          await exchangeSubtitleReviewLaunchCode({
            jobId,
            launchCode: "invalid",
          }),
        ).toEqual({ ok: false, reason: "rate_limited" })
        expect(seam.get).toHaveBeenCalledTimes(reads)
      }
      const launch = await createSubtitleReviewSession({
        jobId: "job-1",
        sourceArtifactKey: "subtitles-fr",
        actorId: "operator",
      })
      expect(
        (
          await exchangeSubtitleReviewLaunchCode({
            jobId: "job-1",
            launchCode: new URL(launch.editorUrl).searchParams.get("launch")!,
          })
        ).ok,
      ).toBe(true)
      vi.advanceTimersByTime(60_001)
      expect(
        await exchangeSubtitleReviewLaunchCode({
          jobId: "missing",
          launchCode: "invalid",
        }),
      ).toEqual({ ok: false, reason: "job_not_found" })
    } finally {
      vi.useRealTimers()
    }
  })
  it("bounds verified bucket capacity, preserves admitted per-job limits and prunes expired buckets", async () => {
    vi.useFakeTimers()
    try {
      const { createSubtitleReviewSession, exchangeSubtitleReviewLaunchCode } =
        await import("./subtitleReview")
      const launch = async (jobId: string) => {
        const result = await createSubtitleReviewSession({
          jobId,
          sourceArtifactKey: "subtitles-fr",
          actorId: "operator",
        })
        return new URL(result.editorUrl).searchParams.get("launch")!
      }
      for (let i = 0; i < 1024; i++) {
        const id = `verified-${i}`
        jobs.set(id, job(id))
        expect(
          (
            await exchangeSubtitleReviewLaunchCode({
              jobId: id,
              launchCode: await launch(id),
            })
          ).ok,
        ).toBe(true)
      }
      const code = await launch("job-1")
      expect(
        await exchangeSubtitleReviewLaunchCode({
          jobId: "job-1",
          launchCode: code,
        }),
      ).toEqual({ ok: false, reason: "rate_limited" })
      for (let i = 0; i < 9; i++)
        expect(
          await exchangeSubtitleReviewLaunchCode({
            jobId: "verified-0",
            launchCode: "invalid",
          }),
        ).toEqual({ ok: false, reason: "invalid_launch" })
      expect(
        await exchangeSubtitleReviewLaunchCode({
          jobId: "verified-0",
          launchCode: "invalid",
        }),
      ).toEqual({ ok: false, reason: "rate_limited" })
      vi.advanceTimersByTime(60_001)
      expect(
        (
          await exchangeSubtitleReviewLaunchCode({
            jobId: "job-1",
            launchCode: code,
          })
        ).ok,
      ).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
