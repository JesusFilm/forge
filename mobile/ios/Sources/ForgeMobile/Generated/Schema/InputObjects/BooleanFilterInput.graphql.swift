// @generated
// This file was automatically generated and should not be edited.

import ApolloAPI

extension ForgeSchema {
  struct BooleanFilterInput: InputObject {
    private(set) var __data: InputDict

    init(_ data: InputDict) {
      __data = data
    }

    init(
      and: GraphQLNullable<[Bool?]> = nil,
      between: GraphQLNullable<[Bool?]> = nil,
      contains: GraphQLNullable<Bool> = nil,
      containsi: GraphQLNullable<Bool> = nil,
      endsWith: GraphQLNullable<Bool> = nil,
      eq: GraphQLNullable<Bool> = nil,
      eqi: GraphQLNullable<Bool> = nil,
      gt: GraphQLNullable<Bool> = nil,
      gte: GraphQLNullable<Bool> = nil,
      `in`: GraphQLNullable<[Bool?]> = nil,
      lt: GraphQLNullable<Bool> = nil,
      lte: GraphQLNullable<Bool> = nil,
      ne: GraphQLNullable<Bool> = nil,
      nei: GraphQLNullable<Bool> = nil,
      not: GraphQLNullable<BooleanFilterInput> = nil,
      notContains: GraphQLNullable<Bool> = nil,
      notContainsi: GraphQLNullable<Bool> = nil,
      notIn: GraphQLNullable<[Bool?]> = nil,
      notNull: GraphQLNullable<Bool> = nil,
      null: GraphQLNullable<Bool> = nil,
      or: GraphQLNullable<[Bool?]> = nil,
      startsWith: GraphQLNullable<Bool> = nil
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

    var and: GraphQLNullable<[Bool?]> {
      get { __data["and"] }
      set { __data["and"] = newValue }
    }

    var between: GraphQLNullable<[Bool?]> {
      get { __data["between"] }
      set { __data["between"] = newValue }
    }

    var contains: GraphQLNullable<Bool> {
      get { __data["contains"] }
      set { __data["contains"] = newValue }
    }

    var containsi: GraphQLNullable<Bool> {
      get { __data["containsi"] }
      set { __data["containsi"] = newValue }
    }

    var endsWith: GraphQLNullable<Bool> {
      get { __data["endsWith"] }
      set { __data["endsWith"] = newValue }
    }

    var eq: GraphQLNullable<Bool> {
      get { __data["eq"] }
      set { __data["eq"] = newValue }
    }

    var eqi: GraphQLNullable<Bool> {
      get { __data["eqi"] }
      set { __data["eqi"] = newValue }
    }

    var gt: GraphQLNullable<Bool> {
      get { __data["gt"] }
      set { __data["gt"] = newValue }
    }

    var gte: GraphQLNullable<Bool> {
      get { __data["gte"] }
      set { __data["gte"] = newValue }
    }

    var `in`: GraphQLNullable<[Bool?]> {
      get { __data["in"] }
      set { __data["in"] = newValue }
    }

    var lt: GraphQLNullable<Bool> {
      get { __data["lt"] }
      set { __data["lt"] = newValue }
    }

    var lte: GraphQLNullable<Bool> {
      get { __data["lte"] }
      set { __data["lte"] = newValue }
    }

    var ne: GraphQLNullable<Bool> {
      get { __data["ne"] }
      set { __data["ne"] = newValue }
    }

    var nei: GraphQLNullable<Bool> {
      get { __data["nei"] }
      set { __data["nei"] = newValue }
    }

    var not: GraphQLNullable<BooleanFilterInput> {
      get { __data["not"] }
      set { __data["not"] = newValue }
    }

    var notContains: GraphQLNullable<Bool> {
      get { __data["notContains"] }
      set { __data["notContains"] = newValue }
    }

    var notContainsi: GraphQLNullable<Bool> {
      get { __data["notContainsi"] }
      set { __data["notContainsi"] = newValue }
    }

    var notIn: GraphQLNullable<[Bool?]> {
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

    var or: GraphQLNullable<[Bool?]> {
      get { __data["or"] }
      set { __data["or"] = newValue }
    }

    var startsWith: GraphQLNullable<Bool> {
      get { __data["startsWith"] }
      set { __data["startsWith"] = newValue }
    }
  }

}