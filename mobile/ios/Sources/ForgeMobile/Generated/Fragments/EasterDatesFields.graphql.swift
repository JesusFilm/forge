// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

extension ForgeSchema {
  struct EasterDatesFields: ForgeSchema.SelectionSet, Fragment {
    static var fragmentDefinition: StaticString {
      #"fragment EasterDatesFields on ComponentSectionsEasterDates { __typename id sectionKey easterDatesTitle westernEasterLabel orthodoxEasterLabel passoverLabel locale }"#
    }

    let __data: DataDict
    init(_dataDict: DataDict) { __data = _dataDict }

    static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsEasterDates }
    static var __selections: [ApolloAPI.Selection] { [
      .field("__typename", String.self),
      .field("id", ForgeSchema.ID.self),
      .field("sectionKey", String?.self),
      .field("easterDatesTitle", String.self),
      .field("westernEasterLabel", String.self),
      .field("orthodoxEasterLabel", String.self),
      .field("passoverLabel", String.self),
      .field("locale", String?.self),
    ] }
    static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      EasterDatesFields.self
    ] }

    var id: ForgeSchema.ID { __data["id"] }
    var sectionKey: String? { __data["sectionKey"] }
    var easterDatesTitle: String { __data["easterDatesTitle"] }
    var westernEasterLabel: String { __data["westernEasterLabel"] }
    var orthodoxEasterLabel: String { __data["orthodoxEasterLabel"] }
    var passoverLabel: String { __data["passoverLabel"] }
    var locale: String? { __data["locale"] }
  }

}