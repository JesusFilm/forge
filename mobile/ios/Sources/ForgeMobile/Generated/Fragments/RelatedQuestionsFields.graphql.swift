// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

extension ForgeSchema {
  struct RelatedQuestionsFields: ForgeSchema.SelectionSet, Fragment {
    static var fragmentDefinition: StaticString {
      #"fragment RelatedQuestionsFields on ComponentSectionsRelatedQuestions { __typename id sectionKey relatedQuestionsHeading: heading questions { __typename id question answer } }"#
    }

    let __data: DataDict
    init(_dataDict: DataDict) { __data = _dataDict }

    static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsRelatedQuestions }
    static var __selections: [ApolloAPI.Selection] { [
      .field("__typename", String.self),
      .field("id", ForgeSchema.ID.self),
      .field("sectionKey", String?.self),
      .field("heading", alias: "relatedQuestionsHeading", String?.self),
      .field("questions", [Question?]?.self),
    ] }
    static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      RelatedQuestionsFields.self
    ] }

    var id: ForgeSchema.ID { __data["id"] }
    var sectionKey: String? { __data["sectionKey"] }
    var relatedQuestionsHeading: String? { __data["relatedQuestionsHeading"] }
    var questions: [Question?]? { __data["questions"] }

    /// Question
    ///
    /// Parent Type: `ComponentSectionsRelatedQuestionItem`
    struct Question: ForgeSchema.SelectionSet {
      let __data: DataDict
      init(_dataDict: DataDict) { __data = _dataDict }

      static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsRelatedQuestionItem }
      static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("id", ForgeSchema.ID.self),
        .field("question", String.self),
        .field("answer", String.self),
      ] }
      static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        RelatedQuestionsFields.Question.self
      ] }

      var id: ForgeSchema.ID { __data["id"] }
      var question: String { __data["question"] }
      var answer: String { __data["answer"] }
    }
  }

}