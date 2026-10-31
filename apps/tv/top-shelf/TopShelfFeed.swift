import Foundation
import Darwin
import CryptoKit

struct ShelfItem: Codable, Equatable {
  let id: String
  let slug: String
  let title: String
  let summary: String
  let imageURL: String
  let duration: Double
  let kind: String
  let progress: Double?
  let previewURL: String?

  init(id: String, slug: String, title: String, summary: String, imageURL: String,
       duration: Double, kind: String, progress: Double? = nil, previewURL: String? = nil) {
    self.id = id; self.slug = slug; self.title = title; self.summary = summary
    self.imageURL = imageURL; self.duration = duration; self.kind = kind
    self.progress = progress; self.previewURL = previewURL
  }
}

struct Snapshot: Codable, Equatable {
  let schemaVersion: Int
  let concept: String
  let language: String
  let expiresAt: String
  let generatedAt: String?
  let items: [ShelfItem]

  init(schemaVersion: Int, concept: String, language: String, expiresAt: String,
       generatedAt: String? = nil, items: [ShelfItem]) {
    self.schemaVersion = schemaVersion; self.concept = concept; self.language = language
    self.expiresAt = expiresAt; self.generatedAt = generatedAt; self.items = items
  }
}

// Public feed authority depends only on selected language/style and whether the
// app context exists and parsed successfully. Item/copy/history rewrites in the
// same public context must not override an accepted feed or empty tombstone.
// The provider retains full-byte fences separately for app-owned/Continue paths.
enum TopShelfAppContext: Equatable {
  case absent
  case malformed
  case valid(language: String, concept: String)

  init(fileExists: Bool, snapshot: Snapshot?) {
    if !fileExists { self = .absent }
    else if let snapshot { self = .valid(language: snapshot.language, concept: snapshot.concept) }
    else { self = .malformed }
  }
}

enum TopShelfFeedError: Error, Equatable {
  case invalidConfiguration, invalidPayload, bodyTooLarge, invalidSchema, invalidRevision
  case invalidDates, contextMismatch, invalidItem, unknownField, unsupportedConcept
  case unexpectedResponse, unexpectedStatus(Int), redirectRejected, authenticationRejected
  case cancelled, timedOut, rollback, conflictingRevision, storageFailure
}

private enum FeedRules {
  static let maximumBytes = 65_536
  static let maximumRevision = 9_007_199_254_740_991
  static let concepts: Set<String> = ["spotlight", "collection", "short", "journey"]

  static func identifier(_ value: String) -> Bool {
    guard (1...160).contains(value.utf8.count) else { return false }
    return value.utf8.allSatisfy { (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }
  }

  static func date(_ value: String) -> Date? {
    guard value.utf8.count <= 64,
          value.range(of: "\\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})\\z", options: .regularExpression) != nil else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
  }

  static func artwork(_ value: String) -> Bool {
    guard value.utf16.count <= 2048, let url = URLComponents(string: value),
          value.unicodeScalars.allSatisfy({ $0.value > 32 && $0.value != 127 }),
          url.scheme?.lowercased() == "https", let host = url.host, !host.isEmpty,
          url.user == nil, url.password == nil, url.url != nil else { return false }
    return url.port.map { (1...65_535).contains($0) } ?? true
  }
}

struct PublicShelfFeed: Codable, Equatable {
  let schemaVersion: Int
  let revision: Int
  let generatedAt: String
  let expiresAt: String
  let language: String
  let concept: String
  let items: [ShelfItem]

  var snapshot: Snapshot {
    Snapshot(schemaVersion: 1, concept: concept, language: language, expiresAt: expiresAt,
             generatedAt: generatedAt, items: items)
  }

  static func decode(_ data: Data, language: String, concept: String, now: Date) throws -> PublicShelfFeed {
    let feed = try decodeStructure(data)
    try feed.validate(language: language, concept: concept, now: now, requireFresh: true)
    return feed
  }

  func isFresh(at now: Date) -> Bool {
    (try? validate(language: language, concept: concept, now: now, requireFresh: true)) != nil
  }

