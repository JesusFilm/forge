import Foundation

/// Minimal GraphQL-over-HTTP transport: POST, JSON, Codable out.
///
/// Deliberately not Apollo iOS: two public queries do not justify codegen
/// machinery, and a hand-written transport keeps the failure surface small
/// enough to reason about on a device with no console. If the query count
/// grows past a handful, revisit.
struct GraphQLClient {
    var endpoint: URL = Config.adminGraphQLURL
    var session: URLSession = .shared

    struct GraphQLHTTPError: Error {
        let statusCode: Int
    }

    struct GraphQLServerError: Error {
        let messages: [String]
    }

    private struct Envelope<Data: Decodable>: Decodable {
        let data: Data?
        let errors: [ServerError]?

        struct ServerError: Decodable {
            let message: String
        }
    }

    func fetch<Data: Decodable>(
        _ type: Data.Type,
        query: String,
        variables: [String: Any]
    ) async throws -> Data {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.timeoutInterval = 15
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "query": query,
            "variables": variables,
        ])

        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200 ..< 300).contains(http.statusCode) {
            throw GraphQLHTTPError(statusCode: http.statusCode)
        }

        let envelope = try JSONDecoder().decode(Envelope<Data>.self, from: data)
        if let payload = envelope.data {
            return payload
        }
        throw GraphQLServerError(messages: envelope.errors?.map(\.message) ?? ["empty response"])
    }
}

/// The queries this app speaks, verbatim projections of what the React Native
/// app requests — same public fields, same aliases, so both clients exercise
/// one server contract.
enum Queries {
    /// Home: the `watch-home` Experience's MediaCollection rails.
    static let watchHomeExperience = """
    query TvNativeWatchHome($locale: String!, $slug: String!) {
      experienceBySlug(locale: $locale, slug: $slug) {
        id
        slug
        title
        blocks {
          __typename
          ... on MediaCollectionBlock {
            sectionKey
            mcTitle: title
            mcSubtitle: subtitle
            items {
              titleOverride
              subtitleOverride
              imageAsset { previewUrl }
              videoImage { previewUrl }
              videoDub { muxVideo { playbackId } }
              videoId
            }
          }
        }
      }
    }
    """

    /// Search: admin's public multilingual watchSearch.
    static let watchSearch = """
    query TvNativeWatchSearch($input: WatchSearchInput!) {
      watchSearch(input: $input) {
        query
        hasMore
        nextOffset
        results {
          type
          id
          slug
          title
          imageUrl
          snippet
          playbackId
          label
          childCount
        }
      }
    }
    """
}
