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
      case "ComponentSectionsCta": return ForgeSchema.Objects.ComponentSectionsCta
      case "ComponentSectionsInfoBlock": return ForgeSchema.Objects.ComponentSectionsInfoBlock
      case "ComponentSectionsInfoBlocks": return ForgeSchema.Objects.ComponentSectionsInfoBlocks
      case "ComponentSectionsMediaCollection": return ForgeSchema.Objects.ComponentSectionsMediaCollection
      case "ComponentSectionsPromoBanner": return ForgeSchema.Objects.ComponentSectionsPromoBanner
      case "Error": return ForgeSchema.Objects.Error_Object
      case "Experience": return ForgeSchema.Objects.Experience
      case "Query": return ForgeSchema.Objects.Query
      default: return nil
      }
    }
  }

  enum Objects {}
  enum Interfaces {}
  enum Unions {}

}