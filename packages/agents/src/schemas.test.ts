import { describe, expect, it } from "vitest"
import {
  sharedAgentDraftPatchSchema,
  sharedAgentStructuredResultSchema,
} from "./schemas"

describe("@forge/agents schemas", () => {
  it("rejects empty draft patches", () => {
    const result = sharedAgentDraftPatchSchema.safeParse({
      targetLanguage: "Spanish",
    })

    expect(result.success).toBe(false)
  })

  it("accepts structured agent results with a metadata patch", () => {
    const result = sharedAgentStructuredResultSchema.safeParse({
      summary: "Localized Spanish metadata draft ready for approval.",
      markdown: "## Proposed metadata\n\n- Title\n- Description",
      confidence: "high",
      recommendations: [
        {
          label: "Use a search-facing Spanish title",
          rationale: "The source transcript emphasizes hope and resurrection.",
          appliesTo: ["title", "description"],
        },
      ],
      draftPatch: {
        title: "Esperanza en la resurreccion",
        description: "Una introduccion breve al mensaje de esperanza.",
        targetLanguage: "Spanish",
      },
      followupActions: ["Review localized slug before publish."],
    })

    expect(result.success).toBe(true)
  })
})
