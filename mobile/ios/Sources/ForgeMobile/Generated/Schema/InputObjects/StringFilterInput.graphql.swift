// @generated
// This file was automatically generated and should not be edited.

import ApolloAPI

extension ForgeSchema {
  struct StringFilterInput: InputObject {
    private(set) var __data: InputDict

    init(_ data: InputDict) {
      __data = data
    }

    init(
      and: GraphQLNullable<[String?]> = nil,
      between: GraphQLNullable<[String?]> = nil,
      contains: GraphQLNullable<String> = nil,
      containsi: GraphQLNullable<String> = nil,
      endsWith: GraphQLNullable<String> = nil,
      eq: GraphQLNullable<String> = nil,
      eqi: GraphQLNullable<String> = nil,
      gt: GraphQLNullable<String> = nil,
      gte: GraphQLNullable<String> = nil,
      `in`: GraphQLNullable<[String?]> = nil,
      lt: GraphQLNullable<String> = nil,
      lte: GraphQLNullable<String> = nil,
      ne: GraphQLNullable<String> = nil,
      nei: GraphQLNullable<String> = nil,
      not: GraphQLNullable<StringFilterInput> = nil,
      notContains: GraphQLNullable<String> = nil,
      notContainsi: GraphQLNullable<String> = nil,
      notIn: GraphQLNullable<[String?]> = nil,
      notNull: GraphQLNullable<Bool> = nil,
      null: GraphQLNullable<Bool> = nil,
      or: GraphQLNullable<[String?]> = nil,
      startsWith: GraphQLNullable<String> = nil
    ) {
      __data = InputDict([
        "and": and,
        "between": between,
        "contains": contains,
        "containsi": containsi,
        "endsWith": endsWith,
        "eq": eq,
        "eqi": eqi,
        "gt": gt,
        "gte": gte,
        "in": `in`,
        "lt": lt,
        "lte": lte,
        "ne": ne,
        "nei": nei,
        "not": not,
        "notContains": notContains,
        "notContainsi": notContainsi,
        "notIn": notIn,
        "notNull": notNull,
        "null": null,
        "or": or,
        "startsWith": startsWith
      ])
    }

    var and: GraphQLNullable<[String?]> {
      get { __data["and"] }
      set { __data["and"] = newValue }
    }

    var between: GraphQLNullable<[String?]> {
      get { __data["between"] }
      set { __data["between"] = newValue }
    }

    var contains: GraphQLNullable<String> {
      get { __data["contains"] }
      set { __data["contains"] = newValue }
    }

    var containsi: GraphQLNullable<String> {
      get { __data["containsi"] }
      set { __data["containsi"] = newValue }
    }

    var endsWith: GraphQLNullable<String> {
      get { __data["endsWith"] }
      set { __data["endsWith"] = newValue }
    }

    var eq: GraphQLNullable<String> {
      get { __data["eq"] }
      set { __data["eq"] = newValue }
    }

    var eqi: GraphQLNullable<String> {
      get { __data["eqi"] }
      set { __data["eqi"] = newValue }
    }

    var gt: GraphQLNullable<String> {
      get { __data["gt"] }
      set { __data["gt"] = newValue }
    }

    var gte: GraphQLNullable<String> {
      get { __data["gte"] }
      set { __data["gte"] = newValue }
    }

    var `in`: GraphQLNullable<[String?]> {
      get { __data["in"] }
      set { __data["in"] = newValue }
    }

    var lt: GraphQLNullable<String> {
      get { __data["lt"] }
      set { __data["lt"] = newValue }
    }

    var lte: GraphQLNullable<String> {
      get { __data["lte"] }
      set { __data["lte"] = newValue }
    }

    var ne: GraphQLNullable<String> {
      get { __data["ne"] }
      set { __data["ne"] = newValue }
    }

    var nei: GraphQLNullable<String> {
      get { __data["nei"] }
      set { __data["nei"] = newValue }
    }

    var not: GraphQLNullable<StringFilterInput> {
      get { __data["not"] }
      set { __data["not"] = newValue }
    }

    var notContains: GraphQLNullable<String> {
      get { __data["notContains"] }
      set { __data["notContains"] = newValue }
    }

    var notContainsi: GraphQLNullable<String> {
      get { __data["notContainsi"] }
      set { __data["notContainsi"] = newValue }
    }

    var notIn: GraphQLNullable<[String?]> {
      get { __data["notIn"] }
      set { __data["notIn"] = newValue }
    }

    var notNull: GraphQLNullable<Bool> {
      get { __data["notNull"] }
      set { __data["notNull"] = newValue }
    }

    var null: GraphQLNullable<Bool> {
      get { __data["null"] }
      set { __data["null"] = newValue }
    }

    var or: GraphQLNullable<[String?]> {
      get { __data["or"] }
      set { __data["or"] = newValue }
    }

    var startsWith: GraphQLNullable<String> {
      get { __data["startsWith"] }
      set { __data["startsWith"] = newValue }
    }
  }

}