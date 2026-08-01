import { adminGraphql } from "../../admin"

export const adminRelatedQuestionsFragment = adminGraphql(`
  fragment AdminRelatedQuestions on RelatedQuestionsBlock @_unmask {
    __typename
    t
    sectionKey
    heading
    questionsSource
    ctaEnabled
    ctaLabel
    ctaLink
    imageAssetId
    imageAsset {
      id
      previewUrl
      blurDataUrl
      dominantColor
      width
      height
    }
    backgroundColor
    questions {
      question
      answer
    }
  }
`)
