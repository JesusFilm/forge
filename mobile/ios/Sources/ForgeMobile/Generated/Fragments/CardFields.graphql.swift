// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

extension ForgeSchema {
  struct CardFields: ForgeSchema.SelectionSet, Fragment {
    static var fragmentDefinition: StaticString {
      #"fragment CardFields on ComponentSectionsCard { __typename id sectionKey cardTitle: title cardDescription: description media { __typename url alternativeText } link cardVariant: variant }"#
    }

    let __data: DataDict
    init(_dataDict: DataDict) { __data = _dataDict }

    static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsCard }
    static var __selections: [ApolloAPI.Selection] { [
      .field("__typename", String.self),
      .field("id", ForgeSchema.ID.self),
      .field("sectionKey", String?.self),
      .field("title", alias: "cardTitle", String.self),
      .field("description", alias: "cardDescription", String.self),
      .field("media", Media?.self),
      .field("link", String?.self),
      .field("variant", alias: "cardVariant", GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSCARD_VARIANT>?.self),
    ] }
    static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      CardFields.self
    ] }

    var id: ForgeSchema.ID { __data["id"] }
    var sectionKey: String? { __data["sectionKey"] }
    var cardTitle: String { __data["cardTitle"] }
    var cardDescription: String { __data["cardDescription"] }
    var media: Media? { __data["media"] }
    var link: String? { __data["link"] }
    var cardVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSCARD_VARIANT>? { __data["cardVariant"] }

    /// Media
    ///
    /// Parent Type: `UploadFile`
    struct Media: ForgeSchema.SelectionSet {
      let __data: DataDict
      init(_dataDict: DataDict) { __data = _dataDict }

      static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.UploadFile }
      static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("url", String.self),
        .field("alternativeText", String?.self),
      ] }
      static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        CardFields.Media.self
      ] }

      var url: String { __data["url"] }
      var alternativeText: String? { __data["alternativeText"] }
    }
  }

}