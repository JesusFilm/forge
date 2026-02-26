// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

extension ForgeSchema {
  class GetWatchExperienceQuery: GraphQLQuery {
    static let operationName: String = "GetWatchExperience"
    static let operationDocument: ApolloAPI.OperationDocument = .init(
      definition: .init(
        #"query GetWatchExperience($locale: I18NLocaleCode!, $filters: ExperienceFiltersInput!) { experiences(filters: $filters, locale: $locale) { __typename documentId slug publishedAt sections { __typename ... on ComponentSectionsMediaCollection { id title subtitle mediaCollectionDescription: description categoryLabel mediaCollectionCtaLink: ctaLink showItemNumbers variant } ... on ComponentSectionsPromoBanner { id promoBannerHeading: heading promoBannerDescription: description intro promoBannerCtaLink: ctaLink } ... on ComponentSectionsInfoBlocks { id infoBlocksHeading: heading intro infoBlocksDescription: description blocks { __typename id title description icon } } ... on ComponentSectionsCta { id ctaHeading: heading body buttonLabel buttonLink } } } }"#
      ))

    public var locale: I18NLocaleCode
    public var filters: ExperienceFiltersInput

    public init(
      locale: I18NLocaleCode,
      filters: ExperienceFiltersInput
    ) {
      self.locale = locale
      self.filters = filters
    }

    public var __variables: Variables? { [
      "locale": locale,
      "filters": filters
    ] }

    struct Data: ForgeSchema.SelectionSet {
      let __data: DataDict
      init(_dataDict: DataDict) { __data = _dataDict }

