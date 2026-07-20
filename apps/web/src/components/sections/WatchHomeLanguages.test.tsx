/**
 * @vitest-environment jsdom
 */

import { renderToStaticMarkup } from "react-dom/server"
import type { AnchorHTMLAttributes } from "react"
import { describe, expect, it, vi } from "vitest"

import { ExperienceSectionRenderer } from "./index"

vi.mock("./RotatingGlobe", () => ({
  RotatingGlobe: () => (
    <span
      role="img"
      aria-label=""
      data-loading="lazy"
      data-src="/watch/images/languages/living-atlas-globe-real.webp"
    />
  ),
}))

vi.mock("next/image", () => ({
  default: ({
    alt,
    className,
    loading,
    src,
  }: {
    alt: string
    className?: string
    loading?: "eager" | "lazy"
    src: string
  }) => (
    <span
      role="img"
      aria-label={alt}
      className={className}
      data-loading={loading}
      data-src={src}
    />
  ),
}))

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

function renderLivingAtlas() {
  const html = renderToStaticMarkup(
    <ExperienceSectionRenderer
      section={
        {
          __typename: "WatchHomeLanguagesBlock",
          t: "watchHomeLanguages",
          sectionKey: "watch-home-languages",
        } as never
      }
    />,
  )
  const container = document.createElement("div")
  container.innerHTML = html
  return container
}

describe("WatchHomeLanguages", () => {
  it("server-renders the Living Atlas block with the canonical language CTA", () => {
    const container = renderLivingAtlas()
    const section = container.querySelector(
      '[data-testid="watch-home-languages"]',
    )

    expect(section).not.toBeNull()
    expect(section?.textContent).toContain("A story for every language.")
    expect(section?.textContent).toContain("Kiswahili")
    expect(section?.textContent).toContain("العربية")
    expect(section?.textContent).toContain("हिन्दी")
    expect(section?.textContent).toContain("日本語")
    expect(
      section?.querySelector('a[href="/languages"]')?.textContent,
    ).toContain("Explore all languages")
    expect(
      section?.querySelector('[role="img"]')?.getAttribute("data-src"),
    ).toBe("/watch/images/languages/living-atlas-globe-real.webp")
    expect(
      section?.querySelector('[role="img"]')?.getAttribute("data-loading"),
    ).toBe("lazy")
  })

  it("keeps animation decorative and exposes the section copy semantically", () => {
    const container = renderLivingAtlas()
    const visual = container.querySelector(
      '[data-testid="living-atlas-visual"]',
    )

    expect(container.querySelector("h2")?.textContent).toBe(
      "A story for every language.",
    )
    expect(visual?.getAttribute("aria-hidden")).toBe("true")
    const globeMotion = visual?.querySelector(".living-atlas-globe-motion")

    expect(globeMotion).not.toBeNull()
    expect(
      globeMotion?.querySelector(".living-atlas-globe-mask"),
    ).not.toBeNull()
    expect(
      globeMotion?.querySelector(".living-atlas-atmosphere"),
    ).not.toBeNull()
    expect(globeMotion?.querySelector(".living-atlas-shimmer")).not.toBeNull()
    expect(visual?.querySelectorAll(".living-atlas-stars")).toHaveLength(2)
  })
})
