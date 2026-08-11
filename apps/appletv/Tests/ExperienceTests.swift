import XCTest
@testable import JesusFilmTV

// MARK: - Fixture

/// Shaped after the live `easter` and `christmas` Experiences (verified
/// against production admin on 2026-08-12), trimmed to the fields this app
/// selects and extended with three cases production does not currently
/// author: an `AdventCountdownBlock`, a typename this app has never heard of,
/// and a quiz whose `iframeSrc` is off the allowlist.
///
/// Every one of the 13 renderable kinds appears exactly once, several of them
/// nested, so a projection that quietly stops handling one fails here.
private let experienceJSON = """
{
  "experienceBySlug": {
    "id": "exp-easter",
    "slug": "easter",
    "title": "Easter",
    "blocks": [
      {
        "__typename": "VideoHeroBlock",
        "sectionKey": null,
        "heading": "Easter",
        "subheading": "Easter 2026 - videos & resources",
        "ctaLabel": "Watch now",
        "videoDub": { "muxVideo": { "playbackId": "heroPlayback01" } }
      },
      { "__typename": "AdventCountdownBlock" },
      { "__typename": "WatchHomeHeroBlock" },
      {
        "__typename": "ContainerBlock",
        "sectionKey": null,
        "content": [
          { "__typename": "ContainerSlotBlock", "gridSpan": 6, "spans": null },
          {
            "__typename": "TextBlock",
            "sectionKey": null,
            "textHeading": "The Real Easter story",
            "subtitle": "Questioning? Searching?",
            "contentParagraphs": ["Beyond eggs and bunnies.", "   ", "The Gospels are honest."]
          },
          { "__typename": "ContainerSlotBlock", "gridSpan": 6, "spans": null },
          {
            "__typename": "EasterDatesBlock",
            "sectionKey": null,
            "easterDatesTitle": "When is Easter celebrated in {year}?",
            "westernEasterLabel": "Western Easter (Catholic/Protestant)",
            "orthodoxEasterLabel": "Orthodox",
            "passoverLabel": "Jewish Passover",
            "locale": "en-US"
          }
        ]
      },
      {
        "__typename": "NavigationCarouselBlock",
        "sectionKey": "easter-navigation",
        "ncItems": [
          {
            "contentId": "easter-explained/english",
            "title": "The True Meaning of Easter",
            "category": "Short Video",
            "backgroundColor": "#1A1815",
            "imageAsset": null
          },
          {
            "contentId": null,
            "title": "Unlinked card",
            "category": null,
            "backgroundColor": null,
            "imageAsset": null
          }
        ]
      },
      {
        "__typename": "MediaCollectionBlock",
        "sectionKey": "video-bible-collection",
        "mcTitle": "The Easter story is part of a bigger picture",
        "mcSubtitle": null,
        "categoryLabel": "Video Bible Collection",
        "thumbnailOrientation": "vertical",
        "mcItems": [
          {
            "titleOverride": "   ",
            "labelOverride": "Feature Film",
            "collectionSize": "61 chapters",
            "linkToSectionKey": null,
            "videoSlug": "jesus",
            "videoId": "cmp76xcw602imny01vnsbwwy9",
            "resolvedTitle": "JESUS",
            "imageAsset": null,
            "videoImage": { "previewUrl": "https://imagedelivery.net/jesus.jpg" },
            "videoDub": { "muxVideo": { "playbackId": "mediaPlayback01" } }
          },
          {
            "titleOverride": "Jump instead",
            "labelOverride": null,
            "collectionSize": null,
            "linkToSectionKey": "easter-navigation",
            "videoSlug": "life-of-jesus-gospel-of-john",
            "videoId": null,
            "resolvedTitle": "Life of Jesus",
            "imageAsset": { "previewUrl": "https://images.jesusfilm.org/john.jpg" },
            "videoImage": null,
            "videoDub": null
          },
          {
            "titleOverride": null,
            "labelOverride": null,
            "collectionSize": null,
            "linkToSectionKey": null,
            "videoSlug": null,
            "videoId": null,
            "resolvedTitle": null,
            "imageAsset": null,
            "videoImage": null,
            "videoDub": null
          }
        ]
      },
      {
        "__typename": "VideoCarouselBlock",
        "sectionKey": "easter-documentary-carousel",
        "vcTitle": "Did Jesus Defeat Death?",
        "vcSubtitle": "Easter Documentary Series",
        "vcItems": [
          {
            "titleOverride": "How Did Jesus Die?",
            "backgroundColor": "#161817",
            "videoId": "cmp78qz2z0erwqm01dgeoskdh",
            "imageAsset": null,
            "videoDub": { "muxVideo": { "playbackId": "carouselPlayback01" } }
          },
          {
            "titleOverride": "Why is Easter celebrated with bunnies?",
            "backgroundColor": "#2B2018",
            "videoId": null,
            "imageAsset": null,
            "videoDub": null
          }
        ]
      },
      {
        "__typename": "TextBlock",
        "sectionKey": null,
        "textHeading": "More than a tradition",
        "subtitle": null,
        "contentParagraphs": ["Christmas is a time of lights."]
      },
      {
        "__typename": "BibleQuotesCarouselBlock",
        "sectionKey": "easter-bible-quotes",
        "bqcHeading": "Bible quotes",
        "quotes": [
          {
            "reference": "1 Corinthians 15:55-57",
            "text": "Where, O death, is your victory?",
            "attribution": "Apostle Paul",
            "backgroundColor": "#201617",
            "ctaLabel": null,
            "ctaLink": null,
            "imageAsset": null,
            "backgroundImageAsset": { "previewUrl": "https://images.jesusfilm.org/quote-bg.jpg" }
          },
          {
            "reference": "Free Resources",
            "text": "Want to grow deep in your understanding?",
            "attribution": null,
            "backgroundColor": null,
            "ctaLabel": "Join a Bible study",
            "ctaLink": "https://join.bsfinternational.org/?utm_source=jesusfilm-watch",
            "imageAsset": { "previewUrl": "https://images.jesusfilm.org/promo.jpg" },
            "backgroundImageAsset": null
          },
          {
            "reference": "Rejected link",
            "text": "A label with nowhere to go.",
            "attribution": null,
            "backgroundColor": null,
            "ctaLabel": "Open",
            "ctaLink": "http://insecure.example.com/path",
            "imageAsset": null,
            "backgroundImageAsset": null
          }
        ]
      },
      {
        "__typename": "CtaBlock",
        "sectionKey": null,
        "ctaHeading": "Reflect on His love",
        "body": "Take a moment today.",
        "buttonLabel": "Watch the Story",
        "buttonLink": null
      },
      {
        "__typename": "RelatedQuestionsBlock",
        "sectionKey": null,
        "rqHeading": "Related questions",
        "questions": [
          { "question": "Why did Jesus have to die?", "answer": "Because sin separates us." },
          { "question": "What happened on Easter Sunday?", "answer": null },
          { "question": "  ", "answer": "orphaned answer" }
        ]
      },
      {
        "__typename": "SectionBlock",
        "sectionKey": "easter-meaning",
        "backgroundImageAsset": { "previewUrl": "https://images.jesusfilm.org/section-bg.jpg" },
        "sectionContent": [
          {
            "__typename": "VideoBlock",
            "sectionKey": "easter-explained/english",
            "videoTitle": "Easter Explained",
            "videoSubtitle": "Is Easter about more than bunnies and eggs?",
            "videoId": "cmp786dzm04pcqm01d0ygjzag",
            "videoDub": { "muxVideo": { "playbackId": "sectionPlayback01" } }
          },
          {
            "__typename": "QuizButtonBlock",
            "sectionKey": null,
            "buttonText": "What's your next step of faith?",
            "iframeSrc": "https://your.nextstep.is/embed/easter2025?expand=false"
          },
          {
            "__typename": "QuizButtonBlock",
            "sectionKey": null,
            "buttonText": "Off-allowlist quiz",
            "iframeSrc": "https://nextstep.is.evil.example/embed/x"
          }
        ]
      }
    ]
  }
}
"""

