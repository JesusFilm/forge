import Foundation

/// The watch-side GraphQL documents.
///
/// THE TWO-QUERY SPLIT IS A PERFORMANCE LAW, NOT A STYLE CHOICE.
/// `videoBySlug` deliberately omits each dub's `downloads` and `subtitles`.
/// The React Native app records why (apps/tv/src/lib/videoQueries.ts:10):
/// projecting them inline made the payload ~9.5MB and the resolver ~13s on
/// `birth-of-jesus` (2,259 dubs). Verified independently here — `jesus`
/// currently returns 2,291 dubs. Anything that "simplifies" these back into
/// one query reintroduces a multi-second load on the biggest titles.
enum VideoQueries {
    /// Everything the watch screen needs to paint and to build its dub list.
    static let videoBySlug = """
    query TvNativeVideoBySlug($slug: String!, $locale: String!) {
      videoBySlug(slug: $slug) {
        id
        slug
        label
        images { url thumbnail mobileCinematicHigh mobileCinematicLow }
        primaryLanguage { bcp47 }
        locales(locale: $locale) { title description snippet }
        variants: dubs {
          id
          slug
          published
          hls
          duration
          language { bcp47 slug name }
          muxVideo { playbackId }
        }
      }
    }
    """

    /// Fetched for the ACTIVE dub only, on demand. See the law above.
    static let videoDub = """
    query TvNativeVideoDub($id: ID!) {
      videoDub(id: $id) {
        id
        downloads { id quality size url }
        videoEdition {
          subtitles {
            id
            language { slug name bcp47 }
            vttSrc
            primary
          }
        }
      }
    }
    """
}

// MARK: - Wire shapes

struct VideoBySlugData: Decodable {
    let videoBySlug: WireVideo?
}

struct WireVideo: Decodable {
    let id: String?
    let slug: String?
    let label: String?
    let images: [WireImage]?
    let primaryLanguage: WireLanguageRef?
    let locales: [WireLocale]?
    let variants: [WireDubDetail]?
}

struct WireImage: Decodable {
    let url: String?
    let thumbnail: String?
    let mobileCinematicHigh: String?
    /// Defaulted so adding a poster rung does not invalidate every existing
    /// fixture — in production this type is decoded, never constructed.
    var mobileCinematicLow: String? = nil
}

struct WireLanguageRef: Decodable {
    let bcp47: String?
}

struct WireLocale: Decodable {
    let title: String?
    let description: String?
    let snippet: String?
}

struct WireDubDetail: Decodable {
    let id: String?
    let slug: String?
    let published: Bool?
    let hls: String?
    let duration: Int?
    let language: WireLanguage?
    let muxVideo: WireMux?
}

struct WireLanguage: Decodable {
    let bcp47: String?
    let slug: String?
    /// JSONB locale map, e.g. `{"en": "Tera"}` — resolved client-side.
    let name: [String: String]?
}

struct VideoDubData: Decodable {
    let videoDub: WireDubMedia?
}

struct WireDubMedia: Decodable {
    let id: String?
    let downloads: [WireDownload]?
    let videoEdition: WireEdition?
}

struct WireDownload: Decodable {
    let id: String?
    let quality: String?
    let size: Double?
    let url: String?
}

struct WireEdition: Decodable {
    let subtitles: [WireSubtitle]?
}

struct WireSubtitle: Decodable {
    let id: String?
    let language: WireLanguage?
    let vttSrc: String?
    let primary: Bool?
}
