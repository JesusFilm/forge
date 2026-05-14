import { adminGraphql } from "../../../admin"

export const adminRelatedQuestionsFragment = adminGraphql(`
  fragment AdminRelatedQuestions on RelatedQuestionsBlock @_unmask {
    __typename
    t
    sectionKey
    heading
    ctaEnabled
    ctaLabel
    ctaLink
    imageUrl
    imageAssetId
    backgroundColor
    questions {
      question
      answer
    }
  }
`)
