// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

extension ForgeSchema {
  struct BibleQuotesCarouselFields: ForgeSchema.SelectionSet, Fragment {
    static var fragmentDefinition: StaticString {
      #"fragment BibleQuotesCarouselFields on ComponentSectionsBibleQuotesCarousel { __typename id sectionKey carouselHeading: heading quotes { __typename id reference text backgroundImage { __typename url alternativeText } ctaLabel ctaLink attribution } }"#
    }

    let __data: DataDict
    init(_dataDict: DataDict) { __data = _dataDict }

    static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsBibleQuotesCarousel }
    static var __selections: [ApolloAPI.Selection] { [
      .field("__typename", String.self),
      .field("id", ForgeSchema.ID.self),
      .field("sectionKey", String?.self),
      .field("heading", alias: "carouselHeading", String?.self),
      .field("quotes", [Quote?]?.self),
    ] }
    static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      BibleQuotesCarouselFields.self
    ] }

    var id: ForgeSchema.ID { __data["id"] }
    var sectionKey: String? { __data["sectionKey"] }
    var carouselHeading: String? { __data["carouselHeading"] }
    var quotes: [Quote?]? { __data["quotes"] }

    /// Quote
    ///
    /// Parent Type: `ComponentSectionsBibleQuoteItem`
    struct Quote: ForgeSchema.SelectionSet {
      let __data: DataDict
      init(_dataDict: DataDict) { __data = _dataDict }

      static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsBibleQuoteItem }
      static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("id", ForgeSchema.ID.self),
        .field("reference", String.self),
        .field("text", String.self),
        .field("backgroundImage", BackgroundImage?.self),
        .field("ctaLabel", String?.self),
        .field("ctaLink", String?.self),
        .field("attribution", String?.self),
      ] }
      static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        BibleQuotesCarouselFields.Quote.self
      ] }

      var id: ForgeSchema.ID { __data["id"] }
      var reference: String { __data["reference"] }
      var text: String { __data["text"] }
      var backgroundImage: BackgroundImage? { __data["backgroundImage"] }
      var ctaLabel: String? { __data["ctaLabel"] }
      var ctaLink: String? { __data["ctaLink"] }
      var attribution: String? { __data["attribution"] }

      /// Quote.BackgroundImage
      ///
      /// Parent Type: `UploadFile`
      struct BackgroundImage: ForgeSchema.SelectionSet {
        let __data: DataDict
        init(_dataDict: DataDict) { __data = _dataDict }

        static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.UploadFile }
        static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("url", String.self),
          .field("alternativeText", String?.self),
        ] }
        static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
          BibleQuotesCarouselFields.Quote.BackgroundImage.self
        ] }

        var url: String { __data["url"] }
        var alternativeText: String? { __data["alternativeText"] }
      }
    }
  }

}