  fileprivate static func decodeStructure(_ data: Data) throws -> PublicShelfFeed {
    guard data.count <= FeedRules.maximumBytes else { throw TopShelfFeedError.bodyTooLarge }
    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          Set(object.keys) == Set(["schemaVersion", "revision", "generatedAt", "expiresAt", "language", "concept", "items"]),
          let items = object["items"] as? [[String: Any]] else { throw TopShelfFeedError.unknownField }
    let itemKeys: Set<String> = ["id", "slug", "title", "summary", "imageURL", "duration", "kind", "previewURL"]
    for item in items where !Set(item.keys).isSubset(of: itemKeys) { throw TopShelfFeedError.unknownField }
    guard let feed = try? JSONDecoder().decode(PublicShelfFeed.self, from: data) else { throw TopShelfFeedError.invalidPayload }
    return feed
  }

  fileprivate func validate(language expectedLanguage: String, concept expectedConcept: String,
                            now: Date, requireFresh: Bool) throws {
    guard schemaVersion == 1 else { throw TopShelfFeedError.invalidSchema }
    guard revision >= 0, revision <= FeedRules.maximumRevision else { throw TopShelfFeedError.invalidRevision }
    guard FeedRules.concepts.contains(concept) else { throw TopShelfFeedError.unsupportedConcept }
    guard language == expectedLanguage, concept == expectedConcept,
          FeedRules.identifier(language) else { throw TopShelfFeedError.contextMismatch }
    guard let generated = FeedRules.date(generatedAt), let expiry = FeedRules.date(expiresAt),
          generated <= now.addingTimeInterval(60), expiry > generated,
          expiry.timeIntervalSince(generated) <= 86_400,
          !requireFresh || expiry > now else { throw TopShelfFeedError.invalidDates }
    guard items.count <= 10 else { throw TopShelfFeedError.invalidItem }
    var identifiers = Set<String>()
    for item in items {
      guard identifiers.insert(item.id).inserted, FeedRules.identifier(item.id), FeedRules.identifier(item.slug),
            !item.title.isEmpty, item.title.utf16.count <= 200, item.summary.utf16.count <= 500,
            FeedRules.artwork(item.imageURL), item.previewURL.map(FeedRules.artwork) ?? true,
            item.duration.isFinite, item.duration >= 0,
            ["video", "section"].contains(item.kind), item.progress == nil else { throw TopShelfFeedError.invalidItem }
      guard concept == "journey" ? (item.kind == "section" && item.duration == 0) : item.kind == "video",
            concept != "short" || (item.duration > 0 && item.duration <= 900) else { throw TopShelfFeedError.invalidItem }
    }
  }

  fileprivate func sameContent(as other: PublicShelfFeed) -> Bool {
    schemaVersion == other.schemaVersion && language == other.language && concept == other.concept && items == other.items
  }
}

struct TopShelfFeedConfiguration {
  let endpoint: URL
  let allowLocalFeed: Bool

  init?(bundle: Bundle = .main) {
    guard let value = bundle.object(forInfoDictionaryKey: "ForgeTopShelfFeedURL") as? String else { return nil }
    let allowLocal = bundle.object(forInfoDictionaryKey: "ForgeTopShelfAllowLocalFeed") as? Bool == true
    guard let url = Self.endpointURL(value, allowLocal: allowLocal) else { return nil }
    endpoint = url; allowLocalFeed = allowLocal
  }

  func requestURL(language: String, concept: String) -> URL? {
    guard FeedRules.identifier(language), FeedRules.concepts.contains(concept),
          var parts = URLComponents(url: endpoint, resolvingAgainstBaseURL: false) else { return nil }
    parts.queryItems = [URLQueryItem(name: "language", value: language), URLQueryItem(name: "concept", value: concept)]
    guard let url = parts.url, url.absoluteString.utf16.count <= 2048 else { return nil }
    return url
  }

