// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

extension ForgeSchema {
  struct CtaFields: ForgeSchema.SelectionSet, Fragment {
    static var fragmentDefinition: StaticString {
      #"fragment CtaFields on ComponentSectionsCta { __typename id sectionKey ctaHeading: heading body buttonLabel buttonLink ctaVariant: variant }"#
    }

    let __data: DataDict
    init(_dataDict: DataDict) { __data = _dataDict }

    static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsCta }
    static var __selections: [ApolloAPI.Selection] { [
      .field("__typename", String.self),
      .field("id", ForgeSchema.ID.self),
      .field("sectionKey", String?.self),
      .field("heading", alias: "ctaHeading", String?.self),
      .field("body", String?.self),
      .field("buttonLabel", String.self),
      .field("buttonLink", String?.self),
      .field("variant", alias: "ctaVariant", GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSCTA_VARIANT>?.self),
    ] }
    static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      CtaFields.self
    ] }

    var id: ForgeSchema.ID { __data["id"] }
    var sectionKey: String? { __data["sectionKey"] }
    var ctaHeading: String? { __data["ctaHeading"] }
    var body: String? { __data["body"] }
    var buttonLabel: String { __data["buttonLabel"] }
    var buttonLink: String? { __data["buttonLink"] }
    var ctaVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSCTA_VARIANT>? { __data["ctaVariant"] }
  }

}