// @generated
// This file was automatically generated and should not be edited.

import ApolloAPI

extension ForgeSchema {
  struct IDFilterInput: InputObject {
    private(set) var __data: InputDict

    init(_ data: InputDict) {
      __data = data
    }

    init(
      and: GraphQLNullable<[ID?]> = nil,
      between: GraphQLNullable<[ID?]> = nil,
      contains: GraphQLNullable<ID> = nil,
      containsi: GraphQLNullable<ID> = nil,
      endsWith: GraphQLNullable<ID> = nil,
      eq: GraphQLNullable<ID> = nil,
      eqi: GraphQLNullable<ID> = nil,
      gt: GraphQLNullable<ID> = nil,
      gte: GraphQLNullable<ID> = nil,
      `in`: GraphQLNullable<[ID?]> = nil,
      lt: GraphQLNullable<ID> = nil,
      lte: GraphQLNullable<ID> = nil,
      ne: GraphQLNullable<ID> = nil,
      nei: GraphQLNullable<ID> = nil,
      not: GraphQLNullable<IDFilterInput> = nil,
      notContains: GraphQLNullable<ID> = nil,
      notContainsi: GraphQLNullable<ID> = nil,
      notIn: GraphQLNullable<[ID?]> = nil,
      notNull: GraphQLNullable<Bool> = nil,
      null: GraphQLNullable<Bool> = nil,
      or: GraphQLNullable<[ID?]> = nil,
      startsWith: GraphQLNullable<ID> = nil
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

    var and: GraphQLNullable<[ID?]> {
      get { __data["and"] }
      set { __data["and"] = newValue }
    }

    var between: GraphQLNullable<[ID?]> {
      get { __data["between"] }
      set { __data["between"] = newValue }
    }

    var contains: GraphQLNullable<ID> {
      get { __data["contains"] }
      set { __data["contains"] = newValue }
    }

    var containsi: GraphQLNullable<ID> {
      get { __data["containsi"] }
      set { __data["containsi"] = newValue }
    }

    var endsWith: GraphQLNullable<ID> {
      get { __data["endsWith"] }
      set { __data["endsWith"] = newValue }
    }

    var eq: GraphQLNullable<ID> {
      get { __data["eq"] }
      set { __data["eq"] = newValue }
    }

    var eqi: GraphQLNullable<ID> {
      get { __data["eqi"] }
      set { __data["eqi"] = newValue }
    }

    var gt: GraphQLNullable<ID> {
      get { __data["gt"] }
      set { __data["gt"] = newValue }
    }

    var gte: GraphQLNullable<ID> {
      get { __data["gte"] }
      set { __data["gte"] = newValue }
    }

    var `in`: GraphQLNullable<[ID?]> {
      get { __data["in"] }
      set { __data["in"] = newValue }
    }

    var lt: GraphQLNullable<ID> {
      get { __data["lt"] }
      set { __data["lt"] = newValue }
    }

    var lte: GraphQLNullable<ID> {
      get { __data["lte"] }
      set { __data["lte"] = newValue }
    }

    var ne: GraphQLNullable<ID> {
      get { __data["ne"] }
      set { __data["ne"] = newValue }
    }

    var nei: GraphQLNullable<ID> {
      get { __data["nei"] }
      set { __data["nei"] = newValue }
    }

    var not: GraphQLNullable<IDFilterInput> {
      get { __data["not"] }
      set { __data["not"] = newValue }
    }

    var notContains: GraphQLNullable<ID> {
      get { __data["notContains"] }
      set { __data["notContains"] = newValue }
    }

    var notContainsi: GraphQLNullable<ID> {
      get { __data["notContainsi"] }
      set { __data["notContainsi"] = newValue }
    }

    var notIn: GraphQLNullable<[ID?]> {
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

    var or: GraphQLNullable<[ID?]> {
      get { __data["or"] }
      set { __data["or"] = newValue }
    }

    var startsWith: GraphQLNullable<ID> {
      get { __data["startsWith"] }
      set { __data["startsWith"] = newValue }
    }
  }

}