private func decodeExperience(_ json: String) throws -> ExperienceData {
    try JSONDecoder().decode(ExperienceData.self, from: Data(json.utf8))
}

/// Test-local kind names. Deliberately NOT a property on `ExperienceBlock`:
/// a shipped `kind` accessor would be a second source of truth that these
/// assertions could agree with while the dispatcher disagreed.
private func kindName(_ block: ExperienceBlock) -> String {
    switch block {
    case .videoHero: return "videoHero"
    case .section: return "section"
    case .container: return "container"
    case .mediaCollection: return "mediaCollection"
    case .videoCarousel: return "videoCarousel"
    case .navigationCarousel: return "navigationCarousel"
    case .text: return "text"
    case .easterDates: return "easterDates"
    case .bibleQuotesCarousel: return "bibleQuotesCarousel"
    case .cta: return "cta"
    case .relatedQuestions: return "relatedQuestions"
    case .video: return "video"
    case .quizButton: return "quizButton"
    case .unsupported(_, let typename): return "unsupported(\(typename))"
    }
}

// MARK: - Projection

final class ExperienceProjectionTests: XCTestCase {
    private var blocks: [ExperienceBlock] = []

    override func setUpWithError() throws {
        blocks = ExperienceProjection.project(try decodeExperience(experienceJSON))
    }

    /// The whole pipeline in one assertion: every renderable kind survives,
    /// order is preserved, the recognised-but-undrawn block keeps its place,
    /// and the typename this app does not know is simply gone.
    func testProjectsEveryTopLevelKindInOrder() {
        XCTAssertEqual(blocks.map(kindName), [
            "videoHero",
            "unsupported(AdventCountdownBlock)",
            "container",
            "navigationCarousel",
            "mediaCollection",
            "videoCarousel",
            "text",
            "bibleQuotesCarousel",
            "cta",
            "relatedQuestions",
            "section",
        ])
    }

    /// The remaining three kinds are only reachable through nesting, which is
    /// where a naive port drops them.
    func testProjectsTheNestedKinds() throws {
        let container = try XCTUnwrap(container(blocks[2]))
        XCTAssertEqual(container.slots.flatMap { $0.content.map(kindName) }, ["text", "easterDates"])

        let section = try XCTUnwrap(section(blocks[10]))
        XCTAssertEqual(section.content.map(kindName), ["video", "quizButton", "quizButton"])
    }

    /// `WatchHomeHeroBlock` is real in admin's union and deliberately absent
    /// from this app's map — an unknown typename must leave no trace at all,
    /// not a placeholder the renderer has to skip.
    func testUnknownTypenameVanishesEntirely() {
        XCTAssertFalse(blocks.contains { kindName($0).contains("WatchHomeHero") })
    }

    /// PARITY REQUIREMENT. `AdventCountdownBlock` has a fragment and a model
    /// in the React Native app but no dispatcher case, so it draws nothing
    /// there and must draw nothing here.
    ///
    /// What this proves: the block reaches the tree as `.unsupported`, which
    /// is the ONLY case `BlockView` answers with `EmptyView()`, and it carries
    /// no `sectionKey`, so it cannot even become a scroll anchor another block
    /// jumps to. What it does NOT prove is the pixel outcome — this target has
    /// no view-rendering harness, so the "renders nothing" half rests on that
    /// single dispatcher arm staying the only payload-free one.
    func testAdventCountdownIsRecognisedAndDrawsNothing() throws {
        guard case .unsupported(let id, let typename) = blocks[1] else {
            return XCTFail("AdventCountdownBlock must project to .unsupported")
        }
        XCTAssertEqual(typename, "AdventCountdownBlock")
        XCTAssertFalse(id.isEmpty, "every block needs a stable ForEach identity")
        XCTAssertNil(blocks[1].sectionKey, "an undrawn block must not be a jump target")
    }

