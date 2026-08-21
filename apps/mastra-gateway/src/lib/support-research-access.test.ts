import { describe, expect, it } from "vitest"

import {
  isBoundedSupportResearchDryRun,
  isSupportResearchLaunchPath,
} from "./support-research-access"

function request(body: unknown) {
  return new Request("https://gateway.test/api/workflows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

describe("support research launch access", () => {
  it.each([
    ["start", true],
    ["start-async", true],
    ["runs", false],
  ])("classifies the %s operation", (operation, expected) => {
    expect(
      isSupportResearchLaunchPath([
        "workflows",
        "daily-support-research",
        operation,
      ]),
    ).toBe(expected)
  })

  it.each([1, 5])(
    "accepts a bounded dry run of %i conversation(s)",
    async (max) => {
      await expect(
        isBoundedSupportResearchDryRun(
          request({
            inputData: {
              dryRun: true,
              maxConversations: max,
              idempotencyKey: "operator-check",
            },
          }),
        ),
      ).resolves.toBe(true)
    },
  )

  it.each([
    ["malformed JSON", "{"],
    ["array input", { inputData: [] }],
    [
      "zero limit",
      {
        inputData: { dryRun: true, maxConversations: 0, idempotencyKey: "key" },
      },
    ],
    [
      "excessive limit",
      {
        inputData: { dryRun: true, maxConversations: 6, idempotencyKey: "key" },
      },
    ],
    [
      "live run",
      {
        inputData: {
          dryRun: false,
          maxConversations: 5,
          idempotencyKey: "key",
        },
      },
    ],
    [
      "oversized key",
      {
        inputData: {
          dryRun: true,
          maxConversations: 5,
          idempotencyKey: "x".repeat(121),
        },
      },
    ],
  ])("rejects %s", async (_, body) => {
    await expect(isBoundedSupportResearchDryRun(request(body))).resolves.toBe(
      false,
    )
  })
})
