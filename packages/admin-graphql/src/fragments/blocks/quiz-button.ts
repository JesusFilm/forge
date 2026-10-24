import { adminGraphql } from "../../admin"

/** Only valid inside SectionContentBlock; never use for top-level dispatch. */
export const adminQuizButtonFragment = adminGraphql(`
  fragment AdminQuizButton on QuizButtonBlock @_unmask {
    __typename
    t
    sectionKey
    buttonText
    iframeSrc
  }
`)
