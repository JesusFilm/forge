import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { AppShell } from "@/components/shell/app-shell"
import { encodeSseFrame } from "@/lib/sse"
afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, "", "/")
})
function setup() {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    if (String(input).includes("/api/history/list"))
      return Response.json({ threads: [], hasMore: false })
    if (String(input).includes("/api/apologist"))
      return new Response(
        encodeSseFrame("meta", { source: "production", version: 1 }) +
          encodeSseFrame("token", { text: "Apologist answer" }) +
          encodeSseFrame("done", {}),
      )
    if (String(input).includes("/api/seeker"))
      return new Response(
        encodeSseFrame("result", {
          text: "Forge answer",
          grounded: false,
          sources: [],
          followUps: ["Why is that?"],
        }),
      )
    throw new Error("unexpected fetch")
  })
  vi.stubGlobal("fetch", fetcher)
  return fetcher
}
it("preserves the draft on entry/exit and resets comparison on New even when the ID stays empty", async () => {
  setup()
  render(<AppShell seekerEnabled comparisonEnabled />)
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "My draft" },
  })
  fireEvent.click(
    screen.getByRole("button", { name: "Compare with Apologist" }),
  )
  await screen.findByText("Compare answers")
  expect(screen.getByRole("textbox")).toHaveValue("My draft")
  fireEvent.click(screen.getByRole("button", { name: "Return to Forge" }))
  expect(screen.getByRole("textbox")).toHaveValue("My draft")
  fireEvent.click(
    screen.getByRole("button", { name: "Compare with Apologist" }),
  )
  await screen.findByText("Compare answers")
  fireEvent.click(screen.getByRole("button", { name: "New conversation" }))
  expect(screen.queryByText("Compare answers")).not.toBeInTheDocument()
  expect(
    screen.getByRole("button", { name: "Compare with Apologist" }),
  ).toBeVisible()
})
it("keeps comparison through Forge URL minting and returns to Forge without restoring Apologist", async () => {
  const fetcher = setup()
  render(<AppShell seekerEnabled comparisonEnabled />)
  fireEvent.click(
    screen.getByRole("button", { name: "Compare with Apologist" }),
  )
  await screen.findByText("Compare answers")
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Shared question" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  await screen.findByText("Apologist answer")
  await screen.findByText("Forge answer")
  await waitFor(() => expect(window.location.pathname).toMatch(/^\/c\//))
  expect(screen.getByText("Compare answers")).toBeVisible()
  expect(
    fetcher.mock.calls.filter(([url]) =>
      String(url).includes("/api/apologist"),
    ),
  ).toHaveLength(1)
  fireEvent.click(screen.getByRole("button", { name: "Return to Forge" }))
  expect(screen.queryByText("Apologist answer")).not.toBeInTheDocument()
  expect(screen.getByText("Forge answer")).toBeVisible()
  expect(screen.queryByText("Compare with Apologist")).not.toBeInTheDocument()
})
it("does not expose entry to an ungranted shell even with a fabricated capability", () => {
  setup()
  render(<AppShell comparisonEnabled seekerEnabled={false} />)
  expect(screen.queryByText("Compare with Apologist")).not.toBeInTheDocument()
})
