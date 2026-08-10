import Foundation

// Wire shapes (Codable, every field optional — admin nullability is the wire
// contract) and the narrowed UI projections screens actually render. The
// narrowing mirrors the React Native normalizer's philosophy: drop rows the
// UI cannot render rather than threading optionals through every view.

// MARK: - Wire: watch-home experience

struct WatchHomeData: Decodable {
    let experienceBySlug: WireExperience?
}

struct WireExperience: Decodable {
    let id: String?
    let slug: String?
    let title: String?
    let blocks: [WireBlock]?
}

struct WireBlock: Decodable {
    let __typename: String?
    let sectionKey: String?
    let mcTitle: String?
    let mcSubtitle: String?
    let items: [WireCollectionItem]?
}

struct WireCollectionItem: Decodable {
    let titleOverride: String?
    let subtitleOverride: String?
    let imageAsset: WirePreview?
    let videoImage: WirePreview?
    let videoDub: WireDub?
    let videoId: String?
}

struct WirePreview: Decodable {
    let previewUrl: String?
}

struct WireDub: Decodable {
    let muxVideo: WireMux?
}

struct WireMux: Decodable {
    let playbackId: String?
}

// MARK: - Wire: watchSearch

struct WatchSearchData: Decodable {
    let watchSearch: WireSearchPayload?
}

struct WireSearchPayload: Decodable {
    let query: String?
    let hasMore: Bool?
    let nextOffset: Int?
    let results: [WireSearchResult]?
}

struct WireSearchResult: Decodable {
    let type: String?
    let id: String?
    let slug: String?
    let title: String?
    let imageUrl: String?
    let snippet: String?
    let playbackId: String?
    let label: String?
    let childCount: Int?
}

// MARK: - UI projections

struct HomeModel: Equatable {
    let rails: [Rail]
}

struct Rail: Equatable, Identifiable {
    let id: String
    let title: String
    let items: [VideoCard]
}

struct VideoCard: Equatable, Identifiable {
    let id: String
    let title: String
    let posterURL: URL?
    /// Present when the card is directly playable.
    let playbackID: String?
}

enum HomeProjection {
    /// MediaCollection blocks → rails. A rail with no renderable card is
    /// dropped whole; a card without a title or identity is dropped. Poster
    /// precedence mirrors the RN card-image rule: item image first, then the
    /// video's own image.
    static func project(_ data: WatchHomeData) -> HomeModel {
        let blocks = data.experienceBySlug?.blocks ?? []
        var rails: [Rail] = []
        for (index, block) in blocks.enumerated() {
            guard block.__typename == "MediaCollectionBlock" else { continue }
            let cards = (block.items ?? []).compactMap(card(from:))
            guard !cards.isEmpty else { continue }
            rails.append(
                Rail(
                    id: block.sectionKey ?? "rail-\(index)",
                    title: block.mcTitle ?? block.mcSubtitle ?? "",
                    items: cards
                )
            )
        }
        return HomeModel(rails: rails)
    }

    private static func card(from item: WireCollectionItem) -> VideoCard? {
        let playbackID = item.videoDub?.muxVideo?.playbackId
        // Identity: prefer the stable videoId; a playable card may fall back
        // to its playback id. No identity at all = unrenderable.
        guard let id = item.videoId ?? playbackID else { return nil }
        guard let title = item.titleOverride ?? item.subtitleOverride else { return nil }
        let poster = item.imageAsset?.previewUrl ?? item.videoImage?.previewUrl
        return VideoCard(
            id: id,
            title: title,
            posterURL: poster.flatMap(URL.init(string:)),
            playbackID: playbackID
        )
    }
}

struct SearchResultRow: Equatable, Identifiable {
    let id: String
    let title: String
    let imageURL: URL?
    let playbackID: String?
    let label: String?
}

enum SearchProjection {
    /// Server rows → renderable rows: id + title are load-bearing, the rest
    /// degrades gracefully.
    static func project(_ data: WatchSearchData) -> [SearchResultRow] {
        (data.watchSearch?.results ?? []).compactMap { row in
            guard let id = row.id, let title = row.title else { return nil }
            return SearchResultRow(
                id: id,
                title: title,
                imageURL: row.imageUrl.flatMap(URL.init(string:)),
                playbackID: row.playbackId,
                label: row.label
            )
        }
    }
}
