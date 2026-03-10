// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

extension ForgeSchema {
  struct TextFields: ForgeSchema.SelectionSet, Fragment {
    static var fragmentDefinition: StaticString {
      #"fragment TextFields on ComponentSectionsText { __typename id sectionKey textHeading: heading headingLevel textSubtitle: subtitle textContent: content textVariant: variant }"#
    }

    let __data: DataDict
    init(_dataDict: DataDict) { __data = _dataDict }

    static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsText }
    static var __selections: [ApolloAPI.Selection] { [
      .field("__typename", String.self),
      .field("id", ForgeSchema.ID.self),
      .field("sectionKey", String?.self),
      .field("heading", alias: "textHeading", String?.self),
      .field("headingLevel", GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSTEXT_HEADINGLEVEL>?.self),
      .field("subtitle", alias: "textSubtitle", String?.self),
      .field("content", alias: "textContent", String.self),
      .field("variant", alias: "textVariant", GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSTEXT_VARIANT>?.self),
    ] }
    static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      TextFields.self
    ] }

    var id: ForgeSchema.ID { __data["id"] }
    var sectionKey: String? { __data["sectionKey"] }
    var textHeading: String? { __data["textHeading"] }
    var headingLevel: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSTEXT_HEADINGLEVEL>? { __data["headingLevel"] }
    var textSubtitle: String? { __data["textSubtitle"] }
    var textContent: String { __data["textContent"] }
    var textVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSTEXT_VARIANT>? { __data["textVariant"] }
  }

}