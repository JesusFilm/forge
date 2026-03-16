import { createElement } from "react"

import type { RelatedQuestionsSection } from "../../lib/sectionModels"
import { RelatedQuestionsRenderer } from "./RelatedQuestionsRenderer"

const baseSection: RelatedQuestionsSection = {
  kind: "relatedQuestions",
  id: "rq-1",
  sectionKey: "faq",
  heading: "Related Questions",
  questions: [
    {
      id: "q1",
      question: "Why is Easter the most important Christian holiday?",
      answer: "Easter celebrates the resurrection of Jesus Christ.",
    },
    {
      id: "q2",
      question: "When is Easter celebrated?",
      answer:
        "Easter is celebrated on the first Sunday after the first full moon of spring.",
    },
  ],
}

describe("RelatedQuestionsRenderer", () => {
  it("renders without throwing with all fields", () => {
    expect(() =>
      createElement(RelatedQuestionsRenderer, { section: baseSection }),
    ).not.toThrow()
  })

  it("renders without throwing with empty questions array", () => {
    const empty: RelatedQuestionsSection = {
      ...baseSection,
      questions: [],
    }
    expect(() =>
      createElement(RelatedQuestionsRenderer, { section: empty }),
    ).not.toThrow()
  })

  it("renders without throwing with no heading", () => {
    const noHeading: RelatedQuestionsSection = {
      ...baseSection,
      heading: null,
    }
    expect(() =>
      createElement(RelatedQuestionsRenderer, { section: noHeading }),
    ).not.toThrow()
  })

  it("renders without throwing with a single question", () => {
    const single: RelatedQuestionsSection = {
      ...baseSection,
      questions: [baseSection.questions[0]],
    }
    expect(() =>
      createElement(RelatedQuestionsRenderer, { section: single }),
    ).not.toThrow()
  })
})