    // MARK: Cards

    func testMediaCardTitleFallsThroughABlankOverrideToResolvedTitle() throws {
        let cards = try XCTUnwrap(mediaCollection(blocks[4])).cards
        // Admin clears an authored override to "" (here whitespace), so
        // treating a blank as present would put an empty label on the card.
        XCTAssertEqual(cards.map(\.title), ["JESUS", "Jump instead", "Untitled"])
    }

    /// `thumbnailOrientation` is nullable in admin's schema and IS null on the
    /// live `christmas` MediaCollection, so the default is a production path,
    /// not a defensive branch. It picks the card geometry the dispatcher hands
    /// `BlockRail` (260×347 portrait vs 420×236 landscape), so flipping it
    /// reshapes every card on that page with nothing else to notice.
    func testMediaCollectionOrientationDefaultsToPortrait() throws {
        func orientation(_ raw: String) throws -> MediaCardOrientation {
            let json = """
            {"experienceBySlug":{"id":"e","slug":"s","title":null,"blocks":[
              {"__typename":"MediaCollectionBlock","thumbnailOrientation":\(raw),"mcItems":[]}
            ]}}
            """
            let first = try XCTUnwrap(ExperienceProjection.project(try decodeExperience(json)).first)
            guard case .mediaCollection(let model) = first else { throw NotAMediaCollection() }
            return model.orientation
        }

        XCTAssertEqual(try orientation("null"), .vertical, "the live `christmas` shape")
        XCTAssertEqual(try orientation("\"cinematic\""), .vertical, "an unknown enum member too")
        XCTAssertEqual(try orientation("\"vertical\""), .vertical)
        XCTAssertEqual(try orientation("\"horizontal\""), .horizontal)
    }

    private struct NotAMediaCollection: Error {}

    func testMediaCardEyebrowFallsBackToTheBlockCategoryLabel() throws {
        let cards = try XCTUnwrap(mediaCollection(blocks[4])).cards
        XCTAssertEqual(cards[0].eyebrow, "Feature Film", "the item override wins")
        XCTAssertEqual(cards[1].eyebrow, "Video Bible Collection", "then the block's label")
    }

    /// Routing precedence is the one behaviour a viewer notices immediately:
    /// an in-page jump beats the Watch route, and a card with neither stays
    /// focusable-but-inert rather than being skipped.
    func testMediaCardRoutePrefersInPageJumpThenWatchSlugThenInert() throws {
        let cards = try XCTUnwrap(mediaCollection(blocks[4])).cards
        XCTAssertEqual(cards[0].route, .video(slug: "jesus"))
        XCTAssertEqual(cards[1].route, .section(key: "easter-navigation"))
        XCTAssertNil(cards[2].route)
    }

    func testMediaCardPosterFallsBackFromAssetToVideoImageToMuxFrame() throws {
        let cards = try XCTUnwrap(mediaCollection(blocks[4])).cards
        XCTAssertEqual(cards[1].imageURL?.absoluteString, "https://images.jesusfilm.org/john.jpg")
        XCTAssertEqual(cards[0].imageURL?.absoluteString, "https://imagedelivery.net/jesus.jpg")
        XCTAssertNil(cards[2].imageURL, "no asset, no video image, and no dub")
    }

    func testCarouselCardsPlayDirectlyAndDeriveAPosterFromTheDub() throws {
        let cards = try XCTUnwrap(videoCarousel(blocks[5])).cards
        XCTAssertEqual(cards[0].route, .play(playbackID: "carouselPlayback01"))
        XCTAssertEqual(
            cards[0].imageURL,
            MuxURL.thumbnailURL(playbackID: "carouselPlayback01"),
            "RN leaves these cards as a flat colour; the dub it already holds gives a frame"
        )
        XCTAssertNil(cards[1].route, "no dub means nothing to play")
        XCTAssertEqual(cards[1].backgroundHex, "#2B2018", "the authored fill is the fallback")
    }

    func testNavigationCardsJumpToTheirContentId() throws {
        let cards = try XCTUnwrap(navigationCarousel(blocks[3])).cards
        XCTAssertEqual(cards[0].route, .section(key: "easter-explained/english"))
        XCTAssertEqual(cards[0].eyebrow, "Short Video")
        XCTAssertNil(cards[1].route)
    }

    /// Every fixture rail holds at least one item with a null `videoId`;
    /// keying cards off it would collapse those rows inside a `ForEach`.
    func testCardIdentitiesAreUniqueDespiteNullVideoIds() throws {
        let cards = try XCTUnwrap(mediaCollection(blocks[4])).cards
        XCTAssertEqual(Set(cards.map(\.id)).count, cards.count)
    }

    // MARK: Leaf blocks

    func testHeroDerivesItsPosterFromTheStreamAndKeepsTheAuthoredCtaLabel() throws {
        guard case .videoHero(let hero) = blocks[0] else { return XCTFail("expected a hero") }
        XCTAssertEqual(hero.heading, "Easter")
        XCTAssertEqual(hero.ctaLabel, "Watch now")
        XCTAssertEqual(hero.playbackID, "heroPlayback01")
        XCTAssertEqual(
            hero.posterURL,
            MuxURL.thumbnailURL(playbackID: "heroPlayback01", width: 1920)
        )
    }

    func testTextDropsBlankParagraphsAndKeepsTheSubtitle() throws {
        let container = try XCTUnwrap(container(blocks[2]))
        guard case .text(let text) = container.slots[0].content[0] else {
            return XCTFail("expected the container's text block")
        }
        XCTAssertEqual(text.subtitle, "Questioning? Searching?")
        XCTAssertEqual(text.paragraphs.count, 2, "the whitespace-only paragraph is not content")
    }

