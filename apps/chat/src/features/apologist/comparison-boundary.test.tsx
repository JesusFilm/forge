import { fireEvent, render, screen } from "@testing-library/react"
import { createRef } from "react"
import { expect, it, vi } from "vitest"
import { useConversations } from "@/lib/use-conversations"
import { ComparisonBoundary } from "./comparison-boundary"
vi.mock("./comparison-view", () => {
  throw new Error("load failed")
})
it("contains a rejected lazy import and provides an exit without losing the owner's draft", async () => {
  const exit = vi.fn()
  const error = vi.spyOn(console, "error").mockImplementation(() => {})
  function Harness() {
    const forge = useConversations(false)
    return (
      <>
        <input
          aria-label="Saved draft"
          value={forge.draft}
          onChange={(event) => forge.setDraft(event.target.value)}
        />
        <ComparisonBoundary
          forge={forge}
          onExit={exit}
          composerRef={createRef()}
        />
      </>
    )
  }
  render(<Harness />)
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Keep this draft" },
  })
  await screen.findByText("Comparison couldn't be opened.")
  fireEvent.click(screen.getByText("Return to Forge"))
  expect(exit).toHaveBeenCalledOnce()
  expect(screen.getByRole("textbox")).toHaveValue("Keep this draft")
  error.mockRestore()
})
