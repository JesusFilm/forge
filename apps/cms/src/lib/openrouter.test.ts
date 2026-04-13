import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("openai", () => {
  const MockOpenAI = vi.fn()
  return { default: MockOpenAI }
})

import OpenAI from "openai"

// Re-import after mock is set up so the singleton picks up the mock
const { embedQuery, getOpenrouter } = await import("./openrouter")

const mockCreate = vi.fn()

beforeEach(() => {
  vi.mocked(OpenAI).mockImplementation(
    () =>
      ({
        embeddings: { create: mockCreate },
      }) as unknown as OpenAI,
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  // Reset the module singleton between tests
  vi.resetModules()
})

describe("getOpenrouter", () => {
  it("throws when OPENROUTER_API_KEY is not set", () => {
    const original = process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_API_KEY

    expect(() => getOpenrouter()).toThrow("OPENROUTER_API_KEY is not set")

    process.env.OPENROUTER_API_KEY = original
  })
})

describe("embedQuery", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key"
  })

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY
  })

  it("returns embedding vector from successful response", async () => {
    const vector = [0.1, 0.2, 0.3, 0.4]
    mockCreate.mockResolvedValueOnce({
      data: [{ index: 0, embedding: vector }],
    })

    const result = await embedQuery("test query")

    expect(result).toEqual(vector)
    expect(mockCreate).toHaveBeenCalledWith({
      model: "openai/text-embedding-3-small",
      input: ["test query"],
    })
  })

  it("throws when API returns empty data array", async () => {
    mockCreate.mockResolvedValueOnce({
      data: [],
    })

    await expect(embedQuery("test query")).rejects.toThrow(
      "Expected exactly 1 embedding, got 0",
    )
  })

  it("throws when OPENROUTER_API_KEY is not set", async () => {
    delete process.env.OPENROUTER_API_KEY

    await expect(embedQuery("test query")).rejects.toThrow(
      "OPENROUTER_API_KEY is not set",
    )
  })
})
