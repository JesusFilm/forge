import { graphql } from "@forge/graphql"

export const quizButtonSectionFragment = graphql(`
  fragment QuizButtonSection on ComponentSectionsQuizButton @_unmask {
    id
    buttonText
    iframeSrc
  }
`)
