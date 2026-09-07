import { expect, it, vi } from "vitest"
import { runStudioMuxCandidate, type StudioMuxPort } from "./studio-mux-runner"
function port(): StudioMuxPort {
  return {
    read: vi.fn(async () => ({
      id: "intent",
      state: "PENDING",
      dispatchId: null,
      assetId: null,
    })),
    source: vi.fn(async () => "https://asset.test/retained"),
    claim: vi.fn<StudioMuxPort["claim"]>(async () => ({
      execute: true,
      dispatchId: "dispatch",
    })),
    create: vi.fn(async () => ({ id: "asset" })),
    created: vi.fn(async () => {}),
    ambiguous: vi.fn(async () => {}),
    observe: vi.fn(async () => ({ status: "preparing" })),
    ready: vi.fn(async () => {}),
    stage: vi.fn(async () => {}),
  }
}
it("consumes the durable claim before exactly one provider create", async () => {
  const p = port()
  let claimed = false
  p.claim = async () => {
    claimed = true
    return { execute: true, dispatchId: "dispatch" }
  }
  p.create = vi.fn(async () => {
    expect(claimed).toBe(true)
    return { id: "asset" }
  })
  await runStudioMuxCandidate("attempt", p)
  expect(p.create).toHaveBeenCalledOnce()
  expect(p.created).toHaveBeenCalledWith("intent", "dispatch", "asset")
})
it("accepted provider request with lost response remains unresolved across restart", async () => {
  const p = port()
  let accepted = 0
  p.create = async () => {
    accepted++
    throw new Error("response lost after provider acceptance")
  }
  await runStudioMuxCandidate("attempt", p)
  expect(p.ambiguous).toHaveBeenCalledWith("intent", "dispatch")
  p.read = async () => ({
    id: "intent",
    state: "AMBIGUOUS",
    dispatchId: "dispatch",
    assetId: null,
  })
  await runStudioMuxCandidate("attempt", p)
  expect(accepted).toBe(1)
  expect(p.stage).not.toHaveBeenCalled()
})
it("an observed concurrent claim cannot issue a provider request", async () => {
  const p = port()
  p.claim = async () => ({ execute: false, dispatchId: null })
  await runStudioMuxCandidate("attempt", p)
  expect(p.create).not.toHaveBeenCalled()
})