    func testQuestionsWithoutATextQuestionAreDroppedButBlankAnswersSurvive() throws {
        guard case .relatedQuestions(let questions) = blocks[9] else {
            return XCTFail("expected related questions")
        }
        XCTAssertEqual(questions.questions.count, 2, "a question with no text cannot render")
        // A null answer is the "ask a person" fallback, not a reason to drop
        // the row — admin's `RelatedQuestionItem.answer` is nullable.
        XCTAssertNil(questions.questions[1].answer)
    }

    /// A CTA label and an allowlisted destination are a pair. Either alone
    /// renders a control that lies about what it does.
    func testQuoteCtaRequiresBothALabelAndAnAllowlistedLink() throws {
        guard case .bibleQuotesCarousel(let quotes) = blocks[7] else {
            return XCTFail("expected bible quotes")
        }
        XCTAssertNil(quotes.quotes[0].ctaLabel, "no label authored")
        XCTAssertEqual(quotes.quotes[1].ctaLabel, "Join a Bible study")
        XCTAssertNotNil(quotes.quotes[1].ctaURL)
        XCTAssertNil(quotes.quotes[2].ctaLabel, "http is rejected, so the label goes with it")
        XCTAssertNil(quotes.quotes[2].ctaURL)
        // Falls back to the background asset when no foreground one is set.
        XCTAssertEqual(
            quotes.quotes[0].imageURL?.absoluteString,
            "https://images.jesusfilm.org/quote-bg.jpg"
        )
    }

    func testCtaKeepsItsLabelEvenWhenTheLinkIsAbsent() throws {
        guard case .cta(let cta) = blocks[8] else { return XCTFail("expected a cta") }
        // `buttonLink` is null on the live `christmas` page. The label must
        // survive so the block still offers a focus target.
        XCTAssertEqual(cta.buttonLabel, "Watch the Story")
        XCTAssertNil(cta.buttonURL)
    }

    func testQuizButtonDropsAnIframeOutsideTheNextstepAllowlist() throws {
        let section = try XCTUnwrap(section(blocks[10]))
        guard case .quizButton(let allowed) = section.content[1],
              case .quizButton(let rejected) = section.content[2]
        else { return XCTFail("expected two quiz buttons") }

        XCTAssertEqual(allowed.url?.host, "your.nextstep.is")
        // `nextstep.is.evil.example` shares a PREFIX, not a suffix — the
        // check that catches it is the one worth pinning.
        XCTAssertNil(rejected.url)
        XCTAssertEqual(rejected.label, "Off-allowlist quiz", "the label still projects")
    }

    func testSectionCarriesItsBackgroundAndAnchorKey() throws {
        let section = try XCTUnwrap(section(blocks[10]))
        XCTAssertEqual(section.sectionKey, "easter-meaning")
        XCTAssertEqual(
            section.backgroundImageURL?.absoluteString,
            "https://images.jesusfilm.org/section-bg.jpg"
        )
    }

    func testExperienceTitleProjects() throws {
        XCTAssertEqual(
            ExperienceProjection.title(try decodeExperience(experienceJSON)),
            "Easter"
        )
    }

    // MARK: Unwrapping helpers

    private func container(_ block: ExperienceBlock) -> ExperienceContainer? {
        if case .container(let model) = block { return model }
        return nil
    }

    private func section(_ block: ExperienceBlock) -> ExperienceSection? {
        if case .section(let model) = block { return model }
        return nil
    }

    private func mediaCollection(_ block: ExperienceBlock) -> ExperienceMediaCollection? {
        if case .mediaCollection(let model) = block { return model }
        return nil
    }

    private func videoCarousel(_ block: ExperienceBlock) -> ExperienceVideoCarousel? {
        if case .videoCarousel(let model) = block { return model }
        return nil
    }

    private func navigationCarousel(_ block: ExperienceBlock) -> ExperienceNavigationCarousel? {
        if case .navigationCarousel(let model) = block { return model }
        return nil
    }
}

// MARK: - Focus

/// Plan Finding 1: `.focusSection()` is inert in a region with no focusable
/// descendants, and a lazy container has materialised none. The eager prefix
/// is what guarantees a focus target exists at first layout.
final class ExperienceFocusTests: XCTestCase {
    private func blocks(_ blockJSON: String) throws -> [ExperienceBlock] {
        let json = """
        {"experienceBySlug":{"id":"e","slug":"s","title":null,"blocks":[\(blockJSON)]}}
        """
        return ExperienceProjection.project(try decodeExperience(json))
    }

    private let hero = """
    {"__typename":"VideoHeroBlock","heading":"H","videoDub":null}
    """
    private let text = """
    {"__typename":"TextBlock","textHeading":"H","contentParagraphs":["p"]}
    """
    private let rail = """
    {"__typename":"MediaCollectionBlock","sectionKey":"r","mcItems":[
      {"titleOverride":"Card","videoSlug":"jesus"}
    ]}
    """
    private let emptyRail = """
    {"__typename":"MediaCollectionBlock","sectionKey":"empty","mcItems":[]}
    """

    /// The hero's CTA renders whether or not there is a stream, so one block
    /// is enough.
    func testAHeroFirstPageGoesLazyImmediately() throws {
        let blocks = try blocks("\(hero),\(rail),\(text)")
        XCTAssertEqual(ExperienceProjection.eagerPrefixLength(blocks), 1)
    }

    /// The case "make the first block eager" gets wrong: a page opening on
    /// prose has nothing to aim at until the rail below it materialises.
    func testAProseFirstPageStaysEagerUntilTheFirstFocusableBlock() throws {
        let blocks = try blocks("\(text),\(text),\(rail),\(text)")
        XCTAssertEqual(ExperienceProjection.eagerPrefixLength(blocks), 3)
    }

