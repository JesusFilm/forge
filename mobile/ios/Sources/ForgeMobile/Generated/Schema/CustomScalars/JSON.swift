// @generated
// This file was automatically generated and can be edited to
// implement advanced custom scalar functionality.
//
// Any changes to this file will not be overwritten by future
// code generation execution.

import ApolloAPI

extension ForgeSchema {
  /// The `JSON` scalar type represents JSON values as specified by
  /// [ECMA-404](http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf).
  /// Wraps any JSON-compatible value (array, object, string, number, boolean, null).
  struct JSON: CustomScalarType, Hashable {
    let rawValue: AnyHashable

    init(_jsonValue value: ApolloAPI.JSONValue) throws {
      rawValue = value
    }

    var _jsonValue: ApolloAPI.JSONValue {
      rawValue
    }
  }

}