import { createHmac } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

const requireAdminSession = vi.fn()
const findUnique = vi.fn()
const compare = vi.fn()
const createTypesenseWatchSearchComparisonService = vi.fn(() => ({ compare }))
const projectWatchSearchComparisonResult = vi.fn((value) => value)
const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`)
})
const mockEnv = vi.hoisted(() => ({
  ADMIN_SESSION_SECRET: "admin-session-secret-at-least-32-chars",
  WATCH_SEARCH_CANDIDATE_COMPARISON_ENABLED: true,
}))

vi.mock("@/config/env", () => ({ env: mockEnv }))
vi.mock("@/auth/session", () => ({ requireAdminSession }))
vi.mock("@/db/client", () => ({ prisma: { user: { findUnique } } }))
vi.mock("next/navigation", () => ({ redirect }))
vi.mock("@/services/typesense-watch-search-comparison.service", () => ({
  createTypesenseWatchSearchComparisonService,
}))
vi.mock("@/services/search-trace-privacy", () => ({
  projectWatchSearchComparisonResult,
}))

const { runWatchSearchComparison } = await import("./comparison-actions")

function form(values: Record<string, string | undefined>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) {
    if (value != null) data.set(key, value)
  }
  return data
}

const comparison = {
  comparisonId: "comparison-1",
  input: { query: "Jesus" },
  current: { status: "success" },
  candidate: {
    status: "error",
    error: { code: "search_failed", errorClass: "Error" },
  },
}

describe("runWatchSearchComparison", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.WATCH_SEARCH_CANDIDATE_COMPARISON_ENABLED = true
    requireAdminSession.mockResolvedValue({ id: "admin-1", role: "ADMIN" })
    findUnique.mockResolvedValue({ id: "admin-1", role: "ADMIN" })
    compare.mockResolvedValue(comparison)
  })

  it("revalidates the live Admin and runs one bounded comparison", async () => {
    const result = await runWatchSearchComparison(
      { status: "idle" },
      form({
        query: "  Jesus Japanese  ",
        locale: "ja-JP",
        targetLanguageSlug: "japanese",
        page: "2",
        perPage: "10",
        contentType: "video",
      }),
    )

    expect(requireAdminSession).toHaveBeenCalledOnce()
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "admin-1" },
      select: { id: true, role: true },
    })
    expect(compare).toHaveBeenCalledWith({
      actorKey: createHmac("sha256", mockEnv.ADMIN_SESSION_SECRET)
        .update("watch-search-comparison-actor\0")
        .update("admin-1")
        .digest("hex")
        .slice(0, 32),
      input: {
        query: "Jesus Japanese",
        targetLanguageSlug: "japanese",
        displayLanguageSlug: "japanese",
        acceptLanguage: "ja-JP",
        limit: 10,
        offset: 10,
        resultTypes: ["video"],
      },
    })
    expect(result).toEqual({ status: "success", result: comparison })
  })

  it("blocks a demoted or deleted session principal", async () => {
    findUnique.mockResolvedValueOnce({ id: "admin-1", role: "EDITOR" })
    await expect(
      runWatchSearchComparison({ status: "idle" }, form({ query: "Jesus" })),
    ).rejects.toThrow("redirect:/dashboard")

    findUnique.mockResolvedValueOnce(null)
    await expect(
      runWatchSearchComparison({ status: "idle" }, form({ query: "Jesus" })),
    ).rejects.toThrow("redirect:/dashboard")
    expect(compare).not.toHaveBeenCalled()
  })

  it("propagates unauthenticated and Editor redirects before database access", async () => {
    requireAdminSession.mockRejectedValueOnce(new Error("redirect:login"))
    await expect(
      runWatchSearchComparison({ status: "idle" }, form({ query: "Jesus" })),
    ).rejects.toThrow("redirect:login")
    expect(findUnique).not.toHaveBeenCalled()
    expect(compare).not.toHaveBeenCalled()
  })

  it("fails closed when disabled and rejects forged or out-of-bounds input", async () => {
    mockEnv.WATCH_SEARCH_CANDIDATE_COMPARISON_ENABLED = false
    await expect(
      runWatchSearchComparison({ status: "idle" }, form({ query: "Jesus" })),
    ).resolves.toEqual({
      status: "error",
      message: "Candidate comparison is unavailable",
    })

    mockEnv.WATCH_SEARCH_CANDIDATE_COMPARISON_ENABLED = true
    for (const values of [
      { query: "Jesus", generationId: "forged" },
      { query: "x".repeat(201) },
      { query: "Jesus", locale: "not a locale" },
      { query: "Jesus", targetLanguageSlug: "../secret" },
      { query: "Jesus", page: "0" },
      { query: "Jesus", perPage: "51" },
    ]) {
      await expect(
        runWatchSearchComparison({ status: "idle" }, form(values)),
      ).resolves.toEqual({
        status: "error",
        message: "Check the comparison inputs and try again",
      })
    }
    expect(compare).not.toHaveBeenCalled()
  })

  it("audits identities and outcomes without query or result documents", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    compare.mockResolvedValueOnce({
      ...comparison,
      input: { query: "private query words" },
      current: { status: "success" },
      candidate: {
        status: "success",
        response: { results: [{ title: "private result title" }] },
        diagnostics: { generationId: "generation-7" },
      },
    })

    await runWatchSearchComparison(
      { status: "idle" },
      form({ query: "private query words" }),
    )
    const audit = String(info.mock.calls[0]?.[0])
    expect(audit).toContain("comparison_id=comparison-1")
    expect(audit).toContain("generation_id=generation-7")
    expect(audit).not.toContain("private query words")
    expect(audit).not.toContain("private result title")
  })
})
