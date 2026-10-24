// feat-366 U2: the suggested follow-up chip block. Presentational — the
// last-turn-only placement rule lives in message-list.test.tsx.
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { FollowUps } from "./follow-ups"

function chips(): HTMLElement[] {
  return within(
    screen.getByRole("navigation", { name: "Suggested follow-up questions" }),
  ).getAllByRole("button")
}

describe("FollowUps", () => {
  it("renders one real button per question, in order", () => {
    render(
      <FollowUps
        questions={["Why pray?", "Who wrote the gospels?"]}
        onSelect={() => {}}
      />,
    )
    expect(chips().map((chip) => chip.textContent)).toEqual([
      "Why pray?",
      "Who wrote the gospels?",
    ])
    for (const chip of chips()) {
      expect(chip).toHaveAttribute("type", "button")
      expect(chip).toBeEnabled()
    }
  })

  it("delivers the clicked question's text VERBATIM (R2)", async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <FollowUps
        questions={["Why pray?", "Who wrote the gospels?"]}
        onSelect={onSelect}
      />,
    )
    await user.click(chips()[1])
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith("Who wrote the gospels?")
  })

  it("sends EXACTLY what it rendered — the WYSIWYG property (KD4)", async () => {
    // The security value of drop-never-truncate rests on rendered text ==
    // sent text: a chip's words become the person's own stored message, so
    // they must never send bytes they were not shown. Asserting the two
    // against EACH OTHER (not against a literal) is what a future `truncate`
    // or `line-clamp` class on the button would break.
    const onSelect = vi.fn()
    const user = userEvent.setup()
    const question =
      "How do I keep praying when God feels far away and silent to me?"
    render(<FollowUps questions={[question]} onSelect={onSelect} />)
    const rendered = chips()[0].textContent
    await user.click(chips()[0])
    expect(onSelect).toHaveBeenCalledWith(rendered)
  })

  it("renders a single question as one chip (the KTD4 floor, client half)", () => {
    render(<FollowUps questions={["Why pray?"]} onSelect={() => {}} />)
    expect(chips()).toHaveLength(1)
  })

  it("renders NOTHING for an empty list — no landmark, no empty container", () => {
    const { container } = render(
      <FollowUps questions={[]} onSelect={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(
      screen.queryByRole("navigation", {
        name: "Suggested follow-up questions",
      }),
    ).toBeNull()
  })

  it("renders markup-bearing text as PLAIN TEXT, never as markup", () => {
    const hostile =
      "<img src=x onerror=alert(1)> **not bold** <script>x</script>"
    const { container } = render(
      <FollowUps questions={[hostile]} onSelect={() => {}} />,
    )
    expect(chips()[0]).toHaveTextContent(hostile)
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("script")).toBeNull()
    expect(container.querySelector("strong")).toBeNull()
  })

  // SYNTHETIC FIXTURE (R3): no production state renders chips while a send is
  // blocked — a pending send replaces the last turn, and a replay-blocked
  // conversation has no hydrated turns to hang chips on. The prop and these
  // two cases are defensive only; message-list.test.tsx pins the R22 state
  // that could be mistaken for this one.
  describe("disabled (synthetic — unreachable from production state)", () => {
    it("keeps the chips VISIBLE but inert", () => {
      render(
        <FollowUps questions={["Why pray?"]} disabled onSelect={() => {}} />,
      )
      expect(chips()[0]).toBeVisible()
      expect(chips()[0]).toBeDisabled()
    })

    it("does not call onSelect on a click", async () => {
      const onSelect = vi.fn()
      const user = userEvent.setup()
      render(
        <FollowUps questions={["Why pray?"]} disabled onSelect={onSelect} />,
      )
      await user.click(chips()[0])
      expect(onSelect).not.toHaveBeenCalled()
    })
  })
})
