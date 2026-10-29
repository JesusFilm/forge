import { describe, expect, it, vi } from "vitest"
import {
  handleForgeVideoEnrichmentRouteRequest as accept,
  handleForgeVideoEnrichmentStartRouteRequest as start,
} from "./forge-video-enrichment-routes"
import type {
  Admission,
  EnrichmentAdmissionStore,
} from "./enrichment-admission-store"
const input = { jobId: "job", assetId: "asset", muxAssetId: "asset" }
function harness() {
  const runs = new Map<string, Admission & { status: string }>()
  const store: EnrichmentAdmissionStore = {
    reserve: async (admission) => {
      runs.set(admission.runId, { ...admission, status: "accepted" })
    },
    claim: async (admission) => {
      const run = runs.get(admission.runId)
      if (
        !run ||
        run.jobId !== admission.jobId ||
        run.inputDigest !== admission.inputDigest
      )
        return "conflict"
      if (run.status === "started") return "started"
      if (run.status !== "accepted") return "conflict"
      run.status = "starting"
      return "claimed"
    },
    finish: async (id, status) => {
      runs.get(id)!.status = status
    },
  }
  const admit = vi.fn(async () => {})
  const launch = vi.fn(
    async (_input: typeof input, { runId }: { runId: string }) => ({
      ok: true as const,
      jobId: input.jobId,
      runId,
      acceptedAt: "now",
    }),
  )
  const base = {
    authHeader: "Bearer dummy",
    serviceKeys: ["dummy"],
    configured: true,
    store,
    admit,
    launch,
  }
  return { base, store, admit, launch }
}
describe("durable run admission lifecycle", () => {
  it("persists a digest-bound reservation before ack; rejects arbitrary or altered start", async () => {
    const h = harness()
    expect(
      (
        await start({
          ...h.base,
          readJson: async () => ({ runId: "invented", input }),
        })
      ).status,
    ).toBe(409)
    const accepted = await accept({ ...h.base, readJson: async () => input })
    expect(accepted.status).toBe(202)
    expect(
      (
        await start({
          ...h.base,
          readJson: async () => ({
            runId: accepted.body.runId,
            input: { ...input, assetId: "changed" },
          }),
        })
      ).status,
    ).toBe(409)
    expect(h.launch).not.toHaveBeenCalled()
  })
  it("checks current Manager ownership before launch and starts only once across concurrent duplicates", async () => {
    const h = harness()
    const accepted = await accept({ ...h.base, readJson: async () => input })
    const request = {
      ...h.base,
      readJson: async () => ({ runId: accepted.body.runId, input }),
    }
    await Promise.all([start(request), start(request)])
    expect(h.launch).toHaveBeenCalledOnce()
    expect(h.admit.mock.invocationCallOrder[0]).toBeLessThan(
      h.launch.mock.invocationCallOrder[0]!,
    )
    expect((await start(request)).status).toBe(202)
    expect(h.launch).toHaveBeenCalledOnce()
  })
  it("consumes ambiguous launch and never automatically retries external work", async () => {
    const h = harness()
    const accepted = await accept({ ...h.base, readJson: async () => input })
    h.launch.mockRejectedValueOnce(new Error("lost launch response"))
    const request = {
      ...h.base,
      readJson: async () => ({ runId: accepted.body.runId, input }),
    }
    expect((await start(request)).status).toBe(502)
    expect((await start(request)).status).toBe(409)
    expect(h.launch).toHaveBeenCalledOnce()
  })
  it("does not launch after ownership or durable-storage rejection", async () => {
    const h = harness()
    h.store.reserve = async () => {
      throw new Error("database down")
    }
    expect(
      (await accept({ ...h.base, readJson: async () => input })).status,
    ).toBe(503)
    const h2 = harness()
    const accepted = await accept({ ...h2.base, readJson: async () => input })
    h2.admit.mockRejectedValueOnce(new Error("stale owner"))
    expect(
      (
        await start({
          ...h2.base,
          readJson: async () => ({ runId: accepted.body.runId, input }),
        })
      ).status,
    ).toBe(502)
    expect(h2.launch).not.toHaveBeenCalled()
  })
})