  fileprivate static func endpointURL(_ value: String, allowLocal: Bool) -> URL? {
    guard value.utf16.count <= 2048, let parts = URLComponents(string: value),
          parts.query == nil, parts.fragment == nil, let url = parts.url,
          safeURL(url, allowLocal: allowLocal, permitQuery: false) else { return nil }
    return url
  }

  fileprivate static func safeURL(_ url: URL, allowLocal: Bool, permitQuery: Bool) -> Bool {
    guard url.absoluteString.utf16.count <= 2048,
          let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
          let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil,
          parts.fragment == nil, parts.port.map({ (1...65_535).contains($0) }) ?? true else { return false }
    if !permitQuery && parts.query != nil { return false }
    if let query = parts.queryItems {
      guard Set(query.map(\.name)).count == query.count,
            query.allSatisfy({ item in
              guard let value = item.value else { return false }
              return item.name == "language" ? FeedRules.identifier(value) : item.name == "concept" && FeedRules.concepts.contains(value)
            }) else { return false }
    }
    if parts.scheme?.lowercased() == "https" { return true }
    #if DEBUG && targetEnvironment(simulator)
    return allowLocal && parts.scheme?.lowercased() == "http" && ["127.0.0.1", "localhost", "::1", "[::1]"].contains(host.lowercased())
    #else
    return false
    #endif
  }
}

final class TopShelfFeedRequest: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private let url: URL
  private let configuration: URLSessionConfiguration
  private let completion: (Result<Data, Error>) -> Void
  private let state = DispatchQueue(label: "org.jesusfilm.watch.top-shelf.feed-request")
  private var session: URLSession?
  private var task: URLSessionDataTask?
  private var deadline: DispatchSourceTimer?
  private var buffer = Data()
  private var started = false
  private var finished = false

  init(url: URL, configuration: URLSessionConfiguration? = nil,
       completion: @escaping (Result<Data, Error>) -> Void) {
    self.url = url
    self.configuration = (configuration?.copy() as? URLSessionConfiguration) ?? .ephemeral
    self.completion = completion
    super.init()
  }

  func start() {
    state.async { [self] in
      guard !self.started, !self.finished else { return }
      self.started = true
      let allowLocal = Bundle.main.object(forInfoDictionaryKey: "ForgeTopShelfAllowLocalFeed") as? Bool == true
      guard TopShelfFeedConfiguration.safeURL(self.url, allowLocal: allowLocal, permitQuery: true) else {
        self.finish(.failure(TopShelfFeedError.invalidConfiguration)); return
      }
      self.configuration.httpCookieStorage = nil
      self.configuration.httpShouldSetCookies = false
      self.configuration.httpCookieAcceptPolicy = .never
      self.configuration.urlCredentialStorage = nil
      self.configuration.urlCache = nil
      self.configuration.httpAdditionalHeaders = [:]
      self.configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
      self.configuration.waitsForConnectivity = false
      self.configuration.timeoutIntervalForRequest = 3
      self.configuration.timeoutIntervalForResource = 3
      let delegateQueue = OperationQueue()
      delegateQueue.maxConcurrentOperationCount = 1
      self.session = URLSession(configuration: self.configuration, delegate: self, delegateQueue: delegateQueue)
      var request = URLRequest(url: self.url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 3)
      request.httpMethod = "GET"
      request.setValue("application/json", forHTTPHeaderField: "Accept")
      request.setValue("native-extension", forHTTPHeaderField: "X-Top-Shelf-Client")
      self.task = self.session?.dataTask(with: request)
      let timer = DispatchSource.makeTimerSource(queue: self.state)
      timer.schedule(deadline: .now() + 3)
      timer.setEventHandler { [weak self] in self?.finish(.failure(TopShelfFeedError.timedOut)) }
      self.deadline = timer
      timer.resume()
      self.task?.resume()
    }
  }

  func cancel() { state.async { self.finish(.failure(TopShelfFeedError.cancelled)) } }

