import { graphql } from "@forge/graphql"

export const relatedQuestionsFragment = graphql(`
  fragment RelatedQuestions on ComponentSectionsRelatedQuestions @_unmask {
    id
    sectionKey
    heading
    ctaLabel
    ctaLink
    questions {
      id
      question
      answer
    }
  }
`)
