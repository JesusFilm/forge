import { renderToString } from "react-dom/server"
import { setRequestLocale } from "next-intl/server"
import { describe, expect, it } from "vitest"

import { ExperienceError } from "@/components/ExperienceError"

describe("ExperienceError", () => {
  it("renders known page errors once in Russian", () => {
    setRequestLocale("ru")
    const html = renderToString(
      <ExperienceError message="Something went wrong loading this page." />,
    )

    expect(html).toContain("Не удалось загрузить страницу: Произошла ошибка.")
    expect(html).not.toContain(
      "Не удалось загрузить страницу: Не удалось загрузить страницу.",
    )
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