  private func finish(_ result: Result<Data, Error>) {
    guard !finished else { return }
    finished = true
    deadline?.cancel(); deadline = nil
    task?.cancel(); task = nil
    session?.invalidateAndCancel(); session = nil
    buffer.removeAll(keepingCapacity: false)
    let callback = completion
    DispatchQueue.global(qos: .userInitiated).async { callback(result) }
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                  completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    state.async {
      guard !self.finished else { completionHandler(.cancel); return }
      guard let http = response as? HTTPURLResponse else {
        completionHandler(.cancel); self.finish(.failure(TopShelfFeedError.unexpectedResponse)); return
      }
      guard http.statusCode == 200 else {
        completionHandler(.cancel); self.finish(.failure(TopShelfFeedError.unexpectedStatus(http.statusCode))); return
      }
      guard response.mimeType?.lowercased() == "application/json" else {
        completionHandler(.cancel); self.finish(.failure(TopShelfFeedError.unexpectedResponse)); return
      }
      guard response.expectedContentLength <= Int64(FeedRules.maximumBytes) else {
        completionHandler(.cancel); self.finish(.failure(TopShelfFeedError.bodyTooLarge)); return
      }
      completionHandler(.allow)
    }
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    // Backpressure on the serial delegate queue prevents queued chunks retaining an unbounded body.
    state.sync {
      guard !self.finished else { return }
      guard data.count <= FeedRules.maximumBytes - self.buffer.count else {
        self.finish(.failure(TopShelfFeedError.bodyTooLarge)); return
      }
      self.buffer.append(data)
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    state.async {
      guard !self.finished else { return }
      if let error { self.finish(.failure(error)) }
      else { self.finish(.success(self.buffer)) }
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
    state.async { self.finish(.failure(TopShelfFeedError.redirectRejected)) }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                  completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust {
      completionHandler(.performDefaultHandling, nil)
    } else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      state.async { self.finish(.failure(TopShelfFeedError.authenticationRejected)) }
    }
  }
}

final class PublicShelfFeedStore {
  enum State {
    case absent, invalid, otherContext, value(PublicShelfFeed)
  }

  private struct Record: Codable {
    let version: Int
    let endpoint: String
    let language: String
    let concept: String
    let feed: PublicShelfFeed
  }

  static let filename = "top-shelf-public-v1.json"
  private let directory: URL
  private let now: () -> Date
  private let maximumRecordBytes = 73_728

  init(directory: URL, now: @escaping () -> Date = { Date() }) {
    self.directory = directory; self.now = now
  }

  // Hash a length-unambiguous tuple; no endpoint, language or raw payload is
  // exposed in a path. Each context retains its own tombstone and high-water.
  func cacheURL(endpoint: URL, language: String, concept: String) -> URL {
    contextDirectory(endpoint: endpoint, language: language, concept: concept)
      .appendingPathComponent(Self.filename)
  }

  private func contextDirectory(endpoint: URL, language: String, concept: String) -> URL {
    let values = [endpoint.absoluteString, language, concept]
    let material = values.map { "\($0.utf8.count):\($0)" }.joined()
    let digest = SHA256.hash(data: Data(material.utf8))
      .map { String(format: "%02x", $0) }.joined()
    return directory.appendingPathComponent("context-" + digest, isDirectory: true)
  }

  private func validContext(endpoint: URL, language: String, concept: String) -> Bool {
    let allowLocal = Bundle.main.object(forInfoDictionaryKey: "ForgeTopShelfAllowLocalFeed") as? Bool == true
    return FeedRules.identifier(language) && FeedRules.concepts.contains(concept) &&
      TopShelfFeedConfiguration.safeURL(endpoint, allowLocal: allowLocal, permitQuery: false)
  }

  func cached(endpoint: URL, language: String, concept: String) -> State {
    guard validContext(endpoint: endpoint, language: language, concept: concept) else { return .invalid }
    let context = contextDirectory(endpoint: endpoint, language: language, concept: concept)
    do {
      return try locked(directory: context) {
        guard let record = try readRecord(directory: context) else { return .absent }
        guard record.endpoint == endpoint.absoluteString, record.language == language, record.concept == concept else { return .otherContext }
        return .value(record.feed)
      }
    } catch { return .invalid }
  }