    /// An empty rail draws nothing, so it cannot end the eager prefix — this
    /// is the exact shape that broke Home (a first rail with zero renderable
    /// items sitting above an unmaterialised LazyVStack).
    func testAnEmptyRailDoesNotCountAsFocusable() throws {
        let blocks = try blocks("\(emptyRail),\(rail)")
        XCTAssertEqual(ExperienceProjection.eagerPrefixLength(blocks), 2)
    }

    func testAPageWithNothingFocusableRendersWhole() throws {
        let blocks = try blocks("\(text),\(text)")
        XCTAssertEqual(ExperienceProjection.eagerPrefixLength(blocks), 2)
    }

    /// Focus inside a section or a container counts — the nested content is
    /// rendered eagerly by its own renderer.
    ///
    /// The trailing `text` is load-bearing, not padding. With only
    /// `[text, section]` the assertion is VACUOUS: "the section ends the
    /// prefix at 2" and "nothing on the page is focusable, so the whole page
    /// is eager — also 2" are indistinguishable, and a `.section` arm that
    /// stopped recursing into its children would pass. A third block makes
    /// the two hypotheses answer 2 and 3.
    func testNestedFocusCountsForTheBlockThatContainsIt() throws {
        let section = """
        {"__typename":"SectionBlock","sectionKey":"s","sectionContent":[\(rail)]}
        """
        XCTAssertEqual(
            ExperienceProjection.eagerPrefixLength(try blocks("\(text),\(section),\(text)")),
            2,
            "the section's nested rail must end the eager prefix"
        )
        XCTAssertTrue(try XCTUnwrap(blocks("\(section)").first).holdsFocus)

        let container = """
        {"__typename":"ContainerBlock","content":[
          {"__typename":"ContainerSlotBlock","gridSpan":6,"spans":null},\(text)
        ]}
        """
        XCTAssertEqual(
            ExperienceProjection.eagerPrefixLength(try blocks("\(container),\(rail)")),
            2,
            "a container holding only prose is not a focus target"
        )
        XCTAssertFalse(try XCTUnwrap(blocks("\(container)").first).holdsFocus)

        let focusableContainer = """
        {"__typename":"ContainerBlock","content":[
          {"__typename":"ContainerSlotBlock","gridSpan":6,"spans":null},\(rail)
        ]}
        """
        XCTAssertTrue(try XCTUnwrap(blocks("\(focusableContainer)").first).holdsFocus)
    }

    /// `holdsFocus` is the eager-prefix rule's whole input, and every arm of
    /// it is a CLAIM ABOUT A RENDERER: each of these blocks draws its control
    /// only when the condition below holds, so an arm that stopped checking
    /// would end the prefix at a block with nothing to aim at — the exact
    /// Finding 1 shape. Mutation-checked: flipping any single condition to a
    /// bare `true` must redden this test.
    func testEveryFocusPredicateArmTracksItsRenderersCondition() throws {
        func holdsFocus(_ blockJSON: String) throws -> Bool {
            try XCTUnwrap(blocks(blockJSON).first).holdsFocus
        }

        // CtaBlockView renders its Button only `if let label`.
        XCTAssertTrue(try holdsFocus("""
        {"__typename":"CtaBlock","ctaHeading":"H","buttonLabel":"Go","buttonLink":null}
        """), "a labelled CTA is focusable even with no destination")
        XCTAssertFalse(try holdsFocus("""
        {"__typename":"CtaBlock","ctaHeading":"H","buttonLabel":null,"buttonLink":"https://x.example/"}
        """), "no label means CtaBlockView draws no control at all")
        XCTAssertFalse(try holdsFocus("""
        {"__typename":"CtaBlock","ctaHeading":"H","buttonLabel":"   ","buttonLink":null}
        """), "a blank label is cleared authoring, not a control")

        // Every rail renderer returns nothing at all for an empty shelf.
        XCTAssertTrue(try holdsFocus("""
        {"__typename":"VideoCarouselBlock","vcItems":[{"titleOverride":"C"}]}
        """))
        XCTAssertFalse(try holdsFocus("""
        {"__typename":"VideoCarouselBlock","vcItems":[]}
        """))
        XCTAssertTrue(try holdsFocus("""
        {"__typename":"NavigationCarouselBlock","ncItems":[{"title":"C"}]}
        """))
        XCTAssertFalse(try holdsFocus("""
        {"__typename":"NavigationCarouselBlock","ncItems":[]}
        """))
        XCTAssertTrue(try holdsFocus("""
        {"__typename":"BibleQuotesCarouselBlock","quotes":[{"reference":"John 3:16"}]}
        """))
        XCTAssertFalse(try holdsFocus("""
        {"__typename":"BibleQuotesCarouselBlock","quotes":[]}
        """))

        // RelatedQuestionsBlockView draws one Button per SURVIVING question,
        // so a block whose only question has no text is a dead region.
        XCTAssertTrue(try holdsFocus("""
        {"__typename":"RelatedQuestionsBlock","questions":[{"question":"Why?","answer":null}]}
        """))
        XCTAssertFalse(try holdsFocus("""
        {"__typename":"RelatedQuestionsBlock","questions":[]}
        """))
        XCTAssertFalse(try holdsFocus("""
        {"__typename":"RelatedQuestionsBlock","questions":[{"question":"  ","answer":"orphan"}]}
        """), "a question with no text is dropped, so the block draws nothing")

        // The hero and the inline video emit their Button unconditionally —
        // that is why they need no emptiness check.
        XCTAssertTrue(try holdsFocus("""
        {"__typename":"VideoHeroBlock","heading":null,"ctaLabel":null,"videoDub":null}
        """), "the hero's button renders with nothing to play")
        XCTAssertTrue(try holdsFocus("""
        {"__typename":"VideoBlock","videoTitle":null,"videoDub":null}
        """), "the inline video's button renders with nothing to play")
    }

