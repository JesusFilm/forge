import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { UntrustedLink } from "./untrusted-link"

describe("UntrustedLink", () => {
  it("renders an https href as a hardened new-tab anchor", () => {
    render(
      <UntrustedLink href="https://www.jesusfilm.org/watch">
        Watch
      </UntrustedLink>,
    )
    const link = screen.getByRole("link")
    expect(link).toHaveAttribute("href", "https://www.jesusfilm.org/watch")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(link).toHaveTextContent("Watch")
    expect(link).toHaveTextContent("(opens in a new tab)")
  })

  it("renders children as plain text for a non-https href", () => {
    const { container } = render(
      <UntrustedLink href="http://example.com">Label</UntrustedLink>,
    )
    expect(container.querySelector("a")).toBeNull()
    expect(container.textContent).toBe("Label")
  })

  it("renders children as plain text when href is undefined", () => {
    const { container } = render(
      <UntrustedLink href={undefined}>Unresolved</UntrustedLink>,
    )
    expect(container.querySelector("a")).toBeNull()
    expect(container.textContent).toBe("Unresolved")
  })

  it("prefers the fallback node when the gate rejects", () => {
    const { container } = render(
      <UntrustedLink
        href="javascript:alert(1)"
        fallback={<span data-styled>Styled label</span>}
      >
        Plain label
      </UntrustedLink>,
    )
    expect(container.querySelector("a")).toBeNull()
    expect(container.querySelector("[data-styled]")).toHaveTextContent(
      "Styled label",
    )
  })
})
