import { renderToString } from "react-dom/server"
import { setRequestLocale } from "next-intl/server"
import { describe, expect, it } from "vitest"

import { ExperienceError } from "@/components/ExperienceError"

describe("ExperienceError", () => {
  it("renders a route boundary failure as the plain sentence in Russian", () => {
    setRequestLocale("ru")
    const html = renderToString(
      <ExperienceError message="Something went wrong loading this page." />,
    )

    expect(html).toContain("Произошла ошибка.")
    expect(html).not.toContain("Не удалось загрузить страницу:")
  })

  it("does not call a route boundary failure an experience in English", () => {
    setRequestLocale("en")
    const html = renderToString(
      <ExperienceError message="Something went wrong loading this page." />,
    )

    expect(html).toContain("Something went wrong.")
    expect(html).not.toContain("experience")
  })

  it("does not expose unknown upstream English messages to Russian users", () => {
    setRequestLocale("ru")
    const html = renderToString(
      <ExperienceError message="Internal upstream resolver exploded" />,
    )

    expect(html).toContain(
      "Не удалось загрузить страницу: Произошла непредвиденная ошибка.",
    )
    expect(html).not.toContain("Internal upstream resolver exploded")
  })
})
