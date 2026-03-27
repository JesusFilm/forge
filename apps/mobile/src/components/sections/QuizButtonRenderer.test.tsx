import { createElement } from "react"

import type { QuizButtonSection } from "../../lib/sectionModels"
import { QuizButtonRenderer } from "./QuizButtonRenderer"

const quizButton: QuizButtonSection = {
  kind: "quizButton",
  id: "qb-1",
  sectionKey: null,
  buttonText: "What's your next step of faith?",
  iframeSrc: "https://www.nextstep.is/quiz/easter",
}

describe("QuizButtonRenderer", () => {
  it("renders without throwing for a valid URL", () => {
    expect(() =>
      createElement(QuizButtonRenderer, { section: quizButton }),
    ).not.toThrow()
  })

  it("renders without throwing for an invalid URL", () => {
    const invalid: QuizButtonSection = {
      ...quizButton,
      iframeSrc: "http://evil.com/quiz",
    }
    expect(() =>
      createElement(QuizButtonRenderer, { section: invalid }),
    ).not.toThrow()
  })
})
