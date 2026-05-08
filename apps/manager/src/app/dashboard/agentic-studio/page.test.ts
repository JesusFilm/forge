import { describe, expect, it } from "vitest"
import AgenticStudioPage from "./page"

describe("Agentic Studio dashboard page", () => {
  it("renders an isolated Studio iframe through the Manager proxy", async () => {
    const element = await AgenticStudioPage()
    const iframe = element.props.children

    expect(element.props.className).toBe(
      "studio-page studio-page--agentic-studio",
    )
    expect(iframe.type).toBe("iframe")
    expect(iframe.props.src).toBe("/api/agentic-studio")
    expect(iframe.props.title).toBe("Agentic Studio")
    expect(iframe.props.sandbox).toContain("allow-scripts")
    expect(iframe.props.sandbox).toContain("allow-same-origin")
    expect(JSON.stringify(iframe.props)).not.toContain(
      "AGENTIC_OPERATOR_API_KEY",
    )
    expect(JSON.stringify(iframe.props)).not.toContain(
      "agentic-studio.railway.internal",
    )
  })
})