    /// A hero with no stream must not wear the authored play CTA. The live
    /// `easter` hero is exactly this: `ctaLabel: "Watch now"` over a null
    /// `videoId`/`videoDub`/`ctaLink`, so the authored copy would name an
    /// action the button cannot perform.
    func testHeroCtaCopyDropsTheAuthoredLabelWhenThereIsNothingToPlay() throws {
        guard case .videoHero(let stranded) = try XCTUnwrap(blocks("""
        {"__typename":"VideoHeroBlock","heading":"Easter","ctaLabel":"Watch now","videoDub":null}
        """).first) else { return XCTFail("expected a hero") }
        XCTAssertNil(stranded.playbackID)
        XCTAssertEqual(stranded.ctaLabel, "Watch now", "the authored label still projects")
        XCTAssertEqual(stranded.ctaTitle, "Explore", "but the button must not promise playback")

        guard case .videoHero(let playable) = try XCTUnwrap(blocks("""
        {"__typename":"VideoHeroBlock","heading":"Christmas","ctaLabel":"Watch now",
         "videoDub":{"muxVideo":{"playbackId":"heroPlayback01"}}}
        """).first) else { return XCTFail("expected a hero") }
        XCTAssertEqual(playable.ctaTitle, "Watch now", "a real stream keeps the authored copy")

        guard case .videoHero(let unlabelled) = try XCTUnwrap(blocks("""
        {"__typename":"VideoHeroBlock","heading":"H","ctaLabel":null,
         "videoDub":{"muxVideo":{"playbackId":"heroPlayback01"}}}
        """).first) else { return XCTFail("expected a hero") }
        XCTAssertEqual(unlabelled.ctaTitle, "Play")
    }

    /// A quiz whose link fails the allowlist renders nothing, so it must not
    /// be mistaken for a focus target.
    func testARejectedQuizButtonIsNotAFocusTarget() throws {
        let rejected = """
        {"__typename":"SectionBlock","sectionKey":"s","sectionContent":[
          {"__typename":"QuizButtonBlock","buttonText":"Q","iframeSrc":"https://evil.example/x"}
        ]}
        """
        XCTAssertEqual(ExperienceProjection.eagerPrefixLength(try blocks("\(rejected),\(rail)")), 2)
    }
}

// MARK: - Containers

final class ExperienceContainerTests: XCTestCase {
    private struct NotAContainer: Error {}

    private func slots(_ content: String) throws -> [ExperienceSlot] {
        let json = """
        {"experienceBySlug":{"id":"e","slug":"s","title":null,"blocks":[
          {"__typename":"ContainerBlock","sectionKey":null,"content":[\(content)]}
        ]}}
        """
        let blocks = ExperienceProjection.project(try decodeExperience(json))
        let first = try XCTUnwrap(blocks.first)
        guard case .container(let container) = first else { throw NotAContainer() }
        return container.slots
    }

    private let text = """
    {"__typename":"TextBlock","textHeading":"H","contentParagraphs":["p"]}
    """

    func testMarkersDivideFlatContentIntoSideBySideSlots() throws {
        let slots = try slots("""
        {"__typename":"ContainerSlotBlock","gridSpan":4,"spans":null},
        \(text),
        {"__typename":"ContainerSlotBlock","gridSpan":8,"spans":null},
        \(text)
        """)
        XCTAssertEqual(slots.map(\.span), [4, 8])
        XCTAssertEqual(slots.map { $0.content.count }, [1, 1])
    }

    /// Content authored before any marker must still render. RN's rule is
    /// explicit that it collapses into one slot rather than vanishing.
    func testContentBeforeAnyMarkerStillGetsASlot() throws {
        let slots = try slots(text)
        XCTAssertEqual(slots.count, 1)
        XCTAssertEqual(slots[0].span, 6, "half of a 12-column row is the fallback")
    }

    func testEmptySlotsAreDropped() throws {
        let slots = try slots("""
        {"__typename":"ContainerSlotBlock","gridSpan":6,"spans":null},
        {"__typename":"ContainerSlotBlock","gridSpan":6,"spans":null},
        \(text)
        """)
        XCTAssertEqual(slots.count, 1, "a marker with nothing after it draws nothing")
    }

    /// TV is one wide breakpoint, so the widest authored override wins over
    /// the base `gridSpan` — RN's `tvSpan`.
    func testWidestBreakpointOverridesTheBaseSpanAndOutOfRangeValuesClamp() throws {
        let slots = try slots("""
        {"__typename":"ContainerSlotBlock","gridSpan":3,"spans":{"xs":12,"sm":12,"md":6,"lg":5,"xl":4}},
        \(text),
        {"__typename":"ContainerSlotBlock","gridSpan":99,"spans":null},
        \(text),
        {"__typename":"ContainerSlotBlock","gridSpan":0,"spans":null},
        \(text)
        """)
        XCTAssertEqual(slots.map(\.span), [4, 12, 1])
    }

    /// A slot marker outside a container is a divider with nothing to divide.
    func testStandaloneSlotMarkersAreDropped() throws {
        let json = """
        {"experienceBySlug":{"id":"e","slug":"s","title":null,"blocks":[
          {"__typename":"ContainerSlotBlock","gridSpan":6,"spans":null}
        ]}}
        """
        XCTAssertTrue(ExperienceProjection.project(try decodeExperience(json)).isEmpty)
    }
}

// MARK: - Layout

final class ExperienceLayoutTests: XCTestCase {
    func testTwoEqualSlotsSplitTheRowExactly() {
        let widths = ExperienceLayout.slotWidths(spans: [6, 6])
        let expected: CGFloat = (1920 - 160 - 40) / 2
        XCTAssertEqual(widths, [expected, expected])
        XCTAssertEqual(widths.reduce(0, +) + 40, CGFloat(1920 - 160), accuracy: 0.001)
    }

    func testUnevenSpansSplitProportionally() {
        let widths = ExperienceLayout.slotWidths(spans: [4, 8])
        XCTAssertEqual(widths[1] / widths[0], 2, accuracy: 0.001)
    }

