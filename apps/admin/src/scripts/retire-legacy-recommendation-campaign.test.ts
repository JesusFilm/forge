import { describe, expect, it } from "vitest"
import { parseRetirementCampaignArguments } from "./retire-legacy-recommendation-campaign"

const execution = [
  "--plan",
  "/private/plan.json",
  "--holds",
  "/private/holds.json",
  "--capacity",
  "/private/capacity.json",
  "--batch-dir",
  "/private/batches",
  "--max-batches",
  "10",
  "--confirm-plan",
  "a".repeat(64),
  "--confirm-target",
  "b".repeat(64),
]

describe("retirement campaign command admission", () => {
  it("requires an explicit execute flag alongside both reviewed confirmations", () => {
    expect(() => parseRetirementCampaignArguments(execution)).toThrow()
    expect(
      parseRetirementCampaignArguments([...execution, "--execute"]).execute,
    ).toBe(true)
    expect(() =>
      parseRetirementCampaignArguments([
        ...execution,
        "--execute",
        "--execute",
      ]),
    ).toThrow()
    expect(() =>
      parseRetirementCampaignArguments(
        execution.filter((key) => key !== "--confirm-plan"),
      ),
    ).toThrow()
  })
})
