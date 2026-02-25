// @generated
// This file was automatically generated and should not be edited.

import ApolloAPI

extension ForgeSchema {
  struct DateTimeFilterInput: InputObject {
    private(set) var __data: InputDict

    init(_ data: InputDict) {
      __data = data
    }

    init(
      and: GraphQLNullable<[DateTime?]> = nil,
      between: GraphQLNullable<[DateTime?]> = nil,
      contains: GraphQLNullable<DateTime> = nil,
      containsi: GraphQLNullable<DateTime> = nil,
      endsWith: GraphQLNullable<DateTime> = nil,
      eq: GraphQLNullable<DateTime> = nil,
      eqi: GraphQLNullable<DateTime> = nil,
      gt: GraphQLNullable<DateTime> = nil,
      gte: GraphQLNullable<DateTime> = nil,
      `in`: GraphQLNullable<[DateTime?]> = nil,
      lt: GraphQLNullable<DateTime> = nil,
      lte: GraphQLNullable<DateTime> = nil,
      ne: GraphQLNullable<DateTime> = nil,
      nei: GraphQLNullable<DateTime> = nil,
      not: GraphQLNullable<DateTimeFilterInput> = nil,
      notContains: GraphQLNullable<DateTime> = nil,
      notContainsi: GraphQLNullable<DateTime> = nil,
      notIn: GraphQLNullable<[DateTime?]> = nil,
      notNull: GraphQLNullable<Bool> = nil,
      null: GraphQLNullable<Bool> = nil,
      or: GraphQLNullable<[DateTime?]> = nil,
      startsWith: GraphQLNullable<DateTime> = nil
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

    var and: GraphQLNullable<[DateTime?]> {
      get { __data["and"] }
      set { __data["and"] = newValue }
    }

    var between: GraphQLNullable<[DateTime?]> {
      get { __data["between"] }
      set { __data["between"] = newValue }
    }

    var contains: GraphQLNullable<DateTime> {
      get { __data["contains"] }
      set { __data["contains"] = newValue }
    }

    var containsi: GraphQLNullable<DateTime> {
      get { __data["containsi"] }
      set { __data["containsi"] = newValue }
    }

    var endsWith: GraphQLNullable<DateTime> {
      get { __data["endsWith"] }
      set { __data["endsWith"] = newValue }
    }

    var eq: GraphQLNullable<DateTime> {
      get { __data["eq"] }
      set { __data["eq"] = newValue }
    }

    var eqi: GraphQLNullable<DateTime> {
      get { __data["eqi"] }
      set { __data["eqi"] = newValue }
    }

    var gt: GraphQLNullable<DateTime> {
      get { __data["gt"] }
      set { __data["gt"] = newValue }
    }

    var gte: GraphQLNullable<DateTime> {
      get { __data["gte"] }
      set { __data["gte"] = newValue }
    }

    var `in`: GraphQLNullable<[DateTime?]> {
      get { __data["in"] }
      set { __data["in"] = newValue }
    }

    var lt: GraphQLNullable<DateTime> {
      get { __data["lt"] }
      set { __data["lt"] = newValue }
    }

    var lte: GraphQLNullable<DateTime> {
      get { __data["lte"] }
      set { __data["lte"] = newValue }
    }

    var ne: GraphQLNullable<DateTime> {
      get { __data["ne"] }
      set { __data["ne"] = newValue }
    }

    var nei: GraphQLNullable<DateTime> {
      get { __data["nei"] }
      set { __data["nei"] = newValue }
    }

    var not: GraphQLNullable<DateTimeFilterInput> {
      get { __data["not"] }
      set { __data["not"] = newValue }
    }

    var notContains: GraphQLNullable<DateTime> {
      get { __data["notContains"] }
      set { __data["notContains"] = newValue }
    }

    var notContainsi: GraphQLNullable<DateTime> {
      get { __data["notContainsi"] }
      set { __data["notContainsi"] = newValue }
    }

    var notIn: GraphQLNullable<[DateTime?]> {
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

    var or: GraphQLNullable<[DateTime?]> {
      get { __data["or"] }
      set { __data["or"] = newValue }
    }

    var startsWith: GraphQLNullable<DateTime> {
      get { __data["startsWith"] }
      set { __data["startsWith"] = newValue }
    }
  }

}