    /// An over-authored row (spans summing past 12) must shrink instead of
    /// running off the right edge of the screen.
    func testOverAuthoredRowsShrinkInsteadOfOverflowing() {
        let widths = ExperienceLayout.slotWidths(spans: [7, 7])
        let limit: CGFloat = 1920 - 160 + 0.001
        XCTAssertLessThanOrEqual(widths.reduce(0, +) + 40, limit)
    }

    /// The `max(12, …)` FLOOR, which every other test here is blind to: [6,6],
    /// [4,8] and [7,7] all sum to 12 or more, and there `max(12, total)` and
    /// `total` are the same number. Only an UNDER-authored row separates them
    /// — and that row is live-reachable, because container content authored
    /// with no leading slot marker collapses into a single span-6 slot
    /// (`testContentBeforeAnyMarkerStillGetsASlot`). Without the floor that
    /// lone slot would stretch to the full row instead of half of it.
    func testUnderAuthoredRowsKeepTheTwelveColumnFloor() {
        let soleSlot = ExperienceLayout.slotWidths(spans: [6])
        XCTAssertEqual(soleSlot, [(1920 - 160) / 2], "half a row, not the whole one")

        let available: CGFloat = 1920 - 160 - 40
        XCTAssertEqual(
            ExperienceLayout.slotWidths(spans: [3, 3]),
            [available * 3 / 12, available * 3 / 12],
            "a quarter-row pair stays a quarter row each"
        )
    }

    func testNoSlotsMeansNoWidths() {
        XCTAssertTrue(ExperienceLayout.slotWidths(spans: []).isEmpty)
    }
}

// MARK: - CMS URL allowlists

final class BlockURLTests: XCTestCase {
    func testActionLinksRequireHttps() {
        XCTAssertNotNil(BlockURL.action("https://www.jesusfilm.org/watch"))
        XCTAssertNil(BlockURL.action("http://www.jesusfilm.org/watch"))
        XCTAssertNil(BlockURL.action("javascript:alert(1)"))
        XCTAssertNil(BlockURL.action("data:text/html;base64,PHN2Zz4="))
        XCTAssertNil(BlockURL.action("   "))
        XCTAssertNil(BlockURL.action(nil))
    }

    func testQuizLinksAllowNextstepAndItsSubdomainsOnly() {
        XCTAssertNotNil(BlockURL.quiz("https://nextstep.is/embed/x"))
        XCTAssertNotNil(BlockURL.quiz("https://your.nextstep.is/embed/x"))
        XCTAssertNil(BlockURL.quiz("https://nextstep.is.evil.example/embed/x"))
        XCTAssertNil(BlockURL.quiz("https://notnextstep.is/embed/x"))
        XCTAssertNil(BlockURL.quiz("http://nextstep.is/embed/x"))
        XCTAssertNil(BlockURL.quiz("https://nextstep.is:8443/embed/x"))
    }

    /// The trap this check exists for: the host really IS `nextstep.is`, so a
    /// host-only allowlist passes it — but a phone that scans the QR resolves
    /// the userinfo and may land somewhere else entirely.
    func testQuizLinksWithEmbeddedCredentialsAreRejected() {
        XCTAssertNil(BlockURL.quiz("https://evil.example@nextstep.is/embed/x"))
        XCTAssertNil(BlockURL.quiz("https://user:pass@nextstep.is/embed/x"))
    }
}

// MARK: - Colour

final class HexColorTests: XCTestCase {
    func testParsesSixDigitHexWithOrWithoutAHash() throws {
        let withHash = try XCTUnwrap(HexColor.components("#1A1815"))
        let without = try XCTUnwrap(HexColor.components("1a1815"))
        XCTAssertEqual(withHash.red, Double(0x1A) / 255, accuracy: 0.0001)
        XCTAssertEqual(withHash.green, Double(0x18) / 255, accuracy: 0.0001)
        XCTAssertEqual(withHash.blue, Double(0x15) / 255, accuracy: 0.0001)
        XCTAssertEqual(withHash.red, without.red, accuracy: 0.0001)
    }

    func testExpandsTheThreeDigitShortForm() throws {
        let short = try XCTUnwrap(HexColor.components("#f00"))
        XCTAssertEqual(short.red, 1, accuracy: 0.0001)
        XCTAssertEqual(short.green, 0, accuracy: 0.0001)
    }

    /// `UInt32(_:radix:)` accepts a leading PLUS, so "+01815" parses to 6165
    /// and only the `allSatisfy(\.isHexDigit)` guard rejects it. A leading
    /// MINUS does not discriminate — the destination type is unsigned, so the
    /// parse already returns nil and "-01815" passes with or without the
    /// guard. Verified by hand on Swift 6.3.3, 2026-08-12:
    /// `UInt32("+01815", radix: 16) == 6165`, `UInt32("-01815", radix: 16) == nil`.
    func testRejectsAnythingThatIsNotPlainHex() {
        XCTAssertNil(HexColor.components("+01815"), "the case the digit guard exists for")
        XCTAssertNil(HexColor.components("-01815"))
        XCTAssertNil(HexColor.components("#12345"))
        XCTAssertNil(HexColor.components("rebeccapurple"))
        XCTAssertNil(HexColor.components("  "))
        XCTAssertNil(HexColor.components(nil))
    }
}

// MARK: - Easter / Passover

final class EasterDatesTests: XCTestCase {
    private let utc = TimeZone(identifier: "UTC")!

    private func formatted(_ date: Date?) throws -> String {
        EasterDates.format(try XCTUnwrap(date), locale: "en-US", timeZone: utc)
    }

