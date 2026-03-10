// @generated
// This file was automatically generated and should not be edited.

import ApolloAPI

extension ForgeSchema {
  struct ExperienceFiltersInput: InputObject {
    private(set) var __data: InputDict

    init(_ data: InputDict) {
      __data = data
    }

    init(
      and: GraphQLNullable<[ExperienceFiltersInput?]> = nil,
      createdAt: GraphQLNullable<DateTimeFilterInput> = nil,
      documentId: GraphQLNullable<IDFilterInput> = nil,
      isHomepage: GraphQLNullable<BooleanFilterInput> = nil,
      locale: GraphQLNullable<StringFilterInput> = nil,
      localizations: GraphQLNullable<ExperienceFiltersInput> = nil,
      metaDescription: GraphQLNullable<StringFilterInput> = nil,
      not: GraphQLNullable<ExperienceFiltersInput> = nil,
      ogDescription: GraphQLNullable<StringFilterInput> = nil,
      ogTitle: GraphQLNullable<StringFilterInput> = nil,
      or: GraphQLNullable<[ExperienceFiltersInput?]> = nil,
      pathSegment: GraphQLNullable<StringFilterInput> = nil,
      publishedAt: GraphQLNullable<DateTimeFilterInput> = nil,
      slug: GraphQLNullable<StringFilterInput> = nil,
      title: GraphQLNullable<StringFilterInput> = nil,
      updatedAt: GraphQLNullable<DateTimeFilterInput> = nil
    ) {
      __data = InputDict([
        "and": and,
        "createdAt": createdAt,
        "documentId": documentId,
        "isHomepage": isHomepage,
        "locale": locale,
        "localizations": localizations,
        "metaDescription": metaDescription,
        "not": not,
        "ogDescription": ogDescription,
        "ogTitle": ogTitle,
        "or": or,
        "pathSegment": pathSegment,
        "publishedAt": publishedAt,
        "slug": slug,
        "title": title,
        "updatedAt": updatedAt
      ])
    }

    var and: GraphQLNullable<[ExperienceFiltersInput?]> {
      get { __data["and"] }
      set { __data["and"] = newValue }
    }

    var createdAt: GraphQLNullable<DateTimeFilterInput> {
      get { __data["createdAt"] }
      set { __data["createdAt"] = newValue }
    }

    var documentId: GraphQLNullable<IDFilterInput> {
      get { __data["documentId"] }
      set { __data["documentId"] = newValue }
    }

    var isHomepage: GraphQLNullable<BooleanFilterInput> {
      get { __data["isHomepage"] }
      set { __data["isHomepage"] = newValue }
    }

    var locale: GraphQLNullable<StringFilterInput> {
      get { __data["locale"] }
      set { __data["locale"] = newValue }
    }

    var localizations: GraphQLNullable<ExperienceFiltersInput> {
      get { __data["localizations"] }
      set { __data["localizations"] = newValue }
    }

    var metaDescription: GraphQLNullable<StringFilterInput> {
      get { __data["metaDescription"] }
      set { __data["metaDescription"] = newValue }
    }

    var not: GraphQLNullable<ExperienceFiltersInput> {
      get { __data["not"] }
      set { __data["not"] = newValue }
    }

    var ogDescription: GraphQLNullable<StringFilterInput> {
      get { __data["ogDescription"] }
      set { __data["ogDescription"] = newValue }
    }

    var ogTitle: GraphQLNullable<StringFilterInput> {
      get { __data["ogTitle"] }
      set { __data["ogTitle"] = newValue }
    }

    var or: GraphQLNullable<[ExperienceFiltersInput?]> {
      get { __data["or"] }
      set { __data["or"] = newValue }
    }

    var pathSegment: GraphQLNullable<StringFilterInput> {
      get { __data["pathSegment"] }
      set { __data["pathSegment"] = newValue }
    }

    var publishedAt: GraphQLNullable<DateTimeFilterInput> {
      get { __data["publishedAt"] }
      set { __data["publishedAt"] = newValue }
    }

    var slug: GraphQLNullable<StringFilterInput> {
      get { __data["slug"] }
      set { __data["slug"] = newValue }
    }

    var title: GraphQLNullable<StringFilterInput> {
      get { __data["title"] }
      set { __data["title"] = newValue }
    }

    var updatedAt: GraphQLNullable<DateTimeFilterInput> {
      get { __data["updatedAt"] }
      set { __data["updatedAt"] = newValue }
    }
  }

}