      static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.Query }
      static var __selections: [ApolloAPI.Selection] { [
        .field("experiences", [Experience?].self, arguments: [
          "filters": .variable("filters"),
          "locale": .variable("locale")
        ]),
      ] }
      static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        GetWatchExperienceQuery.Data.self
      ] }

      var experiences: [Experience?] { __data["experiences"] }

      /// Experience
      ///
      /// Parent Type: `Experience`
      struct Experience: ForgeSchema.SelectionSet {
        let __data: DataDict
        init(_dataDict: DataDict) { __data = _dataDict }

        static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.Experience }
        static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("documentId", ForgeSchema.ID.self),
          .field("slug", String.self),
          .field("publishedAt", ForgeSchema.DateTime?.self),
          .field("sections", [Section?]?.self),
        ] }
        static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
          GetWatchExperienceQuery.Data.Experience.self
        ] }

        var documentId: ForgeSchema.ID { __data["documentId"] }
        var slug: String { __data["slug"] }
        var publishedAt: ForgeSchema.DateTime? { __data["publishedAt"] }
        var sections: [Section?]? { __data["sections"] }

        /// Experience.Section
        ///
        /// Parent Type: `ExperienceSectionsDynamicZone`
        struct Section: ForgeSchema.SelectionSet {
          let __data: DataDict
          init(_dataDict: DataDict) { __data = _dataDict }

          static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Unions.ExperienceSectionsDynamicZone }
          static var __selections: [ApolloAPI.Selection] { [
            .field("__typename", String.self),
            .inlineFragment(AsComponentSectionsMediaCollection.self),
            .inlineFragment(AsComponentSectionsPromoBanner.self),
            .inlineFragment(AsComponentSectionsInfoBlocks.self),
            .inlineFragment(AsComponentSectionsCta.self),
          ] }
          static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
            GetWatchExperienceQuery.Data.Experience.Section.self
          ] }

          var asComponentSectionsMediaCollection: AsComponentSectionsMediaCollection? { _asInlineFragment() }
          var asComponentSectionsPromoBanner: AsComponentSectionsPromoBanner? { _asInlineFragment() }
          var asComponentSectionsInfoBlocks: AsComponentSectionsInfoBlocks? { _asInlineFragment() }
          var asComponentSectionsCta: AsComponentSectionsCta? { _asInlineFragment() }

          /// Experience.Section.AsComponentSectionsMediaCollection
          ///
          /// Parent Type: `ComponentSectionsMediaCollection`
          struct AsComponentSectionsMediaCollection: ForgeSchema.InlineFragment {
            let __data: DataDict
            init(_dataDict: DataDict) { __data = _dataDict }

            typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Section
            static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsMediaCollection }
            static var __selections: [ApolloAPI.Selection] { [
              .field("id", ForgeSchema.ID.self),
              .field("title", String?.self),
              .field("subtitle", String?.self),
              .field("description", alias: "mediaCollectionDescription", String?.self),
              .field("categoryLabel", String?.self),
              .field("ctaLink", alias: "mediaCollectionCtaLink", String?.self),
              .field("showItemNumbers", Bool?.self),
              .field("variant", GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSMEDIACOLLECTION_VARIANT>.self),
            ] }
            static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetWatchExperienceQuery.Data.Experience.Section.self,
              GetWatchExperienceQuery.Data.Experience.Section.AsComponentSectionsMediaCollection.self
            ] }

            var id: ForgeSchema.ID { __data["id"] }
            var title: String? { __data["title"] }
            var subtitle: String? { __data["subtitle"] }
            var mediaCollectionDescription: String? { __data["mediaCollectionDescription"] }
            var categoryLabel: String? { __data["categoryLabel"] }
            var mediaCollectionCtaLink: String? { __data["mediaCollectionCtaLink"] }
            var showItemNumbers: Bool? { __data["showItemNumbers"] }
            var variant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSMEDIACOLLECTION_VARIANT> { __data["variant"] }
          }

          /// Experience.Section.AsComponentSectionsPromoBanner
          ///
          /// Parent Type: `ComponentSectionsPromoBanner`
          struct AsComponentSectionsPromoBanner: ForgeSchema.InlineFragment {
            let __data: DataDict
            init(_dataDict: DataDict) { __data = _dataDict }

            typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Section
            static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsPromoBanner }
            static var __selections: [ApolloAPI.Selection] { [
              .field("id", ForgeSchema.ID.self),
              .field("heading", alias: "promoBannerHeading", String.self),
              .field("description", alias: "promoBannerDescription", String.self),
              .field("intro", String?.self),
              .field("ctaLink", alias: "promoBannerCtaLink", String.self),
            ] }
            static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetWatchExperienceQuery.Data.Experience.Section.self,
              GetWatchExperienceQuery.Data.Experience.Section.AsComponentSectionsPromoBanner.self
            ] }

            var id: ForgeSchema.ID { __data["id"] }
            var promoBannerHeading: String { __data["promoBannerHeading"] }
            var promoBannerDescription: String { __data["promoBannerDescription"] }
            var intro: String? { __data["intro"] }
            var promoBannerCtaLink: String { __data["promoBannerCtaLink"] }
          }

          /// Experience.Section.AsComponentSectionsInfoBlocks
          ///
          /// Parent Type: `ComponentSectionsInfoBlocks`
          struct AsComponentSectionsInfoBlocks: ForgeSchema.InlineFragment {
            let __data: DataDict
            init(_dataDict: DataDict) { __data = _dataDict }

            typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Section
            static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsInfoBlocks }
            static var __selections: [ApolloAPI.Selection] { [
              .field("id", ForgeSchema.ID.self),
              .field("heading", alias: "infoBlocksHeading", String?.self),
              .field("intro", String?.self),
              .field("description", alias: "infoBlocksDescription", String?.self),
              .field("blocks", [Block?]?.self),
            ] }
            static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetWatchExperienceQuery.Data.Experience.Section.self,
              GetWatchExperienceQuery.Data.Experience.Section.AsComponentSectionsInfoBlocks.self
            ] }

            var id: ForgeSchema.ID { __data["id"] }
            var infoBlocksHeading: String? { __data["infoBlocksHeading"] }
            var intro: String? { __data["intro"] }
            var infoBlocksDescription: String? { __data["infoBlocksDescription"] }
            var blocks: [Block?]? { __data["blocks"] }

            /// Experience.Section.AsComponentSectionsInfoBlocks.Block
            ///
            /// Parent Type: `ComponentSectionsInfoBlock`
            struct Block: ForgeSchema.SelectionSet {
              let __data: DataDict
              init(_dataDict: DataDict) { __data = _dataDict }

              static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsInfoBlock }
              static var __selections: [ApolloAPI.Selection] { [
                .field("__typename", String.self),
                .field("id", ForgeSchema.ID.self),
                .field("title", String.self),
                .field("description", String.self),
                .field("icon", String.self),
              ] }
              static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                GetWatchExperienceQuery.Data.Experience.Section.AsComponentSectionsInfoBlocks.Block.self
              ] }

              var id: ForgeSchema.ID { __data["id"] }
              var title: String { __data["title"] }
              var description: String { __data["description"] }
              var icon: String { __data["icon"] }
            }
          }

          /// Experience.Section.AsComponentSectionsCta
          ///
          /// Parent Type: `ComponentSectionsCta`
          struct AsComponentSectionsCta: ForgeSchema.InlineFragment {
            let __data: DataDict
            init(_dataDict: DataDict) { __data = _dataDict }

            typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Section
            static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsCta }
            static var __selections: [ApolloAPI.Selection] { [
              .field("id", ForgeSchema.ID.self),
              .field("heading", alias: "ctaHeading", String.self),
              .field("body", String.self),
              .field("buttonLabel", String.self),
              .field("buttonLink", String.self),
            ] }
            static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetWatchExperienceQuery.Data.Experience.Section.self,
              GetWatchExperienceQuery.Data.Experience.Section.AsComponentSectionsCta.self
            ] }

            var id: ForgeSchema.ID { __data["id"] }
            var ctaHeading: String { __data["ctaHeading"] }
            var body: String { __data["body"] }
            var buttonLabel: String { __data["buttonLabel"] }
            var buttonLink: String { __data["buttonLink"] }
          }
        }
      }
    }
  }

}