    func testWesternEasterMatchesTheGregorianComputus() throws {
        XCTAssertEqual(try formatted(EasterDates.westernEaster(year: 2024, timeZone: utc)), "Sunday, March 31, 2024")
        XCTAssertEqual(try formatted(EasterDates.westernEaster(year: 2025, timeZone: utc)), "Sunday, April 20, 2025")
        XCTAssertEqual(try formatted(EasterDates.westernEaster(year: 2026, timeZone: utc)), "Sunday, April 5, 2026")
        XCTAssertEqual(try formatted(EasterDates.westernEaster(year: 2027, timeZone: utc)), "Sunday, March 28, 2027")
    }

    /// 2024 and 2027 are the cases that matter: the Julian computus plus 13
    /// days produces "April 35" and "April 32", which only land correctly
    /// because `Calendar.date(from:)` normalises the overflow the same way
    /// `new Date(y, m, d)` does in the React Native renderer.
    func testOrthodoxEasterNormalisesTheThirteenDayOverflow() throws {
        XCTAssertEqual(try formatted(EasterDates.orthodoxEaster(year: 2024, timeZone: utc)), "Sunday, May 5, 2024")
        XCTAssertEqual(try formatted(EasterDates.orthodoxEaster(year: 2025, timeZone: utc)), "Sunday, April 20, 2025")
        XCTAssertEqual(try formatted(EasterDates.orthodoxEaster(year: 2026, timeZone: utc)), "Sunday, April 12, 2026")
        XCTAssertEqual(try formatted(EasterDates.orthodoxEaster(year: 2027, timeZone: utc)), "Sunday, May 2, 2027")
    }

    /// 5784 (the Hebrew year covering April 2024) is a LEAP year and carries
    /// an Adar I; 5786 (April 2026) does not. Both land correctly only if
    /// Nisan really is a fixed month 8 in ICU's Hebrew calendar, which is the
    /// assumption that replaces RN's `@hebcal/hdate` dependency.
    func testPassoverIsFifteenNisanInBothLeapAndCommonHebrewYears() throws {
        XCTAssertEqual(try formatted(EasterDates.passover(year: 2024, timeZone: utc)), "Tuesday, April 23, 2024")
        XCTAssertEqual(try formatted(EasterDates.passover(year: 2025, timeZone: utc)), "Sunday, April 13, 2025")
        XCTAssertEqual(try formatted(EasterDates.passover(year: 2026, timeZone: utc)), "Thursday, April 2, 2026")
        XCTAssertEqual(try formatted(EasterDates.passover(year: 2027, timeZone: utc)), "Thursday, April 22, 2027")
    }

    /// Field ORDER belongs to the locale. A hard-coded "EEEE, MMMM d, y"
    /// would read wrong outside en-US, which is why the formatter is built
    /// from a template.
    func testFormattingFollowsTheBlocksLocale() throws {
        let easter = try XCTUnwrap(EasterDates.westernEaster(year: 2026, timeZone: utc))
        let british = EasterDates.format(easter, locale: "en-GB", timeZone: utc)
        XCTAssertTrue(british.contains("5 April 2026"), "got \(british)")

        let fallback = EasterDates.format(easter, locale: nil, timeZone: utc)
        XCTAssertEqual(
            fallback,
            EasterDates.format(easter, locale: EasterDates.defaultLocale, timeZone: utc)
        )
    }

    func testTitleSubstitutesTheYearPlaceholder() {
        XCTAssertEqual(
            EasterDates.title("When is Easter celebrated in {year}?", year: 2026),
            "When is Easter celebrated in 2026?"
        )
        XCTAssertEqual(EasterDates.title("No placeholder", year: 2026), "No placeholder")
        XCTAssertNil(EasterDates.title(nil, year: 2026))
    }
}

// MARK: - Query contract

final class ExperienceQueryContractTests: XCTestCase {
    private let query = ExperienceQueries.experienceBySlug

    /// The alias scheme is what lets 13 block kinds decode into ONE
    /// all-optional struct. Drop an alias and three unrelated item shapes
    /// collide on the key `items`, which decodes as a silent nil rather than
    /// an error — no test below this line would notice.
    func testItemAliasesKeepTheThreeRailShapesApart() {
        XCTAssertTrue(query.contains("mcItems: items"))
        XCTAssertTrue(query.contains("vcItems: items"))
        XCTAssertTrue(query.contains("ncItems: items"))
    }

    func testHeadingAndTitleAliasesKeepTheirBlocksApart() {
        for alias in [
            "textHeading: heading", "rqHeading: heading", "bqcHeading: heading",
            "ctaHeading: heading", "mcTitle: title", "vcTitle: title", "videoTitle: title",
            "mcSubtitle: subtitle", "vcSubtitle: subtitle", "videoSubtitle: subtitle",
        ] {
            XCTAssertTrue(query.contains(alias), "missing alias: \(alias)")
        }
    }

    /// Replaces RN's second `watchHomeVideos` round trip. Losing it would not
    /// break the screen — every MediaCollection card would just silently read
    /// "Untitled".
    func testMediaItemsAskAdminToResolveTheirTitles() {
        XCTAssertTrue(query.contains("resolvedTitle(locale: $locale)"))
    }

    /// AdventCountdown, Card, PromoBanner and InfoBlocks reach the client as a
    /// bare `__typename`. Selecting fields for a block with no renderer is
    /// payload on every page load with nothing to show for it.
    func testNoFieldsAreSelectedForBlocksWithNoRenderer() {
        XCTAssertFalse(query.contains("AdventCountdownBlock"))
        XCTAssertFalse(query.contains("scriptureReference"))
        XCTAssertFalse(query.contains("PromoBannerBlock"))
    }

    /// QuizButtonBlock is not a member of admin's top-level `ExperienceBlock`
    /// union — it is only valid inside a section. Spreading it at the top
    /// level is a server-side validation error, not a no-op.
    func testQuizButtonIsOnlySpreadInsideASection() {
        let topLevel = query.components(separatedBy: "fragment VideoHeroFields")[0]
        XCTAssertFalse(topLevel.contains("QuizButtonFields"))
        XCTAssertTrue(query.contains("...QuizButtonFields"))
    }
}
