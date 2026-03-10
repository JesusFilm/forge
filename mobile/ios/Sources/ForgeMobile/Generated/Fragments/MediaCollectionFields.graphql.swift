// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

extension ForgeSchema {
  struct MediaCollectionFields: ForgeSchema.SelectionSet, Fragment {
    static var fragmentDefinition: StaticString {
      #"fragment MediaCollectionFields on ComponentSectionsMediaCollection { __typename id sectionKey mediaCollectionTitle: title subtitle mediaCollectionDescription: description categoryLabel mediaCollectionCtaLink: ctaLink showItemNumbers footerText mediaCollectionVariant: variant items { __typename id titleOverride subtitleOverride collectionSize linkToSectionKey imageOverride { __typename url alternativeText } itemVideo: video { __typename documentId slug title image { __typename url alternativeText } } } }"#
    }

    let __data: DataDict
    init(_dataDict: DataDict) { __data = _dataDict }

    static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsMediaCollection }
    static var __selections: [ApolloAPI.Selection] { [
      .field("__typename", String.self),
      .field("id", ForgeSchema.ID.self),
      .field("sectionKey", String?.self),
      .field("title", alias: "mediaCollectionTitle", String?.self),
      .field("subtitle", String?.self),
      .field("description", alias: "mediaCollectionDescription", String?.self),
      .field("categoryLabel", String?.self),
      .field("ctaLink", alias: "mediaCollectionCtaLink", String?.self),
      .field("showItemNumbers", Bool?.self),
      .field("footerText", String?.self),
      .field("variant", alias: "mediaCollectionVariant", GraphQLEnum<ForgeSchema.ENUM_COMPONENTSECTIONSMEDIACOLLECTION_VARIANT>.self),
      .field("items", [Item?]?.self),
    ] }
    static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
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

    /// Item
    ///
    /// Parent Type: `ComponentSectionsMediaCollectionItem`
    struct Item: ForgeSchema.SelectionSet {
      let __data: DataDict
      init(_dataDict: DataDict) { __data = _dataDict }

      static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.ComponentSectionsMediaCollectionItem }
      static var __selections: [ApolloAPI.Selection] { [
        .field("__typename", String.self),
        .field("id", ForgeSchema.ID.self),
        .field("titleOverride", String?.self),
        .field("subtitleOverride", String?.self),
        .field("collectionSize", String?.self),
        .field("linkToSectionKey", String?.self),
        .field("imageOverride", ImageOverride?.self),
        .field("video", alias: "itemVideo", ItemVideo?.self),
      ] }
      static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
        MediaCollectionFields.Item.self
      ] }

      var id: ForgeSchema.ID { __data["id"] }
      var titleOverride: String? { __data["titleOverride"] }
      var subtitleOverride: String? { __data["subtitleOverride"] }
      var collectionSize: String? { __data["collectionSize"] }
      var linkToSectionKey: String? { __data["linkToSectionKey"] }
      var imageOverride: ImageOverride? { __data["imageOverride"] }
      var itemVideo: ItemVideo? { __data["itemVideo"] }

      /// Item.ImageOverride
      ///
      /// Parent Type: `UploadFile`
      struct ImageOverride: ForgeSchema.SelectionSet {
        let __data: DataDict
        init(_dataDict: DataDict) { __data = _dataDict }

        static var __parentType: any ApolloAPI.ParentType { ForgeSchema.Objects.UploadFile }
        static var __selections: [ApolloAPI.Selection] { [
          .field("__typename", String.self),
          .field("url", String.self),
          .field("alternativeText", String?.self),
        ] }
        static var __fulfilledFragments: [any ApolloAPI.SelectionSet.Type] { [
          MediaCollectionFields.Item.ImageOverride.self
        ] }

        var url: String { __data["url"] }
        var alternativeText: String? { __data["alternativeText"] }
      }

      /// Item.ItemVideo
      ///
      /// Parent Type: `Video`
      struct ItemVideo: ForgeSchema.SelectionSet {
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
          MediaCollectionFields.Item.ItemVideo.self
        ] }

        var documentId: ForgeSchema.ID { __data["documentId"] }
        var slug: String { __data["slug"] }
        var title: String { __data["title"] }
        var image: Image? { __data["image"] }

        /// Item.ItemVideo.Image
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
            MediaCollectionFields.Item.ItemVideo.Image.self
          ] }

          var url: String { __data["url"] }
          var alternativeText: String? { __data["alternativeText"] }
        }
      }
    }
  }

}