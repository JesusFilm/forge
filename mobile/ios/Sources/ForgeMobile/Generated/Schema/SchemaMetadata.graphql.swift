// @generated
// This file was automatically generated and should not be edited.

import ApolloAPI

protocol ForgeSchema_SelectionSet: ApolloAPI.SelectionSet & ApolloAPI.RootSelectionSet
where Schema == ForgeSchema.SchemaMetadata {}

protocol ForgeSchema_InlineFragment: ApolloAPI.SelectionSet & ApolloAPI.InlineFragment
where Schema == ForgeSchema.SchemaMetadata {}

protocol ForgeSchema_MutableSelectionSet: ApolloAPI.MutableRootSelectionSet
where Schema == ForgeSchema.SchemaMetadata {}

protocol ForgeSchema_MutableInlineFragment: ApolloAPI.MutableSelectionSet & ApolloAPI.InlineFragment
where Schema == ForgeSchema.SchemaMetadata {}

extension ForgeSchema {
  typealias SelectionSet = ForgeSchema_SelectionSet

  typealias InlineFragment = ForgeSchema_InlineFragment

  typealias MutableSelectionSet = ForgeSchema_MutableSelectionSet

  typealias MutableInlineFragment = ForgeSchema_MutableInlineFragment

  enum SchemaMetadata: ApolloAPI.SchemaMetadata {
    static let configuration: any ApolloAPI.SchemaConfiguration.Type = SchemaConfiguration.self

    static func objectType(forTypename typename: String) -> ApolloAPI.Object? {
      switch typename {
      case "ComponentSectionsBibleQuoteItem": return ForgeSchema.Objects.ComponentSectionsBibleQuoteItem
      case "ComponentSectionsBibleQuotesCarousel": return ForgeSchema.Objects.ComponentSectionsBibleQuotesCarousel
      case "ComponentSectionsCard": return ForgeSchema.Objects.ComponentSectionsCard
      case "ComponentSectionsContainer": return ForgeSchema.Objects.ComponentSectionsContainer
      case "ComponentSectionsContainerSlot": return ForgeSchema.Objects.ComponentSectionsContainerSlot
      case "ComponentSectionsCta": return ForgeSchema.Objects.ComponentSectionsCta
      case "ComponentSectionsEasterDates": return ForgeSchema.Objects.ComponentSectionsEasterDates
      case "ComponentSectionsInfoBlocks": return ForgeSchema.Objects.ComponentSectionsInfoBlocks
      case "ComponentSectionsMediaCollection": return ForgeSchema.Objects.ComponentSectionsMediaCollection
      case "ComponentSectionsMediaCollectionItem": return ForgeSchema.Objects.ComponentSectionsMediaCollectionItem
      case "ComponentSectionsPromoBanner": return ForgeSchema.Objects.ComponentSectionsPromoBanner
      case "ComponentSectionsRelatedQuestionItem": return ForgeSchema.Objects.ComponentSectionsRelatedQuestionItem
      case "ComponentSectionsRelatedQuestions": return ForgeSchema.Objects.ComponentSectionsRelatedQuestions
      case "ComponentSectionsSection": return ForgeSchema.Objects.ComponentSectionsSection
      case "ComponentSectionsText": return ForgeSchema.Objects.ComponentSectionsText
      case "ComponentSectionsVideo": return ForgeSchema.Objects.ComponentSectionsVideo
      case "ComponentSectionsVideoHero": return ForgeSchema.Objects.ComponentSectionsVideoHero
      case "Error": return ForgeSchema.Objects.Error_Object
      case "Experience": return ForgeSchema.Objects.Experience
      case "Query": return ForgeSchema.Objects.Query
      case "UploadFile": return ForgeSchema.Objects.UploadFile
      case "Video": return ForgeSchema.Objects.Video
      default: return nil
      }
    }
  }

  enum Objects {}
  enum Interfaces {}
  enum Unions {}

}