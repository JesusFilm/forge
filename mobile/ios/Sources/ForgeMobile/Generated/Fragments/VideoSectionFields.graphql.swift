// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

extension ForgeSchema {
  struct VideoSectionFields: ForgeSchema.SelectionSet, Fragment {
    static var fragmentDefinition: StaticString {
      #"fragment VideoSectionFields on ComponentSectionsVideo { __typename id sectionKey streamingUrl videoTitle: title videoSubtitle: subtitle videoMedia: media { __typename url alternativeText } sectionVideo: video { __typename documentId slug title image { __typename url alternativeText } } }"#
    }

    let __data: DataDict
    init(_dataDict: DataDict) { __data = _dataDict }

    static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsVideo }
    static var __selections: [ApolloAPI.Selection] { [
      .field("__typename", String.self),
      .field("id", ForgeSchema.ID.self),
      .field("sectionKey", String?.self),
      .field("streamingUrl", String.self),
      .field("title", alias: "videoTitle", String?.self),
      .field("subtitle", alias: "videoSubtitle", String?.self),
      .field("media", alias: "videoMedia", VideoMedia?.self),
      .field("video", alias: "sectionVideo", SectionVideo?.self),
    ] }
    static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
      VideoSectionFields.self
    ] }

    var id: ForgeSchema.ID { __data["id"] }
    var sectionKey: String? { __data["sectionKey"] }
    var streamingUrl: String { __data["streamingUrl"] }
    var videoTitle: String? { __data["videoTitle"] }
    var videoSubtitle: String? { __data["videoSubtitle"] }
    var videoMedia: VideoMedia? { __data["videoMedia"] }
    var sectionVideo: SectionVideo? { __data["sectionVideo"] }

    /// VideoMedia
    ///
    /// Parent Type: `UploadFile`
    struct VideoMedia: ForgeSchema.SelectionSet {
      let __data: DataDict
      init(_dataDict: DataDict) { __data = _dataDict }

      static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.UploadFile }
      static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("url", String.self),
        .field("alternativeText", String?.self),
      ] }
      static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        VideoSectionFields.VideoMedia.self
      ] }

      var url: String { __data["url"] }
      var alternativeText: String? { __data["alternativeText"] }
    }

    /// SectionVideo
    ///
    /// Parent Type: `Video`
    struct SectionVideo: ForgeSchema.SelectionSet {
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
        VideoSectionFields.SectionVideo.self
      ] }

      var documentId: ForgeSchema.ID { __data["documentId"] }
      var slug: String { __data["slug"] }
      var title: String { __data["title"] }
      var image: Image? { __data["image"] }

      /// SectionVideo.Image
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
          VideoSectionFields.SectionVideo.Image.self
        ] }

        var url: String { __data["url"] }
        var alternativeText: String? { __data["alternativeText"] }
      }
    }
  }

}