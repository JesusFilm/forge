// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

extension ForgeSchema {
  struct VideoHeroFields: ForgeSchema.SelectionSet, Fragment {
    static var fragmentDefinition: StaticString {
      #"fragment VideoHeroFields on ComponentSectionsVideoHero { __typename id sectionKey videoHeroHeading: heading subheading streamingUrl ctaLink ctaLabel heroVideo: video { __typename documentId slug title image { __typename url alternativeText } } }"#
    }

    let __data: DataDict
    init(_dataDict: DataDict) { __data = _dataDict }

    static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsVideoHero }
    static var __selections: [ApolloAPI.Selection] { [
      .field("__typename", String.self),
      .field("id", ForgeSchema.ID.self),
      .field("sectionKey", String?.self),
      .field("heading", alias: "videoHeroHeading", String?.self),
      .field("subheading", String?.self),
      .field("streamingUrl", String.self),
      .field("ctaLink", String?.self),
      .field("ctaLabel", String?.self),
      .field("video", alias: "heroVideo", HeroVideo.self),
    ] }
    static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      VideoHeroFields.self
    ] }

    var id: ForgeSchema.ID { __data["id"] }
    var sectionKey: String? { __data["sectionKey"] }
    var videoHeroHeading: String? { __data["videoHeroHeading"] }
    var subheading: String? { __data["subheading"] }
    var streamingUrl: String { __data["streamingUrl"] }
    var ctaLink: String? { __data["ctaLink"] }
    var ctaLabel: String? { __data["ctaLabel"] }
    var heroVideo: HeroVideo { __data["heroVideo"] }

    /// HeroVideo
    ///
    /// Parent Type: `Video`
    struct HeroVideo: ForgeSchema.SelectionSet {
      let __data: DataDict
      init(_dataDict: DataDict) { __data = _dataDict }

      static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.Video }
      static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("documentId", ForgeSchema.ID.self),
        .field("slug", String.self),
        .field("title", String.self),
        .field("image", Image?.self),
      ] }
      static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        VideoHeroFields.HeroVideo.self
      ] }

      var documentId: ForgeSchema.ID { __data["documentId"] }
      var slug: String { __data["slug"] }
      var title: String { __data["title"] }
      var image: Image? { __data["image"] }

      /// HeroVideo.Image
      ///
      /// Parent Type: `UploadFile`
      struct Image: ForgeSchema.SelectionSet {
        let __data: DataDict
        init(_dataDict: DataDict) { __data = _dataDict }

        static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.UploadFile }
        static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("url", String.self),
          .field("alternativeText", String?.self),
        ] }
        static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
          VideoHeroFields.HeroVideo.Image.self
        ] }

        var url: String { __data["url"] }
        var alternativeText: String? { __data["alternativeText"] }
      }
    }
  }

}