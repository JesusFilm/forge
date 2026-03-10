// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

extension ForgeSchema {
  class GetWatchExperienceQuery: GraphQLQuery {
    static let operationName: String = "GetWatchExperience"
    static let operationDocument: ApolloAPI.OperationDocument = .init(
      definition: .init(
        #"query GetWatchExperience($locale: I18NLocaleCode!, $filters: ExperienceFiltersInput!) { experiences(filters: $filters, locale: $locale) { __typename documentId slug publishedAt blocks { __typename ... on ComponentSectionsMediaCollection { ...MediaCollectionFields } ... on ComponentSectionsCta { ...CtaFields } ... on ComponentSectionsVideoHero { ...VideoHeroFields } ... on ComponentSectionsText { ...TextFields } ... on ComponentSectionsRelatedQuestions { ...RelatedQuestionsFields } ... on ComponentSectionsBibleQuotesCarousel { ...BibleQuotesCarouselFields } ... on ComponentSectionsCard { ...CardFields } ... on ComponentSectionsVideo { ...VideoSectionFields } ... on ComponentSectionsPromoBanner { id } ... on ComponentSectionsInfoBlocks { id } ... on ComponentSectionsContainer { id sectionKey slots { __typename id gridSpan slotContent: content { __typename ... on ComponentSectionsMediaCollection { ...MediaCollectionFields } ... on ComponentSectionsCta { ...CtaFields } ... on ComponentSectionsText { ...TextFields } ... on ComponentSectionsRelatedQuestions { ...RelatedQuestionsFields } ... on ComponentSectionsBibleQuotesCarousel { ...BibleQuotesCarouselFields } ... on ComponentSectionsCard { ...CardFields } ... on ComponentSectionsVideo { ...VideoSectionFields } } } } ... on ComponentSectionsSection { id sectionKey backgroundColor blurHash sectionContent: content { __typename ... on ComponentSectionsMediaCollection { ...MediaCollectionFields } ... on ComponentSectionsCta { ...CtaFields } ... on ComponentSectionsText { ...TextFields } ... on ComponentSectionsRelatedQuestions { ...RelatedQuestionsFields } ... on ComponentSectionsBibleQuotesCarousel { ...BibleQuotesCarouselFields } ... on ComponentSectionsCard { ...CardFields } ... on ComponentSectionsVideo { ...VideoSectionFields } ... on ComponentSectionsPromoBanner { id } ... on ComponentSectionsInfoBlocks { id } ... on ComponentSectionsContainer { id sectionKey slots { __typename id gridSpan slotContent: content { __typename ... on ComponentSectionsMediaCollection { ...MediaCollectionFields } ... on ComponentSectionsCta { ...CtaFields } ... on ComponentSectionsText { ...TextFields } ... on ComponentSectionsRelatedQuestions { ...RelatedQuestionsFields } ... on ComponentSectionsBibleQuotesCarousel { ...BibleQuotesCarouselFields } ... on ComponentSectionsCard { ...CardFields } ... on ComponentSectionsVideo { ...VideoSectionFields } } } } } } } } }"#,
        fragments: [BibleQuotesCarouselFields.self, CardFields.self, CtaFields.self, MediaCollectionFields.self, RelatedQuestionsFields.self, TextFields.self, VideoHeroFields.self, VideoSectionFields.self]
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
          .field("blocks", [Block?]?.self),
        ] }
        static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
          GetWatchExperienceQuery.Data.Experience.self
        ] }

        var documentId: ForgeSchema.ID { __data["documentId"] }
        var slug: String { __data["slug"] }
        var publishedAt: ForgeSchema.DateTime? { __data["publishedAt"] }
        var blocks: [Block?]? { __data["blocks"] }

        /// Experience.Block
        ///
        /// Parent Type: `ExperienceBlocksDynamicZone`
        struct Block: ForgeSchema.SelectionSet {
          let __data: DataDict
          init(_dataDict: DataDict) { __data = _dataDict }

          static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Unions.ExperienceBlocksDynamicZone }
          static var __selections: [ApolloAPI.Selection] { [
            .field("__typename", String.self),
            .inlineFragment(AsComponentSectionsMediaCollection.self),
            .inlineFragment(AsComponentSectionsCta.self),
            .inlineFragment(AsComponentSectionsVideoHero.self),
            .inlineFragment(AsComponentSectionsText.self),
            .inlineFragment(AsComponentSectionsRelatedQuestions.self),
            .inlineFragment(AsComponentSectionsBibleQuotesCarousel.self),
            .inlineFragment(AsComponentSectionsCard.self),
            .inlineFragment(AsComponentSectionsVideo.self),
            .inlineFragment(AsComponentSectionsPromoBanner.self),
            .inlineFragment(AsComponentSectionsInfoBlocks.self),
            .inlineFragment(AsComponentSectionsContainer.self),
            .inlineFragment(AsComponentSectionsSection.self),
          ] }
          static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
            GetWatchExperienceQuery.Data.Experience.Block.self
          ] }

          var asComponentSectionsMediaCollection: AsComponentSectionsMediaCollection? { _asInlineFragment() }
          var asComponentSectionsCta: AsComponentSectionsCta? { _asInlineFragment() }
          var asComponentSectionsVideoHero: AsComponentSectionsVideoHero? { _asInlineFragment() }
          var asComponentSectionsText: AsComponentSectionsText? { _asInlineFragment() }
          var asComponentSectionsRelatedQuestions: AsComponentSectionsRelatedQuestions? { _asInlineFragment() }
          var asComponentSectionsBibleQuotesCarousel: AsComponentSectionsBibleQuotesCarousel? { _asInlineFragment() }
          var asComponentSectionsCard: AsComponentSectionsCard? { _asInlineFragment() }
          var asComponentSectionsVideo: AsComponentSectionsVideo? { _asInlineFragment() }
          var asComponentSectionsPromoBanner: AsComponentSectionsPromoBanner? { _asInlineFragment() }
          var asComponentSectionsInfoBlocks: AsComponentSectionsInfoBlocks? { _asInlineFragment() }
          var asComponentSectionsContainer: AsComponentSectionsContainer? { _asInlineFragment() }
          var asComponentSectionsSection: AsComponentSectionsSection? { _asInlineFragment() }

          /// Experience.Block.AsComponentSectionsMediaCollection
          ///
          /// Parent Type: `ComponentSectionsMediaCollection`
          struct AsComponentSectionsMediaCollection: ForgeSchema.InlineFragment {
            let __data: DataDict
            init(_dataDict: DataDict) { __data = _dataDict }

            typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block
            static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsMediaCollection }
            static var __selections: [ApolloAPI.Selection] { [
              .fragment(MediaCollectionFields.self),
            ] }
            static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetWatchExperienceQuery.Data.Experience.Block.self,
              GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsMediaCollection.self,
              MediaCollectionFields.self
            ] }

            var id: ForgeSchema.ID { __data["id"] }
            var sectionKey: String? { __data["sectionKey"] }
            var mediaCollectionTitle: String? { __data["mediaCollectionTitle"] }
            var subtitle: String? { __data["subtitle"] }
            var mediaCollectionDescription: String? { __data["mediaCollectionDescription"] }
            var categoryLabel: String? { __data["categoryLabel"] }
            var mediaCollectionCtaLink: String? { __data["mediaCollectionCtaLink"] }
            var showItemNumbers: Bool? { __data["showItemNumbers"] }
            var footerText: String? { __data["footerText"] }
            var mediaCollectionVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSMEDIACOLLECTION_VARIANT> { __data["mediaCollectionVariant"] }
            var items: [Item?]? { __data["items"] }

            struct Fragments: FragmentContainer {
              let __data: DataDict
              init(_dataDict: DataDict) { __data = _dataDict }

              var mediaCollectionFields: MediaCollectionFields { _toFragment() }
            }

            typealias Item = MediaCollectionFields.Item
          }

          /// Experience.Block.AsComponentSectionsCta
          ///
          /// Parent Type: `ComponentSectionsCta`
          struct AsComponentSectionsCta: ForgeSchema.InlineFragment {
            let __data: DataDict
            init(_dataDict: DataDict) { __data = _dataDict }

            typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block
            static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsCta }
            static var __selections: [ApolloAPI.Selection] { [
              .fragment(CtaFields.self),
            ] }
            static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetWatchExperienceQuery.Data.Experience.Block.self,
              GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsCta.self,
              CtaFields.self
            ] }

            var id: ForgeSchema.ID { __data["id"] }
            var sectionKey: String? { __data["sectionKey"] }
            var ctaHeading: String? { __data["ctaHeading"] }
            var body: String? { __data["body"] }
            var buttonLabel: String { __data["buttonLabel"] }
            var buttonLink: String? { __data["buttonLink"] }
            var ctaVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSCTA_VARIANT>? { __data["ctaVariant"] }

            struct Fragments: FragmentContainer {
              let __data: DataDict
              init(_dataDict: DataDict) { __data = _dataDict }

              var ctaFields: CtaFields { _toFragment() }
            }
          }

          /// Experience.Block.AsComponentSectionsVideoHero
          ///
          /// Parent Type: `ComponentSectionsVideoHero`
          struct AsComponentSectionsVideoHero: ForgeSchema.InlineFragment {
            let __data: DataDict
            init(_dataDict: DataDict) { __data = _dataDict }

            typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block
            static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsVideoHero }
            static var __selections: [ApolloAPI.Selection] { [
              .fragment(VideoHeroFields.self),
            ] }
            static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetWatchExperienceQuery.Data.Experience.Block.self,
              GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsVideoHero.self,
              VideoHeroFields.self
            ] }

            var id: ForgeSchema.ID { __data["id"] }
            var sectionKey: String? { __data["sectionKey"] }
            var videoHeroHeading: String? { __data["videoHeroHeading"] }
            var subheading: String? { __data["subheading"] }
            var heroStreamingUrl: String { __data["heroStreamingUrl"] }
            var ctaLink: String? { __data["ctaLink"] }
            var ctaLabel: String? { __data["ctaLabel"] }
            var heroVideo: HeroVideo { __data["heroVideo"] }

            struct Fragments: FragmentContainer {
              let __data: DataDict
              init(_dataDict: DataDict) { __data = _dataDict }

              var videoHeroFields: VideoHeroFields { _toFragment() }
            }

            typealias HeroVideo = VideoHeroFields.HeroVideo
          }

          /// Experience.Block.AsComponentSectionsText
          ///
          /// Parent Type: `ComponentSectionsText`
          struct AsComponentSectionsText: ForgeSchema.InlineFragment {
            let __data: DataDict
            init(_dataDict: DataDict) { __data = _dataDict }

            typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block
            static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsText }
            static var __selections: [ApolloAPI.Selection] { [
              .fragment(TextFields.self),
            ] }
            static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetWatchExperienceQuery.Data.Experience.Block.self,
              GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsText.self,
              TextFields.self
            ] }

            var id: ForgeSchema.ID { __data["id"] }
            var sectionKey: String? { __data["sectionKey"] }
            var textHeading: String? { __data["textHeading"] }
            var headingLevel: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSTEXT_HEADINGLEVEL>? { __data["headingLevel"] }
            var textSubtitle: String? { __data["textSubtitle"] }
            var textContentParagraphs: ForgeSchema.JSON? { __data["textContentParagraphs"] }
            var textVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSTEXT_VARIANT>? { __data["textVariant"] }

            struct Fragments: FragmentContainer {
              let __data: DataDict
              init(_dataDict: DataDict) { __data = _dataDict }

              var textFields: TextFields { _toFragment() }
            }
          }

          /// Experience.Block.AsComponentSectionsRelatedQuestions
          ///
          /// Parent Type: `ComponentSectionsRelatedQuestions`
          struct AsComponentSectionsRelatedQuestions: ForgeSchema.InlineFragment {
            let __data: DataDict
            init(_dataDict: DataDict) { __data = _dataDict }

            typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block
            static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsRelatedQuestions }
            static var __selections: [ApolloAPI.Selection] { [
              .fragment(RelatedQuestionsFields.self),
            ] }
            static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetWatchExperienceQuery.Data.Experience.Block.self,
              GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsRelatedQuestions.self,
              RelatedQuestionsFields.self
            ] }

            var id: ForgeSchema.ID { __data["id"] }
            var sectionKey: String? { __data["sectionKey"] }
            var relatedQuestionsHeading: String? { __data["relatedQuestionsHeading"] }
            var questions: [Question?]? { __data["questions"] }

            struct Fragments: FragmentContainer {
              let __data: DataDict
              init(_dataDict: DataDict) { __data = _dataDict }

              var relatedQuestionsFields: RelatedQuestionsFields { _toFragment() }
            }

            typealias Question = RelatedQuestionsFields.Question
          }

          /// Experience.Block.AsComponentSectionsBibleQuotesCarousel
          ///
          /// Parent Type: `ComponentSectionsBibleQuotesCarousel`
          struct AsComponentSectionsBibleQuotesCarousel: ForgeSchema.InlineFragment {
            let __data: DataDict
            init(_dataDict: DataDict) { __data = _dataDict }

            typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block
            static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsBibleQuotesCarousel }
            static var __selections: [ApolloAPI.Selection] { [
              .fragment(BibleQuotesCarouselFields.self),
            ] }
            static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetWatchExperienceQuery.Data.Experience.Block.self,
              GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsBibleQuotesCarousel.self,
              BibleQuotesCarouselFields.self
            ] }

            var id: ForgeSchema.ID { __data["id"] }
            var sectionKey: String? { __data["sectionKey"] }
            var carouselHeading: String? { __data["carouselHeading"] }
            var quotes: [Quote?]? { __data["quotes"] }

            struct Fragments: FragmentContainer {
              let __data: DataDict
              init(_dataDict: DataDict) { __data = _dataDict }

              var bibleQuotesCarouselFields: BibleQuotesCarouselFields { _toFragment() }
            }

            typealias Quote = BibleQuotesCarouselFields.Quote
          }

          /// Experience.Block.AsComponentSectionsCard
          ///
          /// Parent Type: `ComponentSectionsCard`
          struct AsComponentSectionsCard: ForgeSchema.InlineFragment {
            let __data: DataDict
            init(_dataDict: DataDict) { __data = _dataDict }

            typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block
            static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsCard }
            static var __selections: [ApolloAPI.Selection] { [
              .fragment(CardFields.self),
            ] }
            static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetWatchExperienceQuery.Data.Experience.Block.self,
              GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsCard.self,
              CardFields.self
            ] }

            var id: ForgeSchema.ID { __data["id"] }
            var sectionKey: String? { __data["sectionKey"] }
            var cardTitle: String { __data["cardTitle"] }
            var cardDescription: String { __data["cardDescription"] }
            var media: Media? { __data["media"] }
            var link: String? { __data["link"] }
            var cardVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSCARD_VARIANT>? { __data["cardVariant"] }

            struct Fragments: FragmentContainer {
              let __data: DataDict
              init(_dataDict: DataDict) { __data = _dataDict }

              var cardFields: CardFields { _toFragment() }
            }

            typealias Media = CardFields.Media
          }

          /// Experience.Block.AsComponentSectionsVideo
          ///
          /// Parent Type: `ComponentSectionsVideo`
          struct AsComponentSectionsVideo: ForgeSchema.InlineFragment {
            let __data: DataDict
            init(_dataDict: DataDict) { __data = _dataDict }

            typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block
            static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsVideo }
            static var __selections: [ApolloAPI.Selection] { [
              .fragment(VideoSectionFields.self),
            ] }
            static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetWatchExperienceQuery.Data.Experience.Block.self,
              GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsVideo.self,
              VideoSectionFields.self
            ] }

            var id: ForgeSchema.ID { __data["id"] }
            var sectionKey: String? { __data["sectionKey"] }
            var streamingUrl: String { __data["streamingUrl"] }
            var videoTitle: String? { __data["videoTitle"] }
            var videoSubtitle: String? { __data["videoSubtitle"] }
            var videoMedia: VideoMedia? { __data["videoMedia"] }
            var sectionVideo: SectionVideo? { __data["sectionVideo"] }

            struct Fragments: FragmentContainer {
              let __data: DataDict
              init(_dataDict: DataDict) { __data = _dataDict }

              var videoSectionFields: VideoSectionFields { _toFragment() }
            }

            typealias VideoMedia = VideoSectionFields.VideoMedia

            typealias SectionVideo = VideoSectionFields.SectionVideo
          }

          /// Experience.Block.AsComponentSectionsPromoBanner
          ///
          /// Parent Type: `ComponentSectionsPromoBanner`
          struct AsComponentSectionsPromoBanner: ForgeSchema.InlineFragment {
            let __data: DataDict
            init(_dataDict: DataDict) { __data = _dataDict }

            typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block
            static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsPromoBanner }
            static var __selections: [ApolloAPI.Selection] { [
              .field("id", ForgeSchema.ID.self),
            ] }
            static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetWatchExperienceQuery.Data.Experience.Block.self,
              GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsPromoBanner.self
            ] }

            var id: ForgeSchema.ID { __data["id"] }
          }

          /// Experience.Block.AsComponentSectionsInfoBlocks
          ///
          /// Parent Type: `ComponentSectionsInfoBlocks`
          struct AsComponentSectionsInfoBlocks: ForgeSchema.InlineFragment {
            let __data: DataDict
            init(_dataDict: DataDict) { __data = _dataDict }

            typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block
            static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsInfoBlocks }
            static var __selections: [ApolloAPI.Selection] { [
              .field("id", ForgeSchema.ID.self),
            ] }
            static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetWatchExperienceQuery.Data.Experience.Block.self,
              GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsInfoBlocks.self
            ] }

            var id: ForgeSchema.ID { __data["id"] }
          }

          /// Experience.Block.AsComponentSectionsContainer
          ///
          /// Parent Type: `ComponentSectionsContainer`
          struct AsComponentSectionsContainer: ForgeSchema.InlineFragment {
            let __data: DataDict
            init(_dataDict: DataDict) { __data = _dataDict }

            typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block
            static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsContainer }
            static var __selections: [ApolloAPI.Selection] { [
              .field("id", ForgeSchema.ID.self),
              .field("sectionKey", String?.self),
              .field("slots", [Slot?]?.self),
            ] }
            static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetWatchExperienceQuery.Data.Experience.Block.self,
              GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.self
            ] }

            var id: ForgeSchema.ID { __data["id"] }
            var sectionKey: String? { __data["sectionKey"] }
            var slots: [Slot?]? { __data["slots"] }

            /// Experience.Block.AsComponentSectionsContainer.Slot
            ///
            /// Parent Type: `ComponentSectionsContainerSlot`
            struct Slot: ForgeSchema.SelectionSet {
              let __data: DataDict
              init(_dataDict: DataDict) { __data = _dataDict }

              static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsContainerSlot }
              static var __selections: [ApolloAPI.Selection] { [
                .field("__typename", String.self),
                .field("id", ForgeSchema.ID.self),
                .field("gridSpan", Int.self),
                .field("content", alias: "slotContent", [SlotContent?].self),
              ] }
              static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.self
              ] }

              var id: ForgeSchema.ID { __data["id"] }
              var gridSpan: Int { __data["gridSpan"] }
              var slotContent: [SlotContent?] { __data["slotContent"] }

              /// Experience.Block.AsComponentSectionsContainer.Slot.SlotContent
              ///
              /// Parent Type: `ContainerSlotContentDynamicZone`
              struct SlotContent: ForgeSchema.SelectionSet {
                let __data: DataDict
                init(_dataDict: DataDict) { __data = _dataDict }

                static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Unions.ContainerSlotContentDynamicZone }
                static var __selections: [ApolloAPI.Selection] { [
                  .field("__typename", String.self),
                  .inlineFragment(AsComponentSectionsMediaCollection.self),
                  .inlineFragment(AsComponentSectionsCta.self),
                  .inlineFragment(AsComponentSectionsText.self),
                  .inlineFragment(AsComponentSectionsRelatedQuestions.self),
                  .inlineFragment(AsComponentSectionsBibleQuotesCarousel.self),
                  .inlineFragment(AsComponentSectionsCard.self),
                  .inlineFragment(AsComponentSectionsVideo.self),
                ] }
                static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.self
                ] }

                var asComponentSectionsMediaCollection: AsComponentSectionsMediaCollection? { _asInlineFragment() }
                var asComponentSectionsCta: AsComponentSectionsCta? { _asInlineFragment() }
                var asComponentSectionsText: AsComponentSectionsText? { _asInlineFragment() }
                var asComponentSectionsRelatedQuestions: AsComponentSectionsRelatedQuestions? { _asInlineFragment() }
                var asComponentSectionsBibleQuotesCarousel: AsComponentSectionsBibleQuotesCarousel? { _asInlineFragment() }
                var asComponentSectionsCard: AsComponentSectionsCard? { _asInlineFragment() }
                var asComponentSectionsVideo: AsComponentSectionsVideo? { _asInlineFragment() }

                /// Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsMediaCollection
                ///
                /// Parent Type: `ComponentSectionsMediaCollection`
                struct AsComponentSectionsMediaCollection: ForgeSchema.InlineFragment {
                  let __data: DataDict
                  init(_dataDict: DataDict) { __data = _dataDict }

                  typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent
                  static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsMediaCollection }
                  static var __selections: [ApolloAPI.Selection] { [
                    .fragment(MediaCollectionFields.self),
                  ] }
                  static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                    GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.self,
                    GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsMediaCollection.self,
                    MediaCollectionFields.self
                  ] }

                  var id: ForgeSchema.ID { __data["id"] }
                  var sectionKey: String? { __data["sectionKey"] }
                  var mediaCollectionTitle: String? { __data["mediaCollectionTitle"] }
                  var subtitle: String? { __data["subtitle"] }
                  var mediaCollectionDescription: String? { __data["mediaCollectionDescription"] }
                  var categoryLabel: String? { __data["categoryLabel"] }
                  var mediaCollectionCtaLink: String? { __data["mediaCollectionCtaLink"] }
                  var showItemNumbers: Bool? { __data["showItemNumbers"] }
                  var footerText: String? { __data["footerText"] }
                  var mediaCollectionVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSMEDIACOLLECTION_VARIANT> { __data["mediaCollectionVariant"] }
                  var items: [Item?]? { __data["items"] }

                  struct Fragments: FragmentContainer {
                    let __data: DataDict
                    init(_dataDict: DataDict) { __data = _dataDict }

                    var mediaCollectionFields: MediaCollectionFields { _toFragment() }
                  }

                  typealias Item = MediaCollectionFields.Item
                }

                /// Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsCta
                ///
                /// Parent Type: `ComponentSectionsCta`
                struct AsComponentSectionsCta: ForgeSchema.InlineFragment {
                  let __data: DataDict
                  init(_dataDict: DataDict) { __data = _dataDict }

                  typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent
                  static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsCta }
                  static var __selections: [ApolloAPI.Selection] { [
                    .fragment(CtaFields.self),
                  ] }
                  static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                    GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.self,
                    GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsCta.self,
                    CtaFields.self
                  ] }

                  var id: ForgeSchema.ID { __data["id"] }
                  var sectionKey: String? { __data["sectionKey"] }
                  var ctaHeading: String? { __data["ctaHeading"] }
                  var body: String? { __data["body"] }
                  var buttonLabel: String { __data["buttonLabel"] }
                  var buttonLink: String? { __data["buttonLink"] }
                  var ctaVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSCTA_VARIANT>? { __data["ctaVariant"] }

                  struct Fragments: FragmentContainer {
                    let __data: DataDict
                    init(_dataDict: DataDict) { __data = _dataDict }

                    var ctaFields: CtaFields { _toFragment() }
                  }
                }

                /// Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsText
                ///
                /// Parent Type: `ComponentSectionsText`
                struct AsComponentSectionsText: ForgeSchema.InlineFragment {
                  let __data: DataDict
                  init(_dataDict: DataDict) { __data = _dataDict }

                  typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent
                  static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsText }
                  static var __selections: [ApolloAPI.Selection] { [
                    .fragment(TextFields.self),
                  ] }
                  static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                    GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.self,
                    GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsText.self,
                    TextFields.self
                  ] }

                  var id: ForgeSchema.ID { __data["id"] }
                  var sectionKey: String? { __data["sectionKey"] }
                  var textHeading: String? { __data["textHeading"] }
                  var headingLevel: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSTEXT_HEADINGLEVEL>? { __data["headingLevel"] }
                  var textSubtitle: String? { __data["textSubtitle"] }
                  var textContentParagraphs: ForgeSchema.JSON? { __data["textContentParagraphs"] }
                  var textVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSTEXT_VARIANT>? { __data["textVariant"] }

                  struct Fragments: FragmentContainer {
                    let __data: DataDict
                    init(_dataDict: DataDict) { __data = _dataDict }

                    var textFields: TextFields { _toFragment() }
                  }
                }

                /// Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsRelatedQuestions
                ///
                /// Parent Type: `ComponentSectionsRelatedQuestions`
                struct AsComponentSectionsRelatedQuestions: ForgeSchema.InlineFragment {
                  let __data: DataDict
                  init(_dataDict: DataDict) { __data = _dataDict }

                  typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent
                  static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsRelatedQuestions }
                  static var __selections: [ApolloAPI.Selection] { [
                    .fragment(RelatedQuestionsFields.self),
                  ] }
                  static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                    GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.self,
                    GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsRelatedQuestions.self,
                    RelatedQuestionsFields.self
                  ] }

                  var id: ForgeSchema.ID { __data["id"] }
                  var sectionKey: String? { __data["sectionKey"] }
                  var relatedQuestionsHeading: String? { __data["relatedQuestionsHeading"] }
                  var questions: [Question?]? { __data["questions"] }

                  struct Fragments: FragmentContainer {
                    let __data: DataDict
                    init(_dataDict: DataDict) { __data = _dataDict }

                    var relatedQuestionsFields: RelatedQuestionsFields { _toFragment() }
                  }

                  typealias Question = RelatedQuestionsFields.Question
                }

                /// Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsBibleQuotesCarousel
                ///
                /// Parent Type: `ComponentSectionsBibleQuotesCarousel`
                struct AsComponentSectionsBibleQuotesCarousel: ForgeSchema.InlineFragment {
                  let __data: DataDict
                  init(_dataDict: DataDict) { __data = _dataDict }

                  typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent
                  static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsBibleQuotesCarousel }
                  static var __selections: [ApolloAPI.Selection] { [
                    .fragment(BibleQuotesCarouselFields.self),
                  ] }
                  static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                    GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.self,
                    GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsBibleQuotesCarousel.self,
                    BibleQuotesCarouselFields.self
                  ] }

                  var id: ForgeSchema.ID { __data["id"] }
                  var sectionKey: String? { __data["sectionKey"] }
                  var carouselHeading: String? { __data["carouselHeading"] }
                  var quotes: [Quote?]? { __data["quotes"] }

                  struct Fragments: FragmentContainer {
                    let __data: DataDict
                    init(_dataDict: DataDict) { __data = _dataDict }

                    var bibleQuotesCarouselFields: BibleQuotesCarouselFields { _toFragment() }
                  }

                  typealias Quote = BibleQuotesCarouselFields.Quote
                }

                /// Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsCard
                ///
                /// Parent Type: `ComponentSectionsCard`
                struct AsComponentSectionsCard: ForgeSchema.InlineFragment {
                  let __data: DataDict
                  init(_dataDict: DataDict) { __data = _dataDict }

                  typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent
                  static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsCard }
                  static var __selections: [ApolloAPI.Selection] { [
                    .fragment(CardFields.self),
                  ] }
                  static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                    GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.self,
                    GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsCard.self,
                    CardFields.self
                  ] }

                  var id: ForgeSchema.ID { __data["id"] }
                  var sectionKey: String? { __data["sectionKey"] }
                  var cardTitle: String { __data["cardTitle"] }
                  var cardDescription: String { __data["cardDescription"] }
                  var media: Media? { __data["media"] }
                  var link: String? { __data["link"] }
                  var cardVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSCARD_VARIANT>? { __data["cardVariant"] }

                  struct Fragments: FragmentContainer {
                    let __data: DataDict
                    init(_dataDict: DataDict) { __data = _dataDict }

                    var cardFields: CardFields { _toFragment() }
                  }

                  typealias Media = CardFields.Media
                }

                /// Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsVideo
                ///
                /// Parent Type: `ComponentSectionsVideo`
                struct AsComponentSectionsVideo: ForgeSchema.InlineFragment {
                  let __data: DataDict
                  init(_dataDict: DataDict) { __data = _dataDict }

                  typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent
                  static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsVideo }
                  static var __selections: [ApolloAPI.Selection] { [
                    .fragment(VideoSectionFields.self),
                  ] }
                  static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                    GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.self,
                    GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsVideo.self,
                    VideoSectionFields.self
                  ] }

                  var id: ForgeSchema.ID { __data["id"] }
                  var sectionKey: String? { __data["sectionKey"] }
                  var streamingUrl: String { __data["streamingUrl"] }
                  var videoTitle: String? { __data["videoTitle"] }
                  var videoSubtitle: String? { __data["videoSubtitle"] }
                  var videoMedia: VideoMedia? { __data["videoMedia"] }
                  var sectionVideo: SectionVideo? { __data["sectionVideo"] }

                  struct Fragments: FragmentContainer {
                    let __data: DataDict
                    init(_dataDict: DataDict) { __data = _dataDict }

                    var videoSectionFields: VideoSectionFields { _toFragment() }
                  }

                  typealias VideoMedia = VideoSectionFields.VideoMedia

                  typealias SectionVideo = VideoSectionFields.SectionVideo
                }
              }
            }
          }

          /// Experience.Block.AsComponentSectionsSection
          ///
          /// Parent Type: `ComponentSectionsSection`
          struct AsComponentSectionsSection: ForgeSchema.InlineFragment {
            let __data: DataDict
            init(_dataDict: DataDict) { __data = _dataDict }

            typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block
            static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsSection }
            static var __selections: [ApolloAPI.Selection] { [
              .field("id", ForgeSchema.ID.self),
              .field("sectionKey", String?.self),
              .field("backgroundColor", GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSSECTION_BACKGROUNDCOLOR>?.self),
              .field("blurHash", String?.self),
              .field("content", alias: "sectionContent", [SectionContent?]?.self),
            ] }
            static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
              GetWatchExperienceQuery.Data.Experience.Block.self,
              GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.self
            ] }

            var id: ForgeSchema.ID { __data["id"] }
            var sectionKey: String? { __data["sectionKey"] }
            var backgroundColor: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSSECTION_BACKGROUNDCOLOR>? { __data["backgroundColor"] }
            var blurHash: String? { __data["blurHash"] }
            var sectionContent: [SectionContent?]? { __data["sectionContent"] }

            /// Experience.Block.AsComponentSectionsSection.SectionContent
            ///
            /// Parent Type: `SectionContentDynamicZone`
            struct SectionContent: ForgeSchema.SelectionSet {
              let __data: DataDict
              init(_dataDict: DataDict) { __data = _dataDict }

              static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Unions.SectionContentDynamicZone }
              static var __selections: [ApolloAPI.Selection] { [
                .field("__typename", String.self),
                .inlineFragment(AsComponentSectionsMediaCollection.self),
                .inlineFragment(AsComponentSectionsCta.self),
                .inlineFragment(AsComponentSectionsText.self),
                .inlineFragment(AsComponentSectionsRelatedQuestions.self),
                .inlineFragment(AsComponentSectionsBibleQuotesCarousel.self),
                .inlineFragment(AsComponentSectionsCard.self),
                .inlineFragment(AsComponentSectionsVideo.self),
                .inlineFragment(AsComponentSectionsPromoBanner.self),
                .inlineFragment(AsComponentSectionsInfoBlocks.self),
                .inlineFragment(AsComponentSectionsContainer.self),
              ] }
              static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.self
              ] }

              var asComponentSectionsMediaCollection: AsComponentSectionsMediaCollection? { _asInlineFragment() }
              var asComponentSectionsCta: AsComponentSectionsCta? { _asInlineFragment() }
              var asComponentSectionsText: AsComponentSectionsText? { _asInlineFragment() }
              var asComponentSectionsRelatedQuestions: AsComponentSectionsRelatedQuestions? { _asInlineFragment() }
              var asComponentSectionsBibleQuotesCarousel: AsComponentSectionsBibleQuotesCarousel? { _asInlineFragment() }
              var asComponentSectionsCard: AsComponentSectionsCard? { _asInlineFragment() }
              var asComponentSectionsVideo: AsComponentSectionsVideo? { _asInlineFragment() }
              var asComponentSectionsPromoBanner: AsComponentSectionsPromoBanner? { _asInlineFragment() }
              var asComponentSectionsInfoBlocks: AsComponentSectionsInfoBlocks? { _asInlineFragment() }
              var asComponentSectionsContainer: AsComponentSectionsContainer? { _asInlineFragment() }

              /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsMediaCollection
              ///
              /// Parent Type: `ComponentSectionsMediaCollection`
              struct AsComponentSectionsMediaCollection: ForgeSchema.InlineFragment {
                let __data: DataDict
                init(_dataDict: DataDict) { __data = _dataDict }

                typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent
                static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsMediaCollection }
                static var __selections: [ApolloAPI.Selection] { [
                  .fragment(MediaCollectionFields.self),
                ] }
                static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.self,
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsMediaCollection.self,
                  MediaCollectionFields.self
                ] }

                var id: ForgeSchema.ID { __data["id"] }
                var sectionKey: String? { __data["sectionKey"] }
                var mediaCollectionTitle: String? { __data["mediaCollectionTitle"] }
                var subtitle: String? { __data["subtitle"] }
                var mediaCollectionDescription: String? { __data["mediaCollectionDescription"] }
                var categoryLabel: String? { __data["categoryLabel"] }
                var mediaCollectionCtaLink: String? { __data["mediaCollectionCtaLink"] }
                var showItemNumbers: Bool? { __data["showItemNumbers"] }
                var footerText: String? { __data["footerText"] }
                var mediaCollectionVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSMEDIACOLLECTION_VARIANT> { __data["mediaCollectionVariant"] }
                var items: [Item?]? { __data["items"] }

                struct Fragments: FragmentContainer {
                  let __data: DataDict
                  init(_dataDict: DataDict) { __data = _dataDict }

                  var mediaCollectionFields: MediaCollectionFields { _toFragment() }
                }

                typealias Item = MediaCollectionFields.Item
              }

              /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsCta
              ///
              /// Parent Type: `ComponentSectionsCta`
              struct AsComponentSectionsCta: ForgeSchema.InlineFragment {
                let __data: DataDict
                init(_dataDict: DataDict) { __data = _dataDict }

                typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent
                static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsCta }
                static var __selections: [ApolloAPI.Selection] { [
                  .fragment(CtaFields.self),
                ] }
                static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.self,
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsCta.self,
                  CtaFields.self
                ] }

                var id: ForgeSchema.ID { __data["id"] }
                var sectionKey: String? { __data["sectionKey"] }
                var ctaHeading: String? { __data["ctaHeading"] }
                var body: String? { __data["body"] }
                var buttonLabel: String { __data["buttonLabel"] }
                var buttonLink: String? { __data["buttonLink"] }
                var ctaVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSCTA_VARIANT>? { __data["ctaVariant"] }

                struct Fragments: FragmentContainer {
                  let __data: DataDict
                  init(_dataDict: DataDict) { __data = _dataDict }

                  var ctaFields: CtaFields { _toFragment() }
                }
              }

              /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsText
              ///
              /// Parent Type: `ComponentSectionsText`
              struct AsComponentSectionsText: ForgeSchema.InlineFragment {
                let __data: DataDict
                init(_dataDict: DataDict) { __data = _dataDict }

                typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent
                static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsText }
                static var __selections: [ApolloAPI.Selection] { [
                  .fragment(TextFields.self),
                ] }
                static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.self,
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsText.self,
                  TextFields.self
                ] }

                var id: ForgeSchema.ID { __data["id"] }
                var sectionKey: String? { __data["sectionKey"] }
                var textHeading: String? { __data["textHeading"] }
                var headingLevel: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSTEXT_HEADINGLEVEL>? { __data["headingLevel"] }
                var textSubtitle: String? { __data["textSubtitle"] }
                var textContentParagraphs: ForgeSchema.JSON? { __data["textContentParagraphs"] }
                var textVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSTEXT_VARIANT>? { __data["textVariant"] }

                struct Fragments: FragmentContainer {
                  let __data: DataDict
                  init(_dataDict: DataDict) { __data = _dataDict }

                  var textFields: TextFields { _toFragment() }
                }
              }

              /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsRelatedQuestions
              ///
              /// Parent Type: `ComponentSectionsRelatedQuestions`
              struct AsComponentSectionsRelatedQuestions: ForgeSchema.InlineFragment {
                let __data: DataDict
                init(_dataDict: DataDict) { __data = _dataDict }

                typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent
                static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsRelatedQuestions }
                static var __selections: [ApolloAPI.Selection] { [
                  .fragment(RelatedQuestionsFields.self),
                ] }
                static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.self,
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsRelatedQuestions.self,
                  RelatedQuestionsFields.self
                ] }

                var id: ForgeSchema.ID { __data["id"] }
                var sectionKey: String? { __data["sectionKey"] }
                var relatedQuestionsHeading: String? { __data["relatedQuestionsHeading"] }
                var questions: [Question?]? { __data["questions"] }

                struct Fragments: FragmentContainer {
                  let __data: DataDict
                  init(_dataDict: DataDict) { __data = _dataDict }

                  var relatedQuestionsFields: RelatedQuestionsFields { _toFragment() }
                }

                typealias Question = RelatedQuestionsFields.Question
              }

              /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsBibleQuotesCarousel
              ///
              /// Parent Type: `ComponentSectionsBibleQuotesCarousel`
              struct AsComponentSectionsBibleQuotesCarousel: ForgeSchema.InlineFragment {
                let __data: DataDict
                init(_dataDict: DataDict) { __data = _dataDict }

                typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent
                static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsBibleQuotesCarousel }
                static var __selections: [ApolloAPI.Selection] { [
                  .fragment(BibleQuotesCarouselFields.self),
                ] }
                static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.self,
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsBibleQuotesCarousel.self,
                  BibleQuotesCarouselFields.self
                ] }

                var id: ForgeSchema.ID { __data["id"] }
                var sectionKey: String? { __data["sectionKey"] }
                var carouselHeading: String? { __data["carouselHeading"] }
                var quotes: [Quote?]? { __data["quotes"] }

                struct Fragments: FragmentContainer {
                  let __data: DataDict
                  init(_dataDict: DataDict) { __data = _dataDict }

                  var bibleQuotesCarouselFields: BibleQuotesCarouselFields { _toFragment() }
                }

                typealias Quote = BibleQuotesCarouselFields.Quote
              }

              /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsCard
              ///
              /// Parent Type: `ComponentSectionsCard`
              struct AsComponentSectionsCard: ForgeSchema.InlineFragment {
                let __data: DataDict
                init(_dataDict: DataDict) { __data = _dataDict }

                typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent
                static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsCard }
                static var __selections: [ApolloAPI.Selection] { [
                  .fragment(CardFields.self),
                ] }
                static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.self,
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsCard.self,
                  CardFields.self
                ] }

                var id: ForgeSchema.ID { __data["id"] }
                var sectionKey: String? { __data["sectionKey"] }
                var cardTitle: String { __data["cardTitle"] }
                var cardDescription: String { __data["cardDescription"] }
                var media: Media? { __data["media"] }
                var link: String? { __data["link"] }
                var cardVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSCARD_VARIANT>? { __data["cardVariant"] }

                struct Fragments: FragmentContainer {
                  let __data: DataDict
                  init(_dataDict: DataDict) { __data = _dataDict }

                  var cardFields: CardFields { _toFragment() }
                }

                typealias Media = CardFields.Media
              }

              /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsVideo
              ///
              /// Parent Type: `ComponentSectionsVideo`
              struct AsComponentSectionsVideo: ForgeSchema.InlineFragment {
                let __data: DataDict
                init(_dataDict: DataDict) { __data = _dataDict }

                typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent
                static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsVideo }
                static var __selections: [ApolloAPI.Selection] { [
                  .fragment(VideoSectionFields.self),
                ] }
                static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.self,
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsVideo.self,
                  VideoSectionFields.self
                ] }

                var id: ForgeSchema.ID { __data["id"] }
                var sectionKey: String? { __data["sectionKey"] }
                var streamingUrl: String { __data["streamingUrl"] }
                var videoTitle: String? { __data["videoTitle"] }
                var videoSubtitle: String? { __data["videoSubtitle"] }
                var videoMedia: VideoMedia? { __data["videoMedia"] }
                var sectionVideo: SectionVideo? { __data["sectionVideo"] }

                struct Fragments: FragmentContainer {
                  let __data: DataDict
                  init(_dataDict: DataDict) { __data = _dataDict }

                  var videoSectionFields: VideoSectionFields { _toFragment() }
                }

                typealias VideoMedia = VideoSectionFields.VideoMedia

                typealias SectionVideo = VideoSectionFields.SectionVideo
              }

              /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsPromoBanner
              ///
              /// Parent Type: `ComponentSectionsPromoBanner`
              struct AsComponentSectionsPromoBanner: ForgeSchema.InlineFragment {
                let __data: DataDict
                init(_dataDict: DataDict) { __data = _dataDict }

                typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent
                static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsPromoBanner }
                static var __selections: [ApolloAPI.Selection] { [
                  .field("id", ForgeSchema.ID.self),
                ] }
                static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.self,
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsPromoBanner.self
                ] }

                var id: ForgeSchema.ID { __data["id"] }
              }

              /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsInfoBlocks
              ///
              /// Parent Type: `ComponentSectionsInfoBlocks`
              struct AsComponentSectionsInfoBlocks: ForgeSchema.InlineFragment {
                let __data: DataDict
                init(_dataDict: DataDict) { __data = _dataDict }

                typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent
                static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsInfoBlocks }
                static var __selections: [ApolloAPI.Selection] { [
                  .field("id", ForgeSchema.ID.self),
                ] }
                static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.self,
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsInfoBlocks.self
                ] }

                var id: ForgeSchema.ID { __data["id"] }
              }

              /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer
              ///
              /// Parent Type: `ComponentSectionsContainer`
              struct AsComponentSectionsContainer: ForgeSchema.InlineFragment {
                let __data: DataDict
                init(_dataDict: DataDict) { __data = _dataDict }

                typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent
                static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsContainer }
                static var __selections: [ApolloAPI.Selection] { [
                  .field("id", ForgeSchema.ID.self),
                  .field("sectionKey", String?.self),
                  .field("slots", [Slot?]?.self),
                ] }
                static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.self,
                  GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.self
                ] }

                var id: ForgeSchema.ID { __data["id"] }
                var sectionKey: String? { __data["sectionKey"] }
                var slots: [Slot?]? { __data["slots"] }

                /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot
                ///
                /// Parent Type: `ComponentSectionsContainerSlot`
                struct Slot: ForgeSchema.SelectionSet {
                  let __data: DataDict
                  init(_dataDict: DataDict) { __data = _dataDict }

                  static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsContainerSlot }
                  static var __selections: [ApolloAPI.Selection] { [
                    .field("__typename", String.self),
                    .field("id", ForgeSchema.ID.self),
                    .field("gridSpan", Int.self),
                    .field("content", alias: "slotContent", [SlotContent?].self),
                  ] }
                  static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                    GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.self
                  ] }

                  var id: ForgeSchema.ID { __data["id"] }
                  var gridSpan: Int { __data["gridSpan"] }
                  var slotContent: [SlotContent?] { __data["slotContent"] }

                  /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent
                  ///
                  /// Parent Type: `ContainerSlotContentDynamicZone`
                  struct SlotContent: ForgeSchema.SelectionSet {
                    let __data: DataDict
                    init(_dataDict: DataDict) { __data = _dataDict }

                    static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Unions.ContainerSlotContentDynamicZone }
                    static var __selections: [ApolloAPI.Selection] { [
                      .field("__typename", String.self),
                      .inlineFragment(AsComponentSectionsMediaCollection.self),
                      .inlineFragment(AsComponentSectionsCta.self),
                      .inlineFragment(AsComponentSectionsText.self),
                      .inlineFragment(AsComponentSectionsRelatedQuestions.self),
                      .inlineFragment(AsComponentSectionsBibleQuotesCarousel.self),
                      .inlineFragment(AsComponentSectionsCard.self),
                      .inlineFragment(AsComponentSectionsVideo.self),
                    ] }
                    static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                      GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.self
                    ] }

                    var asComponentSectionsMediaCollection: AsComponentSectionsMediaCollection? { _asInlineFragment() }
                    var asComponentSectionsCta: AsComponentSectionsCta? { _asInlineFragment() }
                    var asComponentSectionsText: AsComponentSectionsText? { _asInlineFragment() }
                    var asComponentSectionsRelatedQuestions: AsComponentSectionsRelatedQuestions? { _asInlineFragment() }
                    var asComponentSectionsBibleQuotesCarousel: AsComponentSectionsBibleQuotesCarousel? { _asInlineFragment() }
                    var asComponentSectionsCard: AsComponentSectionsCard? { _asInlineFragment() }
                    var asComponentSectionsVideo: AsComponentSectionsVideo? { _asInlineFragment() }

                    /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsMediaCollection
                    ///
                    /// Parent Type: `ComponentSectionsMediaCollection`
                    struct AsComponentSectionsMediaCollection: ForgeSchema.InlineFragment {
                      let __data: DataDict
                      init(_dataDict: DataDict) { __data = _dataDict }

                      typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent
                      static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsMediaCollection }
                      static var __selections: [ApolloAPI.Selection] { [
                        .fragment(MediaCollectionFields.self),
                      ] }
                      static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                        GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.self,
                        GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsMediaCollection.self,
                        MediaCollectionFields.self
                      ] }

                      var id: ForgeSchema.ID { __data["id"] }
                      var sectionKey: String? { __data["sectionKey"] }
                      var mediaCollectionTitle: String? { __data["mediaCollectionTitle"] }
                      var subtitle: String? { __data["subtitle"] }
                      var mediaCollectionDescription: String? { __data["mediaCollectionDescription"] }
                      var categoryLabel: String? { __data["categoryLabel"] }
                      var mediaCollectionCtaLink: String? { __data["mediaCollectionCtaLink"] }
                      var showItemNumbers: Bool? { __data["showItemNumbers"] }
                      var footerText: String? { __data["footerText"] }
                      var mediaCollectionVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSMEDIACOLLECTION_VARIANT> { __data["mediaCollectionVariant"] }
                      var items: [Item?]? { __data["items"] }

                      struct Fragments: FragmentContainer {
                        let __data: DataDict
                        init(_dataDict: DataDict) { __data = _dataDict }

                        var mediaCollectionFields: MediaCollectionFields { _toFragment() }
                      }

                      typealias Item = MediaCollectionFields.Item
                    }

                    /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsCta
                    ///
                    /// Parent Type: `ComponentSectionsCta`
                    struct AsComponentSectionsCta: ForgeSchema.InlineFragment {
                      let __data: DataDict
                      init(_dataDict: DataDict) { __data = _dataDict }

                      typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent
                      static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsCta }
                      static var __selections: [ApolloAPI.Selection] { [
                        .fragment(CtaFields.self),
                      ] }
                      static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                        GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.self,
                        GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsCta.self,
                        CtaFields.self
                      ] }

                      var id: ForgeSchema.ID { __data["id"] }
                      var sectionKey: String? { __data["sectionKey"] }
                      var ctaHeading: String? { __data["ctaHeading"] }
                      var body: String? { __data["body"] }
                      var buttonLabel: String { __data["buttonLabel"] }
                      var buttonLink: String? { __data["buttonLink"] }
                      var ctaVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSCTA_VARIANT>? { __data["ctaVariant"] }

                      struct Fragments: FragmentContainer {
                        let __data: DataDict
                        init(_dataDict: DataDict) { __data = _dataDict }

                        var ctaFields: CtaFields { _toFragment() }
                      }
                    }

                    /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsText
                    ///
                    /// Parent Type: `ComponentSectionsText`
                    struct AsComponentSectionsText: ForgeSchema.InlineFragment {
                      let __data: DataDict
                      init(_dataDict: DataDict) { __data = _dataDict }

                      typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent
                      static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsText }
                      static var __selections: [ApolloAPI.Selection] { [
                        .fragment(TextFields.self),
                      ] }
                      static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                        GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.self,
                        GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsText.self,
                        TextFields.self
                      ] }

                      var id: ForgeSchema.ID { __data["id"] }
                      var sectionKey: String? { __data["sectionKey"] }
                      var textHeading: String? { __data["textHeading"] }
                      var headingLevel: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSTEXT_HEADINGLEVEL>? { __data["headingLevel"] }
                      var textSubtitle: String? { __data["textSubtitle"] }
                      var textContentParagraphs: ForgeSchema.JSON? { __data["textContentParagraphs"] }
                      var textVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSTEXT_VARIANT>? { __data["textVariant"] }

                      struct Fragments: FragmentContainer {
                        let __data: DataDict
                        init(_dataDict: DataDict) { __data = _dataDict }

                        var textFields: TextFields { _toFragment() }
                      }
                    }

                    /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsRelatedQuestions
                    ///
                    /// Parent Type: `ComponentSectionsRelatedQuestions`
                    struct AsComponentSectionsRelatedQuestions: ForgeSchema.InlineFragment {
                      let __data: DataDict
                      init(_dataDict: DataDict) { __data = _dataDict }

                      typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent
                      static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsRelatedQuestions }
                      static var __selections: [ApolloAPI.Selection] { [
                        .fragment(RelatedQuestionsFields.self),
                      ] }
                      static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                        GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.self,
                        GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsRelatedQuestions.self,
                        RelatedQuestionsFields.self
                      ] }

                      var id: ForgeSchema.ID { __data["id"] }
                      var sectionKey: String? { __data["sectionKey"] }
                      var relatedQuestionsHeading: String? { __data["relatedQuestionsHeading"] }
                      var questions: [Question?]? { __data["questions"] }

                      struct Fragments: FragmentContainer {
                        let __data: DataDict
                        init(_dataDict: DataDict) { __data = _dataDict }

                        var relatedQuestionsFields: RelatedQuestionsFields { _toFragment() }
                      }

                      typealias Question = RelatedQuestionsFields.Question
                    }

                    /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsBibleQuotesCarousel
                    ///
                    /// Parent Type: `ComponentSectionsBibleQuotesCarousel`
                    struct AsComponentSectionsBibleQuotesCarousel: ForgeSchema.InlineFragment {
                      let __data: DataDict
                      init(_dataDict: DataDict) { __data = _dataDict }

                      typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent
                      static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsBibleQuotesCarousel }
                      static var __selections: [ApolloAPI.Selection] { [
                        .fragment(BibleQuotesCarouselFields.self),
                      ] }
                      static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                        GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.self,
                        GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsBibleQuotesCarousel.self,
                        BibleQuotesCarouselFields.self
                      ] }

                      var id: ForgeSchema.ID { __data["id"] }
                      var sectionKey: String? { __data["sectionKey"] }
                      var carouselHeading: String? { __data["carouselHeading"] }
                      var quotes: [Quote?]? { __data["quotes"] }

                      struct Fragments: FragmentContainer {
                        let __data: DataDict
                        init(_dataDict: DataDict) { __data = _dataDict }

                        var bibleQuotesCarouselFields: BibleQuotesCarouselFields { _toFragment() }
                      }

                      typealias Quote = BibleQuotesCarouselFields.Quote
                    }

                    /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsCard
                    ///
                    /// Parent Type: `ComponentSectionsCard`
                    struct AsComponentSectionsCard: ForgeSchema.InlineFragment {
                      let __data: DataDict
                      init(_dataDict: DataDict) { __data = _dataDict }

                      typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent
                      static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsCard }
                      static var __selections: [ApolloAPI.Selection] { [
                        .fragment(CardFields.self),
                      ] }
                      static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                        GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.self,
                        GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsCard.self,
                        CardFields.self
                      ] }

                      var id: ForgeSchema.ID { __data["id"] }
                      var sectionKey: String? { __data["sectionKey"] }
                      var cardTitle: String { __data["cardTitle"] }
                      var cardDescription: String { __data["cardDescription"] }
                      var media: Media? { __data["media"] }
                      var link: String? { __data["link"] }
                      var cardVariant: GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSCARD_VARIANT>? { __data["cardVariant"] }

                      struct Fragments: FragmentContainer {
                        let __data: DataDict
                        init(_dataDict: DataDict) { __data = _dataDict }

                        var cardFields: CardFields { _toFragment() }
                      }

                      typealias Media = CardFields.Media
                    }

                    /// Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsVideo
                    ///
                    /// Parent Type: `ComponentSectionsVideo`
                    struct AsComponentSectionsVideo: ForgeSchema.InlineFragment {
                      let __data: DataDict
                      init(_dataDict: DataDict) { __data = _dataDict }

                      typealias RootEntityType = GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent
                      static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsVideo }
                      static var __selections: [ApolloAPI.Selection] { [
                        .fragment(VideoSectionFields.self),
                      ] }
                      static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
                        GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.self,
                        GetWatchExperienceQuery.Data.Experience.Block.AsComponentSectionsSection.SectionContent.AsComponentSectionsContainer.Slot.SlotContent.AsComponentSectionsVideo.self,
                        VideoSectionFields.self
                      ] }

                      var id: ForgeSchema.ID { __data["id"] }
                      var sectionKey: String? { __data["sectionKey"] }
                      var streamingUrl: String { __data["streamingUrl"] }
                      var videoTitle: String? { __data["videoTitle"] }
                      var videoSubtitle: String? { __data["videoSubtitle"] }
                      var videoMedia: VideoMedia? { __data["videoMedia"] }
                      var sectionVideo: SectionVideo? { __data["sectionVideo"] }

                      struct Fragments: FragmentContainer {
                        let __data: DataDict
                        init(_dataDict: DataDict) { __data = _dataDict }

                        var videoSectionFields: VideoSectionFields { _toFragment() }
                      }

                      typealias VideoMedia = VideoSectionFields.VideoMedia

                      typealias SectionVideo = VideoSectionFields.SectionVideo
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

}