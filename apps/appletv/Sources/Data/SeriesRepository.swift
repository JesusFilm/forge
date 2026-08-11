import Foundation

/// Series-side data access, mirroring `VideoRepository`.
struct SeriesRepository {
    var client = GraphQLClient()

    func series(slug: String) async throws -> SeriesDetail? {
        let data = try await client.fetch(
            SeriesBySlugData.self,
            query: SeriesQueries.seriesBySlug,
            variables: ["slug": slug, "locale": Config.contentLocale]
        )
        return SeriesProjection.project(data)
    }
}
