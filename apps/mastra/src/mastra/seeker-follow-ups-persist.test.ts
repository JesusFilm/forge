import { describe, expect, it, vi } from "vitest"

import { SEEKER_FOLLOW_UPS_METADATA_KEY } from "./seeker-follow-ups"
import {
  FOLLOW_UPS_CARRIER_SCAN_PAGE_SIZE,
  persistSeekerFollowUps,
  type FollowUpsPersistMemory,
} from "./seeker-follow-ups-persist"

const THREAD = "thread-1"
const RESOURCE = "user:sub-1"
const QUESTIONS = ["Why pray?", "Who wrote the gospels?"]

function storedMessage(
  id: string,
  role: string,
  parts: unknown[],
  over: Record<string, unknown> = {},
): unknown {
  return {
    id,
    role,
    threadId: THREAD,
    resourceId: RESOURCE,
    createdAt: "2026-08-18T12:00:00.000Z",
    content: { format: 2, parts },
    ...over,
  }
}

function textPart(text: string): unknown {
  return { type: "text", text }
}

function toolPart(): unknown {
  return {
    type: "tool-invocation",
    toolInvocation: { toolName: "retrieveAnswer", result: { status: "ok" } },
  }
}

function makeMemory(overrides: {
  messages?: unknown[] | (() => unknown[])
  recallImpl?: FollowUpsPersistMemory["recall"]
  updateImpl?: FollowUpsPersistMemory["updateMessages"]
}): {
  memory: FollowUpsPersistMemory
  recallCalls: Array<{ threadId: string; resourceId: string; perPage: number }>
  updateCalls: unknown[]
} {
  const recallCalls: Array<{
    threadId: string
    resourceId: string
    perPage: number
  }> = []
  const updateCalls: unknown[] = []
  const memory: FollowUpsPersistMemory = {
    recall:
      overrides.recallImpl ??
      (async (args) => {
        recallCalls.push(args)
        const messages =
          typeof overrides.messages === "function"
            ? overrides.messages()
            : (overrides.messages ?? [])
        return { messages }
      }),
    updateMessages:
      overrides.updateImpl ??
      (async (args) => {
        updateCalls.push(args)
        return []
      }),
  }
  return { memory, recallCalls, updateCalls }
}

function persist(
  memory: FollowUpsPersistMemory,
  over: Partial<Parameters<typeof persistSeekerFollowUps>[0]> = {},
) {
  return persistSeekerFollowUps({
    memory,
    threadId: THREAD,
    resourceId: RESOURCE,
    questions: QUESTIONS,
    retryDelayMs: 1,
    ...over,
  })
}

describe("persistSeekerFollowUps — the metadata write (KTD2)", () => {
  it("writes the questions under content.metadata with NO parts key anywhere (the load-bearing no-parts pin)", async () => {
    // Stored parts are replayed to the provider on later turns; a fabricated
    // part was observed live to 400 the gateway and break the whole thread.
    const { memory, updateCalls } = makeMemory({
      messages: [
        storedMessage("u1", "user", [textPart("q")]),
        storedMessage("a1", "assistant", [textPart("the answer")]),
      ],
    })
    const outcome = await persist(memory)
    expect(outcome).toBe("persisted")
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]).toEqual({
      messages: [
        {
          id: "a1",
          content: {
            metadata: { [SEEKER_FOLLOW_UPS_METADATA_KEY]: QUESTIONS },
          },
        },
      ],
    })
    // Belt-and-braces: no "parts" key anywhere in the serialized payload.
    expect(JSON.stringify(updateCalls[0])).not.toContain('"parts"')
  })

  it("targets the trailing run's LAST text-bearing assistant message, skipping tool-only rows", async () => {
    const { memory, updateCalls } = makeMemory({
      messages: [
        storedMessage("u1", "user", [textPart("q")]),
        storedMessage("a1", "assistant", [textPart("first text")]),
        storedMessage("a2", "assistant", [textPart("final text")]),
        storedMessage("a3", "assistant", [toolPart()]),
      ],
    })
    await persist(memory)
    expect(
      (updateCalls[0] as { messages: Array<{ id: string }> }).messages[0].id,
    ).toBe("a2")
  })

  it("always passes the turn's threadId AND resourceId to recall, with an explicit page size", async () => {
    const { memory, recallCalls } = makeMemory({
      messages: [storedMessage("a1", "assistant", [textPart("t")])],
    })
    await persist(memory)
    expect(recallCalls[0]).toEqual({
      threadId: THREAD,
      resourceId: RESOURCE,
      perPage: FOLLOW_UPS_CARRIER_SCAN_PAGE_SIZE,
    })
  })
})

