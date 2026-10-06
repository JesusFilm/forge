import Foundation
import TVServices

private struct ShelfItem: Decodable {
  let id: String
  let slug: String
  let title: String
  let summary: String
  let imageURL: String
  let duration: Double
  let kind: String
  let progress: Double?
  let previewURL: String?
}
private struct Snapshot: Decodable {
  let schemaVersion: Int
  let concept: String
  let language: String
  let expiresAt: String
  let items: [ShelfItem]
}

private struct FeaturedVideo: Decodable {
  let id: String
  let slug: String
  let title: String
  let summary: String
  let duration: Double
  let genre: String
  let imageName: String
  let previewName: String?
}

final class ContentProvider: TVTopShelfContentProvider {
  override func loadTopShelfContent(completionHandler: @escaping (TVTopShelfContent?) -> Void) {
    if let group = Bundle.main.object(forInfoDictionaryKey: "ForgeTopShelfAppGroup") as? String,
       let directory = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) {
      let url = directory.appendingPathComponent("top-shelf.json")
      if FileManager.default.fileExists(atPath: url.path) {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 65536,
              let data = try? Data(contentsOf: url),
              let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data),
              snapshot.schemaVersion == 1, snapshot.items.count <= 10,
              let expiry = formatter.date(from: snapshot.expiresAt), expiry > Date() else {
          completionHandler(nil)
          return
        }
        completionHandler(content(snapshot))
        return
      }
    }
    guard let catalogURL = Bundle.main.url(forResource: "catalog", withExtension: "json"),
          let data = try? Data(contentsOf: catalogURL),
          let videos = try? JSONDecoder().decode([FeaturedVideo].self, from: data),
          let scheme = Bundle.main.object(forInfoDictionaryKey: "ForgeURLScheme") as? String else {
      completionHandler(nil)
      return
    }

    let items = videos.compactMap { video -> TVTopShelfCarouselItem? in
      guard let imageURL = Bundle.main.url(forResource: video.imageName, withExtension: nil),
            let displayURL = watchURL(slug: video.slug, scheme: scheme, autoplay: false),
            let playURL = watchURL(slug: video.slug, scheme: scheme, autoplay: true) else { return nil }

      let item = TVTopShelfCarouselItem(identifier: video.id)
      item.title = video.title
      item.contextTitle = "Featured on Jesus Film"
      item.summary = video.summary
      item.genre = video.genre
      item.duration = video.duration
      item.setImageURL(imageURL, for: .screenScale1x)
      item.setImageURL(imageURL, for: .screenScale2x)
      if let previewName = video.previewName {
        item.previewVideoURL = Bundle.main.url(forResource: previewName, withExtension: nil)
      }
      item.playAction = TVTopShelfAction(url: playURL)
      item.displayAction = TVTopShelfAction(url: displayURL)
      return item
    }

    completionHandler(items.isEmpty ? nil : TVTopShelfCarouselContent(style: .details, items: items))
  }

  private func imageURL(_ value: String) -> URL? {
    guard let url = URL(string: value), url.scheme == "https", url.host != nil,
          url.user == nil, url.password == nil else { return nil }
    return url
  }

  private func content(_ snapshot: Snapshot) -> TVTopShelfContent? {
    let titles = ["spotlight": "Featured on Watch", "continue": "Continue Watching", "collection": "Discover the Collection", "short": "A Moment of Hope", "journey": "Choose Your Journey"]
    guard let title = titles[snapshot.concept],
          let scheme = Bundle.main.object(forInfoDictionaryKey: "ForgeURLScheme") as? String else { return nil }
    let valid = snapshot.items.filter {
      !$0.title.isEmpty && $0.title.count <= 200 && $0.summary.count <= 500 &&
      $0.duration.isFinite && $0.duration >= 0 && imageURL($0.imageURL) != nil &&
      $0.slug.range(of: "^[a-zA-Z0-9_-]{1,160}$", options: .regularExpression) != nil &&
      ["video", "section"].contains($0.kind)
    }
    guard !valid.isEmpty else { return nil }
    if snapshot.concept == "spotlight" || snapshot.concept == "short" {
      let items = valid.filter { $0.kind == "video" }.map { video -> TVTopShelfCarouselItem in
        let item = TVTopShelfCarouselItem(identifier: video.id)
        item.title = video.title
        item.contextTitle = title
        item.summary = video.summary
        item.duration = video.duration
        item.setImageURL(imageURL(video.imageURL)!, for: .screenScale1x)
        item.setImageURL(imageURL(video.imageURL)!, for: .screenScale2x)
        if let preview = video.previewURL { item.previewVideoURL = imageURL(preview) }
        if video.slug == "jesus" && snapshot.language == "english" && item.previewVideoURL == nil {
          item.previewVideoURL = Bundle.main.url(forResource: "jesus-preview", withExtension: "mp4")
        }
        item.playAction = watchURL(slug: video.slug, scheme: scheme, autoplay: true).map(TVTopShelfAction.init(url:))
        item.displayAction = watchURL(slug: video.slug, scheme: scheme, autoplay: false).map(TVTopShelfAction.init(url:))
        return item
      }
      return items.isEmpty ? nil : TVTopShelfCarouselContent(style: .details, items: items)
    }
    let items = valid.map { video -> TVTopShelfSectionedItem in
      let item = TVTopShelfSectionedItem(identifier: video.id)
      item.title = video.title
      item.imageShape = .hdtv
      item.setImageURL(imageURL(video.imageURL)!, for: .screenScale1x)
      item.setImageURL(imageURL(video.imageURL)!, for: .screenScale2x)
      if snapshot.concept == "continue", let progress = video.progress, progress.isFinite {
        item.playbackProgress = max(0, min(1, progress))
      }
      if video.kind == "section" {
        var url = URLComponents()
        url.scheme = scheme
        url.host = "top-shelf-topic"
        url.path = "/" + video.slug
        url.queryItems = [URLQueryItem(name: "topShelf", value: "1")]
        item.displayAction = url.url.map(TVTopShelfAction.init(url:))
      } else {
        item.playAction = watchURL(slug: video.slug, scheme: scheme, autoplay: true).map(TVTopShelfAction.init(url:))
        item.displayAction = watchURL(slug: video.slug, scheme: scheme, autoplay: snapshot.concept == "continue").map(TVTopShelfAction.init(url:))
      }
      return item
    }
    let section = TVTopShelfItemCollection(items: items)
    section.title = title
    return TVTopShelfSectionedContent(sections: [section])
  }

  private func watchURL(slug: String, scheme: String, autoplay: Bool) -> URL? {
    guard slug.range(of: "^[a-zA-Z0-9_-]{1,160}$", options: .regularExpression) != nil else { return nil }
    var components = URLComponents()
    components.scheme = scheme
    components.host = "watch"
    components.path = "/" + slug
    components.queryItems = [URLQueryItem(name: "topShelf", value: "1")]
    if autoplay { components.queryItems?.append(URLQueryItem(name: "autoplay", value: "1")) }
    return components.url
  }
}
