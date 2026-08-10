import XCTest
@testable import JesusFilmTV

// MARK: - HomeProjection

final class HomeProjectionTests: XCTestCase {
    /// Mirrors the live watch-home response shape: non-MediaCollection blocks
    /// carry only `__typename` (the inline fragment matches nothing else), and
    /// unset fields inside a matched block arrive as explicit JSON nulls.
    /// Values are placeholders; the null-title item and the empty rail are
    /// synthetic nullability probes permitted by the wire contract
    /// (`WireCollectionItem` / `WireBlock` all-optional), not observed live.
    private let watchHomeJSON = """
    {
      "experienceBySlug": {
        "id": "exp-watch-home",
        "slug": "watch-home",
        "title": "Watch Home",
        "blocks": [
          { "__typename": "WatchHomeHeroBlock" },
          {
            "__typename": "MediaCollectionBlock",
            "sectionKey": "featured",
            "mcTitle": "Featured",
            "mcSubtitle": null,
            "items": [
              {
                "titleOverride": "JESUS",
                "subtitleOverride": null,
                "imageAsset": { "previewUrl": "https://images.jesusfilm.org/asset-jesus.jpg" },
                "videoImage": { "previewUrl": "https://images.jesusfilm.org/video-jesus.jpg" },
                "videoDub": { "muxVideo": { "playbackId": "pbJesus01abcDEF" } },
                "videoId": "1_jf-0-0"
              },
              {
                "titleOverride": "Magdalena",
                "subtitleOverride": null,
                "imageAsset": null,
                "videoImage": { "previewUrl": "https://images.jesusfilm.org/video-magdalena.jpg" },
                "videoDub": { "muxVideo": { "playbackId": "pbMagdalena02ghiJKL" } },
                "videoId": null
              },
              {
                "titleOverride": null,
                "subtitleOverride": null,
                "imageAsset": null,
                "videoImage": { "previewUrl": "https://images.jesusfilm.org/video-untitled.jpg" },
                "videoDub": { "muxVideo": { "playbackId": "pbUntitled03mnoPQR" } },
                "videoId": "1_jf-0-1"
              }
            ]
          },
          { "__typename": "SectionBlock" },
          {
            "__typename": "MediaCollectionBlock",
            "sectionKey": "coming-soon",
            "mcTitle": "Coming Soon",
            "mcSubtitle": null,
            "items": []
          }
        ]
      }
    }
    """

    func testProjectsOnlyRenderableMediaCollectionRails() throws {
        let model = HomeProjection.project(try decodeFixture(WatchHomeData.self, watchHomeJSON))

        // Hero and Section blocks skipped, empty rail dropped: one rail left.
        XCTAssertEqual(model.rails.count, 1)
        let rail = try XCTUnwrap(model.rails.first)
        XCTAssertEqual(rail.id, "featured")
        XCTAssertEqual(rail.title, "Featured")

        // The titleless item is dropped; the two renderable cards survive.
        XCTAssertEqual(rail.items.map(\.title), ["JESUS", "Magdalena"])
    }

    func testCardIdentityPrefersVideoIdThenFallsBackToPlaybackId() throws {
        let model = HomeProjection.project(try decodeFixture(WatchHomeData.self, watchHomeJSON))
        let rail = try XCTUnwrap(model.rails.first)

        XCTAssertEqual(rail.items[0].id, "1_jf-0-0")
        XCTAssertEqual(rail.items[0].playbackID, "pbJesus01abcDEF")

        // No videoId → the playback id doubles as identity.
        XCTAssertEqual(rail.items[1].id, "pbMagdalena02ghiJKL")
        XCTAssertEqual(rail.items[1].playbackID, "pbMagdalena02ghiJKL")
    }

    func testPosterPrefersImageAssetOverVideoImage() throws {
        let model = HomeProjection.project(try decodeFixture(WatchHomeData.self, watchHomeJSON))
        let rail = try XCTUnwrap(model.rails.first)

        // Item 0 carries both images — the editor's asset must win.
        XCTAssertEqual(
            rail.items[0].posterURL,
            URL(string: "https://images.jesusfilm.org/asset-jesus.jpg")
        )
        // Item 1 has no asset — the video's own image is the fallback.
        XCTAssertEqual(
            rail.items[1].posterURL,
            URL(string: "https://images.jesusfilm.org/video-magdalena.jpg")
        )
    }
}

// MARK: - SearchProjection

final class SearchProjectionTests: XCTestCase {
    /// Full row mirrors a live watchSearch video hit; the null-id and
    /// null-title rows are synthetic nullability probes permitted by
    /// `WireSearchResult`'s all-optional contract, not observed live.
    private let watchSearchJSON = """
    {
      "watchSearch": {
        "query": "jesus",
        "hasMore": true,
        "nextOffset": 20,
        "results": [
          {
            "type": "video",
            "id": "1_jf-0-0",
            "slug": "jesus",
            "title": "JESUS",
            "imageUrl": "https://images.jesusfilm.org/jesus-search.jpg",
            "snippet": "The life of Jesus through the Gospel of Luke.",
            "playbackId": "pbJesus01abcDEF",
            "label": "Feature Film",
            "childCount": null
          },
          {
            "type": "video",
            "id": null,
            "slug": "no-id",
            "title": "Row Without Id",
            "imageUrl": null,
            "snippet": null,
            "playbackId": "pbNoId04stuVWX",
            "label": null,
            "childCount": null
          },
          {
            "type": "video",
            "id": "1_jf-0-2",
            "slug": "no-title",
            "title": null,
            "imageUrl": null,
            "snippet": null,
            "playbackId": null,
            "label": null,
            "childCount": null
          }
        ]
      }
    }
    """

