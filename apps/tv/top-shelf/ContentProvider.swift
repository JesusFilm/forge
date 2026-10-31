import Foundation
import TVServices
import OSLog

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
  private static let feedQueue = DispatchQueue(label: "org.jesusfilm.watch.top-shelf.public-feed")
  private static var loadGeneration = 0
  private static var activeRequest: TopShelfFeedRequest?
  private static var pendingLoad: PendingLoad?

  // Owned exclusively by feedQueue. Finish the outgoing load before starting
  // its successor, so a delayed cancellation cannot enqueue nil after new data.
  private final class PendingLoad {
    private var completion: ((TVTopShelfContent?) -> Void)?
    init(_ completion: @escaping (TVTopShelfContent?) -> Void) { self.completion = completion }
    func finish(_ content: TVTopShelfContent?) {
      guard let callback = completion else { return }
      completion = nil
      DispatchQueue.main.async { callback(content) }
    }
  }
  private let logger = Logger(subsystem: "org.jesusfilm.watch.topshelf", category: "public-feed")

  private struct AppSnapshotState {
    let exists: Bool
    let bytes: Data?
    let snapshot: Snapshot?
    var publicContext: TopShelfAppContext {
      TopShelfAppContext(fileExists: exists, snapshot: snapshot)
    }
  }

  override func loadTopShelfContent(completionHandler: @escaping (TVTopShelfContent?) -> Void) {
    Self.feedQueue.async {
      let directory = self.sharedDirectory()
      let configuration = TopShelfFeedConfiguration(bundle: .main)
      if let outgoing = Self.pendingLoad {
        outgoing.finish(self.currentFallback(directory: directory, configuration: configuration))
      }
      Self.activeRequest?.cancel()
      Self.activeRequest = nil
      Self.loadGeneration += 1
      let generation = Self.loadGeneration
      let load = PendingLoad(completionHandler)
      Self.pendingLoad = load
      self.logger.info("load_requested pid=\(ProcessInfo.processInfo.processIdentifier, privacy: .public)")
      let finish: (TVTopShelfContent?) -> Void = { content in
        load.finish(content)
        if Self.pendingLoad === load { Self.pendingLoad = nil }
      }
      let initial = self.readAppSnapshot(directory: directory)
      guard let configuration, let directory else {
        finish(self.currentFallback(directory: directory, configuration: configuration))
        return
      }
      // An invalid app file fails closed. Continue is app-owned: no remote
      // progress, history identifiers or recommendation capabilities are sent.
      guard !initial.exists || initial.snapshot != nil else {
        finish(nil)
        return
      }
      let language = initial.snapshot?.language ?? "english"
      let concept = initial.snapshot?.concept ?? "collection"
      guard concept != "continue",
            let requestURL = configuration.requestURL(language: language, concept: concept) else {
        finish(self.currentFallback(directory: directory, configuration: configuration))
        return
      }
      let store = PublicShelfFeedStore(directory: directory.appendingPathComponent("Library/Caches/TopShelfPublic", isDirectory: true))
      self.logger.info("request_started concept=\(concept, privacy: .public) language=\(language, privacy: .public)")
      let started = ProcessInfo.processInfo.systemUptime
      let request = TopShelfFeedRequest(url: requestURL) { result in
        Self.feedQueue.async {
          guard generation == Self.loadGeneration else {
            self.logger.info("request_superseded_already_completed")
            return
          }
          Self.activeRequest = nil
          let current = self.readAppSnapshot(directory: directory)
          guard current.publicContext == initial.publicContext else {
            self.logger.info("app_context_changed")
            finish(self.currentFallback(directory: directory, configuration: configuration))
            return
          }
          do {
            let data = try result.get()
            let feed = try PublicShelfFeed.decode(data, language: language, concept: concept, now: Date())
            let accepted = try store.accept(feed, endpoint: configuration.endpoint, language: language, concept: concept)
            let latest = self.readAppSnapshot(directory: directory)
            guard latest.publicContext == initial.publicContext else {
              self.logger.info("app_context_changed_after_cache")
              finish(self.currentFallback(directory: directory, configuration: configuration))
              return
            }
            let milliseconds = Int((ProcessInfo.processInfo.systemUptime - started) * 1000)
            self.logger.info("feed_accepted revision=\(accepted.revision, privacy: .public) items=\(accepted.items.count, privacy: .public) elapsed_ms=\(milliseconds, privacy: .public)")
            finish(accepted.isFresh(at: Date()) ? self.content(accepted.snapshot) : nil)
          } catch {
            // Once a public response (including empty) is accepted, it owns this
            // context. Expiry must not resurrect an older app/bundled snapshot.
            self.logger.info("feed_unavailable_using_bounded_fallback")
            finish(self.currentFallback(directory: directory, configuration: configuration))
          }
        }
      }
      Self.activeRequest = request
      request.start()
    }
  }

  private func currentFallback(directory: URL?, configuration: TopShelfFeedConfiguration?, attempt: Int = 0) -> TVTopShelfContent? {
    let state = readAppSnapshot(directory: directory)
    let language = state.snapshot?.language ?? "english"
    let concept = state.snapshot?.concept ?? "collection"
    let result: TVTopShelfContent?
    var publicAuthority = false
    if let directory, let configuration,
       (!state.exists || state.snapshot != nil), concept != "continue",
       configuration.requestURL(language: language, concept: concept) != nil {
      let store = PublicShelfFeedStore(directory: directory.appendingPathComponent("Library/Caches/TopShelfPublic", isDirectory: true))
      switch store.cached(endpoint: configuration.endpoint, language: language, concept: concept) {
      case .value(let feed):
        publicAuthority = true
        result = feed.isFresh(at: Date()) ? content(feed.snapshot) : nil
      case .absent:
        result = localContent(state)
      case .invalid, .otherContext:
        publicAuthority = true
        result = nil
      }
    } else {
      result = localContent(state)
    }
    // A cache lock can wait while the main app changes language/style. Retry
    // once against the new context, then fail closed if it changes again.
    let latest = readAppSnapshot(directory: directory)
    // A configured public feed owns public items for this context, independently
    // of same-style in-app recommendations. App-owned/history fallback still
    // requires identical bytes; no public response supplies private progress.
    let unchanged = publicAuthority
      ? latest.publicContext == state.publicContext
      : latest.exists == state.exists && latest.bytes == state.bytes
    guard unchanged else {
      return attempt == 0 ? currentFallback(directory: directory, configuration: configuration, attempt: 1) : nil
    }
    return result
  }

  private func sharedDirectory() -> URL? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "ForgeTopShelfAppGroup") as? String else { return nil }
    return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
  }

  private func readAppSnapshot(directory: URL?) -> AppSnapshotState {
    guard let directory else { return AppSnapshotState(exists: false, bytes: nil, snapshot: nil) }
    let url = directory.appendingPathComponent("Library/Caches/top-shelf.json")
    guard FileManager.default.fileExists(atPath: url.path) else {
      return AppSnapshotState(exists: false, bytes: nil, snapshot: nil)
    }
    guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 65536,
          let data = try? Data(contentsOf: url), data.count <= 65536 else {
      return AppSnapshotState(exists: true, bytes: nil, snapshot: nil)
    }
    guard let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data),
          snapshot.schemaVersion == 1, snapshot.items.count <= 10 else {
      return AppSnapshotState(exists: true, bytes: data, snapshot: nil)
    }
    return AppSnapshotState(exists: true, bytes: data, snapshot: snapshot)
  }

  private func localContent(_ state: AppSnapshotState) -> TVTopShelfContent? {
    if state.exists {
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      guard let snapshot = state.snapshot,
            let expiry = formatter.date(from: snapshot.expiresAt), expiry > Date() else { return nil }
      return content(snapshot)
    }
    return bundledContent()
  }

  private func bundledContent() -> TVTopShelfContent? {
    guard let catalogURL = Bundle.main.url(forResource: "catalog", withExtension: "json"),
          let data = try? Data(contentsOf: catalogURL),
          let videos = try? JSONDecoder().decode([FeaturedVideo].self, from: data),
          let scheme = Bundle.main.object(forInfoDictionaryKey: "ForgeURLScheme") as? String else {
      return nil
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

    return items.isEmpty ? nil : TVTopShelfCarouselContent(style: .details, items: items)
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
        // Cache freshness is not content availability. Assigning its TTL to
        // expirationDate makes tvOS replace the title with a countdown.
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
