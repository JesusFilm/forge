import { adminGraphql } from "../../../admin"

/**
 * QuizButtonBlock is only valid inside SectionContentBlock — never at
 * the top level. The fragment is selected via the SectionBlock content
 * union; do NOT use it for top-level dispatch.
 */
export const adminQuizButtonFragment = adminGraphql(`
  fragment AdminQuizButton on QuizButtonBlock @_unmask {
    __typename
    t
    sectionKey
    buttonText
    iframeSrc
  }
`)
