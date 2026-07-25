import { describe, expect, it, vi } from "vitest"

import type { FirecrawlConfig } from "../../config/env"
import { pickHook, _internal, type HookPickerCandidate } from "./hook-picker"
import type { DevotionalLlm, DevotionalLlmCompletion } from "./llm"

const FIRECRAWL_STUB: FirecrawlConfig = {
  apiKey: "test-key",
  apiUrl: "https://api.firecrawl.dev",
  timeoutMs: 1000,
  userAgent: "test",
  maxSearchResults: 5,
  maxMarkdownCharacters: 1000,
}

function fakeLlm(
  handlers: Partial<
    Record<string, (input: DevotionalLlmCompletion<unknown>) => unknown>
  >,
): DevotionalLlm {
  return {
    model: "test-model",
    async complete(input) {
      const handler = handlers[input.jsonSchema.name]
      if (!handler) {
        throw new Error(`unexpected llm call: ${input.jsonSchema.name}`)
      }
      return handler(input as DevotionalLlmCompletion<unknown>) as never
    },
  }
}

const NEWS_CANDIDATES: HookPickerCandidate[] = [
  {
    title: "Global summit on clean water opens",
    url: "https://news.example.org/water-summit",
    description: "Leaders gather to expand access to clean water worldwide.",
  },
]

describe("pickHook", () => {
  it("returns a news hook when search yields events and the LLM selects one", async () => {
    const llm = fakeLlm({
      devotional_news_hook: () => ({
        chosen: true,
        candidateIndex: 1,
        title: "A world thirsty for living water",
        summary:
          "As leaders meet over clean water, scripture speaks of deeper thirst.",
        sourceUrl: "https://news.example.org/water-summit",
      }),
    })

    const hook = await pickHook({
      date: "2026-06-18",
      llm,
      firecrawlConfig: FIRECRAWL_STUB,
      search: async () => NEWS_CANDIDATES,
    })

    expect(hook.type).toBe("news")
    expect(hook.title).toContain("living water")
    expect(hook.sourceUrl).toBe("https://news.example.org/water-summit")
  })

  it("binds attribution to the selected candidate index", async () => {
    const candidates = [
      ...NEWS_CANDIDATES,
      {
        title: "Peace talks resume",
        url: "https://news.example.org/peace-talks",
        description: "Delegates return to the negotiating table.",
      },
    ]
    const llm = fakeLlm({
      devotional_news_hook: () => ({
        chosen: true,
        candidateIndex: 2,
        title: "The courage to seek peace",
        summary: "Delegates return to difficult but hopeful conversations.",
      }),
    })

    const hook = await pickHook({
      date: "2026-06-18",
      llm,
      firecrawlConfig: FIRECRAWL_STUB,
      search: async () => candidates,
    })

    expect(hook.sourceUrl).toBe("https://news.example.org/peace-talks")
  })

  it("returns a holiday hook when the date matches the calendar table", async () => {
    // News search empty so the news branch yields nothing; LLM must not be called.
    const complete = vi.fn()
    const llm: DevotionalLlm = { model: "test-model", complete }

    const hook = await pickHook({
      date: "2026-12-25",
      llm,
      firecrawlConfig: FIRECRAWL_STUB,
      search: async () => [],
    })

    expect(hook.type).toBe("holiday")
    expect(hook.title).toBe("Christmas Day")
    expect(hook.sourceUrl).toBeNull()
    expect(complete).not.toHaveBeenCalled()
  })

  it("falls back to a question hook when news is empty and no holiday matches", async () => {
    const llm = fakeLlm({
      devotional_question_hook: () => ({
        title: "What are you waiting for today?",
        summary: "An invitation to bring the day's longing to God.",
      }),
    })

    const hook = await pickHook({
      date: "2026-06-18",
      llm,
      firecrawlConfig: FIRECRAWL_STUB,
      search: async () => [],
    })

    expect(hook.type).toBe("question")
    expect(hook.title).toBe("What are you waiting for today?")
    expect(hook.sourceUrl).toBeNull()
  })

  it("falls through to holiday/question when the LLM declines the news items", async () => {
    const llm = fakeLlm({
      devotional_news_hook: () => ({ chosen: false }),
    })

    const hook = await pickHook({
      date: "2026-12-25",
      llm,
      firecrawlConfig: FIRECRAWL_STUB,
      search: async () => NEWS_CANDIDATES,
    })

    expect(hook.type).toBe("holiday")
  })

  it("never throws when the news search fails — falls back to holiday", async () => {
    const complete = vi.fn()
    const llm: DevotionalLlm = { model: "test-model", complete }

    const hook = await pickHook({
      date: "2026-12-24",
      llm,
      firecrawlConfig: FIRECRAWL_STUB,
      search: async () => {
        throw new Error("firecrawl exploded")
      },
    })

    expect(hook.type).toBe("holiday")
    expect(hook.title).toBe("Christmas Eve")
    expect(complete).not.toHaveBeenCalled()
  })

  it("instructs the news framing to stay neutral and non-partisan", () => {
    // Guard the prompt contract (the model is mocked in behavior tests).
    expect(_internal.NEWS_SYSTEM_PROMPT).toMatch(/neutrally/i)
    expect(_internal.NEWS_SYSTEM_PROMPT).toMatch(/partisan/i)
    expect(_internal.NEWS_SYSTEM_PROMPT).toMatch(/tragedy/i)
  })

  it("keys the holiday table on the MM-DD tail of the date", () => {
    expect(_internal.holidayKey("2026-12-25")).toBe("12-25")
    expect(_internal.HOLIDAY_TABLE["12-25"]?.title).toBe("Christmas Day")
  })
})