    func testDropsRowsMissingIdOrTitleAndKeepsFullRows() throws {
        let rows = SearchProjection.project(try decodeFixture(WatchSearchData.self, watchSearchJSON))

        XCTAssertEqual(rows.count, 1)
        let row = try XCTUnwrap(rows.first)
        XCTAssertEqual(row.id, "1_jf-0-0")
        XCTAssertEqual(row.title, "JESUS")
        XCTAssertEqual(row.imageURL, URL(string: "https://images.jesusfilm.org/jesus-search.jpg"))
        XCTAssertEqual(row.playbackID, "pbJesus01abcDEF")
        XCTAssertEqual(row.label, "Feature Film")
    }
}

// MARK: - GraphQLClient

/// Intercepts the client's URLSession so envelope decoding is exercised
/// through the real `fetch` path — the envelope type is private, and testing
/// through the transport also proves the request the server would see.
final class StubURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?
    static var lastRequest: URLRequest?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        StubURLProtocol.lastRequest = request
        guard let handler = StubURLProtocol.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

final class GraphQLClientTests: XCTestCase {
    private let endpoint = URL(string: "https://unit.test/graphql")!

    override func tearDown() {
        StubURLProtocol.handler = nil
        StubURLProtocol.lastRequest = nil
        super.tearDown()
    }

    private func makeClient() -> GraphQLClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return GraphQLClient(endpoint: endpoint, session: URLSession(configuration: configuration))
    }

    private func stub(status: Int = 200, body: String) {
        let endpoint = endpoint
        StubURLProtocol.handler = { _ in
            let response = HTTPURLResponse(
                url: endpoint,
                statusCode: status,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(body.utf8))
        }
    }

    func testDecodesDataEnvelopeAndSendsJSONContentType() async throws {
        stub(body: """
        {
          "data": {
            "watchSearch": {
              "query": "jesus",
              "hasMore": false,
              "nextOffset": null,
              "results": []
            }
          }
        }
        """)

        let payload = try await makeClient().fetch(
            WatchSearchData.self,
            query: Queries.watchSearch,
            variables: ["input": ["query": "jesus"]]
        )

        XCTAssertEqual(payload.watchSearch?.query, "jesus")
        XCTAssertEqual(payload.watchSearch?.hasMore, false)
        XCTAssertEqual(
            StubURLProtocol.lastRequest?.value(forHTTPHeaderField: "Content-Type"),
            "application/json"
        )
    }

    func testErrorsEnvelopeThrowsGraphQLServerError() async {
        stub(body: """
        { "errors": [ { "message": "boom" }, { "message": "again" } ] }
        """)

        do {
            _ = try await makeClient().fetch(WatchSearchData.self, query: Queries.watchSearch, variables: [:])
            XCTFail("expected GraphQLServerError")
        } catch let error as GraphQLClient.GraphQLServerError {
            XCTAssertEqual(error.messages, ["boom", "again"])
        } catch {
            XCTFail("expected GraphQLServerError, got \(error)")
        }
    }

    func testNullDataWithoutErrorsThrowsEmptyResponse() async {
        stub(body: """
        { "data": null }
        """)

        do {
            _ = try await makeClient().fetch(WatchSearchData.self, query: Queries.watchSearch, variables: [:])
            XCTFail("expected GraphQLServerError")
        } catch let error as GraphQLClient.GraphQLServerError {
            XCTAssertEqual(error.messages, ["empty response"])
        } catch {
            XCTFail("expected GraphQLServerError, got \(error)")
        }
    }

    func testNon2xxStatusThrowsHTTPErrorBeforeDecoding() async {
        // Body is deliberately valid JSON with data — the status check must
        // win, or a CDN error page with a cached body could masquerade as
        // content.
        stub(status: 502, body: """
        { "data": { "watchSearch": null } }
        """)

        do {
            _ = try await makeClient().fetch(WatchSearchData.self, query: Queries.watchSearch, variables: [:])
            XCTFail("expected GraphQLHTTPError")
        } catch let error as GraphQLClient.GraphQLHTTPError {
            XCTAssertEqual(error.statusCode, 502)
        } catch {
            XCTFail("expected GraphQLHTTPError, got \(error)")
        }
    }
}

// PKCE (RFC 7636 appendix B vector) deliberately absent: DeviceGrantClient
// does not exist in this worktree yet, and referencing its symbols would not
// compile. Add the vector test when that file lands — verifier
// "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" must hash to challenge
// "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM".

private func decodeFixture<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONDecoder().decode(T.self, from: Data(json.utf8))
}