describe("persistSeekerFollowUps — carrier resolution failure modes", () => {
  it("retries once for the finalization race, then reports no_carrier", async () => {
    const { memory, recallCalls } = makeMemory({ messages: [] })
    const outcome = await persist(memory)
    expect(outcome).toBe("no_carrier")
    expect(recallCalls).toHaveLength(2)
  })

  it("finds the carrier on the retry when the store catches up", async () => {
    let call = 0
    const { memory, updateCalls } = makeMemory({
      messages: () => {
        call += 1
        return call === 1
          ? []
          : [storedMessage("a1", "assistant", [textPart("late row")])]
      },
    })
    const outcome = await persist(memory)
    expect(outcome).toBe("persisted")
    expect(updateCalls).toHaveLength(1)
  })

  it("REJECTS a trailing assistant row that predates the turn — a lagging store must retry, never misattribute (adversarial finding)", async () => {
    // The multi-turn lag shape: THIS turn's rows are not written yet, so the
    // trailing recalled row is the PREVIOUS turn's answer. A positional scan
    // would select it and silently write this turn's questions onto the old
    // message; the turn-identity check must fail closed instead, letting the
    // retry find the fresh row.
    const turnStartedAtMs = Date.parse("2026-08-19T12:00:00.000Z")
    let call = 0
    const { memory, updateCalls } = makeMemory({
      messages: () => {
        call += 1
        const stale = [
          storedMessage("u1", "user", [textPart("old question")]),
          storedMessage("a1", "assistant", [textPart("old answer")], {
            createdAt: "2026-08-19T11:59:00.000Z",
          }),
        ]
        if (call === 1) return stale
        return [
          ...stale,
          storedMessage("u2", "user", [textPart("this question")], {
            createdAt: "2026-08-19T12:00:01.000Z",
          }),
          storedMessage("a2", "assistant", [textPart("this answer")], {
            createdAt: "2026-08-19T12:00:02.000Z",
          }),
        ]
      },
    })
    const outcome = await persist(memory, { turnStartedAtMs })
    expect(outcome).toBe("persisted")
    expect(updateCalls).toHaveLength(1)
    expect(
      (updateCalls[0] as { messages: Array<{ id: string }> }).messages[0].id,
    ).toBe("a2")
  })

  it("reports no_carrier when the store NEVER catches up — the stale prior-turn row is refused on both attempts", async () => {
    const turnStartedAtMs = Date.parse("2026-08-19T12:00:00.000Z")
    const { memory, updateCalls, recallCalls } = makeMemory({
      messages: [
        storedMessage("a1", "assistant", [textPart("old answer")], {
          createdAt: "2026-08-19T11:59:00.000Z",
        }),
      ],
    })
    const outcome = await persist(memory, { turnStartedAtMs })
    expect(outcome).toBe("no_carrier")
    expect(updateCalls).toHaveLength(0)
    expect(recallCalls).toHaveLength(2)
  })

  // The UPPER-bound half of the turn-identity window. The backwards walk
  // reaches the NEWER answer before it can ever see the user row that would
  // have stopped it, so the role rung does NOT close this case — only the
  // turnEndedAtMs bound does. Falsify by deleting the upper-bound branch in
  // resolveCarrier: this returns "persisted" against id "a3".
  it("REJECTS a trailing assistant row created AFTER the turn ended — a newer turn's answer must never receive this turn's chips", async () => {
    const turnStartedAtMs = Date.parse("2026-08-19T12:00:00.000Z")
    const turnEndedAtMs = Date.parse("2026-08-19T12:00:05.000Z")
    const { memory, updateCalls } = makeMemory({
      messages: [
        // This turn's own answer, correctly inside the window.
        storedMessage("a1", "assistant", [textPart("this turn's answer")], {
          createdAt: "2026-08-19T12:00:02.000Z",
        }),
        // A newer turn opened and answered while this persist was in flight.
        storedMessage("u2", "user", [textPart("a newer question")], {
          createdAt: "2026-08-19T12:00:07.000Z",
        }),
        storedMessage("a3", "assistant", [textPart("a newer answer")], {
          createdAt: "2026-08-19T12:00:09.000Z",
        }),
      ],
    })
    const outcome = await persist(memory, { turnStartedAtMs, turnEndedAtMs })
    expect(outcome).toBe("no_carrier")
    expect(updateCalls).toHaveLength(0)
  })

  it("still writes when the carrier sits INSIDE the turn window (anti-vacuous companion to the upper bound)", async () => {
    const { memory, updateCalls } = makeMemory({
      messages: [
        storedMessage("a1", "assistant", [textPart("this turn's answer")], {
          createdAt: "2026-08-19T12:00:02.000Z",
        }),
      ],
    })
    const outcome = await persist(memory, {
      turnStartedAtMs: Date.parse("2026-08-19T12:00:00.000Z"),
      turnEndedAtMs: Date.parse("2026-08-19T12:00:05.000Z"),
    })
    expect(outcome).toBe("persisted")
    expect(updateCalls).toHaveLength(1)
  })

  it("treats an unparseable carrier createdAt as stale when the turn identity is known (fail closed)", async () => {
    const { memory, updateCalls } = makeMemory({
      messages: [
        storedMessage("a1", "assistant", [textPart("t")], {
          createdAt: "not-a-date",
        }),
      ],
    })
    const outcome = await persist(memory, {
      turnStartedAtMs: Date.parse("2026-08-19T12:00:00.000Z"),
    })
    expect(outcome).toBe("no_carrier")
    expect(updateCalls).toHaveLength(0)
  })

  it("reports no_carrier when the trailing run has no text-bearing assistant row", async () => {
    const { memory, updateCalls } = makeMemory({
      messages: [
        storedMessage("a1", "assistant", [textPart("old turn")]),
        storedMessage("u2", "user", [textPart("newer question")]),
      ],
    })
    const outcome = await persist(memory)
    expect(outcome).toBe("no_carrier")
    expect(updateCalls).toHaveLength(0)
  })

  it.each([
    ["foreign threadId", { threadId: "someone-elses-thread" }],
    ["foreign resourceId", { resourceId: "user:someone-else" }],
    ["absent threadId", { threadId: undefined }],
    ["absent resourceId", { resourceId: undefined }],
  ])(
    "refuses to write through a carrier with a %s (client-side ownership re-check, fail closed)",
    async (_label, over) => {
      // The store's own filter is a dependency-interpreted predicate every
      // test double implements correctly by construction (the
      // single-predicate blast-radius law) — so the module re-checks the
      // returned row itself before updateMessages, which takes bare message
      // ids with no thread scope.
      const { memory, updateCalls } = makeMemory({
        messages: [storedMessage("a1", "assistant", [textPart("t")], over)],
      })
      const outcome = await persist(memory)
      expect(outcome).toBe("no_carrier")
      expect(updateCalls).toHaveLength(0)
    },
  )
})

