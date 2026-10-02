import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { createRef } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { useConversations } from "@/lib/use-conversations"
import ComparisonView from "./comparison-view"
vi.mock("./client", () => ({
  requestApologist: vi.fn(async (_messages, signal, meta, token) => {
    meta({ source: "fallback" })
    token("Apologist answer")
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", resolve, { once: true }),
    )
  }),
}))
vi.mock("@/lib/chat-stub", () => ({
  streamReply: vi.fn(async () => ({
    ok: true,
    text: "Forge answer",
    engine: "seeker",
    sources: [],
    followUps: ["Tell me more"],
  })),
}))
function Harness() {
  const forge = useConversations(false)
  return (
    <ComparisonView forge={forge} onExit={vi.fn()} composerRef={createRef()} />
  )
}
afterEach(() => vi.unstubAllGlobals())
it("uses one composer and exposes hidden-provider status without canceling it on tab changes", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  render(<Harness />)
  expect(screen.getAllByRole("textbox", { name: "Message" })).toHaveLength(1)
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Why hope?" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  await screen.findByRole("tab", { name: "Forge · complete" })
  const apologist = screen.getByRole("tab", { name: "Apologist · generating" })
  expect(screen.getByRole("textbox")).toBeDisabled()
  fireEvent.keyDown(screen.getByRole("tab", { name: "Forge · complete" }), {
    key: "ArrowRight",
  })
  expect(apologist).toHaveFocus()
  expect(apologist).toHaveAttribute("aria-selected", "true")
  expect(
    within(screen.getByRole("tabpanel", { name: "Apologist" })).getByText(
      /fallback prompt/,
    ),
  ).toBeVisible()
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Stop generating" })),
  )
  await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled())
})