  @discardableResult
  func accept(_ feed: PublicShelfFeed, endpoint: URL, language: String, concept: String) throws -> PublicShelfFeed {
    try feed.validate(language: language, concept: concept, now: now(), requireFresh: true)
    let feedEncoder = JSONEncoder()
    feedEncoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    guard try feedEncoder.encode(feed).count <= FeedRules.maximumBytes else { throw TopShelfFeedError.bodyTooLarge }
    guard validContext(endpoint: endpoint, language: language, concept: concept) else {
      throw TopShelfFeedError.invalidConfiguration
    }
    let context = contextDirectory(endpoint: endpoint, language: language, concept: concept)
    return try locked(directory: context) {
      try feed.validate(language: language, concept: concept, now: now(), requireFresh: true)
      if let previous = try? readRecord(directory: context), previous.endpoint == endpoint.absoluteString,
         previous.language == language, previous.concept == concept {
        guard feed.revision >= previous.feed.revision else { throw TopShelfFeedError.rollback }
        if feed.revision == previous.feed.revision {
          guard feed.sameContent(as: previous.feed) else { throw TopShelfFeedError.conflictingRevision }
          if FeedRules.date(feed.generatedAt)! <= FeedRules.date(previous.feed.generatedAt)! { return previous.feed }
        }
      }
      let record = Record(version: 1, endpoint: endpoint.absoluteString, language: language, concept: concept, feed: feed)
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
      let data = try encoder.encode(record)
      guard data.count <= maximumRecordBytes else { throw TopShelfFeedError.bodyTooLarge }
      let url = context.appendingPathComponent(Self.filename)
      try data.write(to: url, options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
      return feed
    }
  }

  private func readRecord(directory context: URL) throws -> Record? {
    let url = context.appendingPathComponent(Self.filename)
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var data = Data()
    while let chunk = try handle.read(upToCount: min(8192, maximumRecordBytes + 1 - data.count)), !chunk.isEmpty {
      data.append(chunk)
      guard data.count <= maximumRecordBytes else { throw TopShelfFeedError.bodyTooLarge }
    }
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          Set(object.keys) == Set(["version", "endpoint", "language", "concept", "feed"]),
          let feedObject = object["feed"] as? [String: Any] else { throw TopShelfFeedError.invalidPayload }
    let feedData = try JSONSerialization.data(withJSONObject: feedObject, options: [.sortedKeys, .withoutEscapingSlashes])
    _ = try PublicShelfFeed.decodeStructure(feedData)
    let record = try JSONDecoder().decode(Record.self, from: data)
    guard record.version == 1, record.endpoint.utf16.count <= 2048,
          record.language == record.feed.language, record.concept == record.feed.concept else { throw TopShelfFeedError.invalidPayload }
    try record.feed.validate(language: record.language, concept: record.concept, now: now(), requireFresh: false)
    return record
  }

  private func locked<T>(directory context: URL, _ work: () throws -> T) throws -> T {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                          attributes: [.posixPermissions: 0o700])
    try FileManager.default.createDirectory(at: context, withIntermediateDirectories: true,
                                          attributes: [.posixPermissions: 0o700])
    let path = context.appendingPathComponent(".top-shelf-public-v1.lock").path
    let descriptor = open(path, O_CREAT | O_RDWR, mode_t(0o600))
    guard descriptor >= 0 else { throw TopShelfFeedError.storageFailure }
    defer { close(descriptor) }
    let deadline = DispatchTime.now().uptimeNanoseconds + 1_000_000_000
    while flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
      guard errno == EWOULDBLOCK || errno == EAGAIN,
            DispatchTime.now().uptimeNanoseconds < deadline else { throw TopShelfFeedError.storageFailure }
      usleep(1000)
    }
    defer { flock(descriptor, LOCK_UN) }
    return try work()
  }
}