describe("persistSeekerFollowUps — store failure containment (KTD6)", () => {
  it("maps a rejecting store write to store_failed, never propagating", async () => {
    const { memory } = makeMemory({
      messages: [storedMessage("a1", "assistant", [textPart("t")])],
      updateImpl: async () => {
        throw new Error("store exploded")
      },
    })
    await expect(persist(memory)).resolves.toBe("store_failed")
  })

  it("maps a SYNCHRONOUSLY throwing recall to store_failed (sync-throw containment)", async () => {
    const memory = {
      recall: () => {
        throw new Error("sync recall explosion")
      },
      updateMessages: async () => [],
    } as unknown as FollowUpsPersistMemory
    await expect(persist(memory)).resolves.toBe("store_failed")
  })

  it("bounds a hung store by its own budget as timeout", async () => {
    const { memory } = makeMemory({
      recallImpl: () => new Promise(() => {}),
    })
    const started = Date.now()
    const outcome = await persist(memory, { budgetMs: 25 })
    expect(outcome).toBe("timeout")
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it("bounds a hung WRITE (post-recall) by the same budget", async () => {
    const { memory } = makeMemory({
      messages: [storedMessage("a1", "assistant", [textPart("t")])],
      updateImpl: () => new Promise(() => {}),
    })
    const outcome = await persist(memory, { budgetMs: 25 })
    expect(outcome).toBe("timeout")
  })

  // settleWithinBudget rejects the CALLER at the budget but does not cancel
  // the detached body, so without the post-carrier budget re-check a scan that
  // overran would still land its write afterwards — onto a row that may by
  // then belong to a later turn. Falsify by deleting that re-check: updateCalls
  // becomes length 1.
  it("refuses the write when the budget expired during the carrier scan (no late write after a timeout)", async () => {
    const { memory, updateCalls } = makeMemory({
      // Recall resolves only AFTER the budget has already fired.
      recallImpl: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40))
        return {
          messages: [storedMessage("a1", "assistant", [textPart("answer")])],
        }
      },
    })
    const outcome = await persist(memory, { budgetMs: 10 })
    expect(outcome).toBe("timeout")
    // Let the detached body run to completion before asserting on it.
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(updateCalls).toHaveLength(0)
  })

  it("emits no console output on any failure path (R9 — enum outcomes only)", async () => {
    const logSpy = vi.spyOn(console, "log")
    const warnSpy = vi.spyOn(console, "warn")
    const errorSpy = vi.spyOn(console, "error")
    const { memory } = makeMemory({
      messages: [storedMessage("a1", "assistant", [textPart("t")])],
      updateImpl: async () => {
        throw new Error("SECRET-STORE-DETAIL exploded")
      },
    })
    await persist(memory)
    const lines = [logSpy, warnSpy, errorSpy]
      .flatMap((spy) => spy.mock.calls)
      .map((call) => call.map(String).join(" "))
    expect(lines.some((line) => line.includes("SECRET-STORE-DETAIL"))).toBe(
      false,
    )
    vi.restoreAllMocks()
  })
})
