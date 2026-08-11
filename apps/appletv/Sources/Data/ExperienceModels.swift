import Foundation

// UI projections for the SDUI Experience pipeline — the Swift mirror of
// `apps/tv/src/lib/normalizer.ts`. Wire blocks arrive as one all-optional
// struct keyed by `__typename`; models leave as a discriminated enum whose
// payloads are already narrowed, so no renderer threads an optional it cannot
// render.

// MARK: - Rail cards

/// What selecting a rail card does. Modelled as data rather than a closure so
/// the projection stays pure and the routing table is a unit-test assertion.
enum RailRoute: Equatable {
    /// Jump to another block on THIS page (RN's `scrollToSection`).
    case section(key: String)
    /// Push the Watch detail screen.
    case video(slug: String)
    /// Open fullscreen playback directly.
    case play(playbackID: String)
}

/// One card in any of the three rail-shaped blocks. MediaCollection,
/// VideoCarousel, and NavigationCarousel differ only in card geometry and
/// heading copy, so they project to the same card and share one renderer.
struct RailCard: Equatable, Identifiable {
    let id: String
    let title: String
    /// Small uppercase line above the title (category / label override).
    let eyebrow: String?
    /// Corner pill — a STRING from the wire ("61 chapters"), not a count.
    let badge: String?
    let imageURL: URL?
    /// Authored fill shown when the card has no artwork.
    let backgroundHex: String?
    /// nil means the card is focusable but inert — never skipped. A hole in a
    /// rail breaks directional browsing far worse than a card that does
    /// nothing (plan Finding 1).
    let route: RailRoute?
}

// MARK: - Block payloads

struct ExperienceHero: Equatable {
    let id: String
    let sectionKey: String?
    let heading: String?
    let subheading: String?
    let ctaLabel: String?
    let playbackID: String?
    let posterURL: URL?

    /// What the hero's button actually says.
    ///
    /// The hero button is ALWAYS rendered — it is the topmost region's only
    /// focusable control and the screen has not scrolled yet, so dropping it
    /// is the plan's Finding 1 in miniature. But the AUTHORED label only
    /// survives when there is something to play: the live `easter` hero
    /// carries `ctaLabel: "Watch now"` with a null `videoId`, `videoDub` AND
    /// `ctaLink`, so honouring it would put a prominent "Watch now" on the
    /// flagship page that does nothing when pressed. Same rule the quote CTA
    /// and the quiz button already follow — a control must not name an action
    /// it cannot perform.
    ///
    /// Lives on the model rather than in `HeroBlockView` so it can be
    /// asserted without a view host, like `holdsFocus` below.
    var ctaTitle: String {
        guard playbackID != nil else { return "Explore" }
        return ctaLabel ?? "Play"
    }
}

struct ExperienceSection: Equatable {
    let id: String
    let sectionKey: String?
    let backgroundImageURL: URL?
    let content: [ExperienceBlock]
}

struct ExperienceSlot: Equatable, Identifiable {
    let id: String
    /// 1…12 grid span, resolved xl → lg → md → `gridSpan` → 6 (RN's `tvSpan`).
    let span: Int
    let content: [ExperienceBlock]
}

struct ExperienceContainer: Equatable {
    let id: String
    let sectionKey: String?
    let slots: [ExperienceSlot]
}

enum MediaCardOrientation: String, Equatable {
    case vertical
    case horizontal
}

struct ExperienceMediaCollection: Equatable {
    let id: String
    let sectionKey: String?
    let eyebrow: String?
    let title: String?
    let subtitle: String?
    let orientation: MediaCardOrientation
    let cards: [RailCard]
}

struct ExperienceVideoCarousel: Equatable {
    let id: String
    let sectionKey: String?
    let title: String?
    let subtitle: String?
    let cards: [RailCard]
}

struct ExperienceNavigationCarousel: Equatable {
    let id: String
    let sectionKey: String?
    let cards: [RailCard]
}

struct ExperienceText: Equatable {
    let id: String
    let sectionKey: String?
    let heading: String?
    let subtitle: String?
    let paragraphs: [String]
}

struct ExperienceEasterDates: Equatable {
    let id: String
    let sectionKey: String?
    /// Authored title with `{year}` still unsubstituted — the substitution is
    /// `EasterDates.title(_:year:)` so it can be asserted without a view.
    let titleTemplate: String?
    let westernLabel: String?
    let orthodoxLabel: String?
    let passoverLabel: String?
    /// BCP-47 tag the three dates format in. nil falls back to en-US, matching
    /// RN's `section.locale ?? "en-US"`.
    let locale: String?
}

struct ExperienceQuote: Equatable, Identifiable {
    let id: String
    let reference: String?
    let text: String?
    let attribution: String?
    let imageURL: URL?
    let backgroundHex: String?
    /// Both non-nil or the card renders no CTA — a label with no destination
    /// is a promise the card cannot keep.
    let ctaLabel: String?
    let ctaURL: URL?
}

struct ExperienceBibleQuotes: Equatable {
    let id: String
    let sectionKey: String?
    let heading: String?
    let quotes: [ExperienceQuote]
}

struct ExperienceCta: Equatable {
    let id: String
    let sectionKey: String?
    let heading: String?
    let body: String?
    let buttonLabel: String?
    /// nil when `buttonLink` is absent or fails the https check; the button
    /// still renders (focusable, inert) so the region keeps a focus target.
    let buttonURL: URL?
}

struct ExperienceQuestion: Equatable, Identifiable {
    let id: String
    let question: String
    /// Admin's `RelatedQuestionItem.answer` is nullable; a blank answer takes
    /// the "ask a person" fallback rather than expanding to nothing.
    let answer: String?
}

struct ExperienceRelatedQuestions: Equatable {
    let id: String
    let sectionKey: String?
    let heading: String?
    let questions: [ExperienceQuestion]
}

struct ExperienceVideo: Equatable {
    let id: String
    let sectionKey: String?
    let title: String?
    let subtitle: String?
    let playbackID: String?
    let posterURL: URL?
}

struct ExperienceQuizButton: Equatable {
    let id: String
    let sectionKey: String?
    let label: String
    /// nil when the authored `iframeSrc` fails the nextstep.is allowlist. The
    /// block then renders NOTHING, matching RN's silent drop — a quiz button
    /// that opens nowhere is worse than no button.
    let url: URL?
}

// MARK: - The block union

/// One case per renderable kind, plus a terminal `unsupported` for block types
/// the schema defines and this app knowingly does not draw.
///
/// `unsupported` is not the same as "unknown": an unknown `__typename` is
/// DROPPED by the projection and never reaches a renderer, while `unsupported`
/// survives as a positive record that the block was recognised and rendered as
/// nothing — RN's `PlaceholderRenderer` path, which is where `AdventCountdown`
/// lives in both apps.
indirect enum ExperienceBlock: Equatable, Identifiable {
    case videoHero(ExperienceHero)
    case section(ExperienceSection)
    case container(ExperienceContainer)
    case mediaCollection(ExperienceMediaCollection)
    case videoCarousel(ExperienceVideoCarousel)
    case navigationCarousel(ExperienceNavigationCarousel)
    case text(ExperienceText)
    case easterDates(ExperienceEasterDates)
    case bibleQuotesCarousel(ExperienceBibleQuotes)
    case cta(ExperienceCta)
    case relatedQuestions(ExperienceRelatedQuestions)
    case video(ExperienceVideo)
    case quizButton(ExperienceQuizButton)
    case unsupported(id: String, typename: String)

    var id: String {
        switch self {
        case .videoHero(let b): return b.id
        case .section(let b): return b.id
        case .container(let b): return b.id
        case .mediaCollection(let b): return b.id
        case .videoCarousel(let b): return b.id
        case .navigationCarousel(let b): return b.id
        case .text(let b): return b.id
        case .easterDates(let b): return b.id
        case .bibleQuotesCarousel(let b): return b.id
        case .cta(let b): return b.id
        case .relatedQuestions(let b): return b.id
        case .video(let b): return b.id
        case .quizButton(let b): return b.id
        case .unsupported(let id, _): return id
        }
    }

    /// The authored anchor other blocks jump to (a NavigationCarousel item's
    /// `contentId`, a MediaCollection item's `linkToSectionKey`).
    var sectionKey: String? {
        switch self {
        case .videoHero(let b): return b.sectionKey
        case .section(let b): return b.sectionKey
        case .container(let b): return b.sectionKey
        case .mediaCollection(let b): return b.sectionKey
        case .videoCarousel(let b): return b.sectionKey
        case .navigationCarousel(let b): return b.sectionKey
        case .text(let b): return b.sectionKey
        case .easterDates(let b): return b.sectionKey
        case .bibleQuotesCarousel(let b): return b.sectionKey
        case .cta(let b): return b.sectionKey
        case .relatedQuestions(let b): return b.sectionKey
        case .video(let b): return b.sectionKey
        case .quizButton(let b): return b.sectionKey
        case .unsupported: return nil
        }
    }
}

// MARK: - Focus

extension ExperienceBlock {
    /// Whether this block puts at least one focusable control on screen.
    ///
    /// READ THIS AS A CLAIM ABOUT THE RENDERERS, not an independent fact. It
    /// is only true because each renderer emits its control unconditionally:
    /// the hero's CTA and the inline video's button render whether or not
    /// there is anything to play, and a rail's cards stay focusable when they
    /// have no route. A renderer that starts hiding its only Button
    /// falsifies this silently — which is precisely the shape of the bug the
    /// plan's Finding 1 describes.
    ///
    /// It lives beside the models rather than inside the views so the screen's
    /// eager-prefix rule can be asserted without a view host.
    var holdsFocus: Bool {
        switch self {
        case .videoHero, .video:
            return true
        case .mediaCollection(let block):
            return !block.cards.isEmpty
        case .videoCarousel(let block):
            return !block.cards.isEmpty
        case .navigationCarousel(let block):
            return !block.cards.isEmpty
        case .bibleQuotesCarousel(let block):
            return !block.quotes.isEmpty
        case .relatedQuestions(let block):
            return !block.questions.isEmpty
        case .cta(let block):
            return block.buttonLabel != nil
        case .quizButton(let block):
            // No allowlisted URL means the renderer draws nothing at all.
            return block.url != nil
        case .section(let block):
            return block.content.contains(where: \.holdsFocus)
        case .container(let block):
            return block.slots.contains { $0.content.contains(where: \.holdsFocus) }
        case .text, .easterDates, .unsupported:
            return false
        }
    }
}

// MARK: - Projection

enum ExperienceProjection {
    /// Typenames this app recognises. The value is `nil` for kinds admin
    /// defines but neither client draws — they become `.unsupported` rather
    /// than vanishing, so "we chose not to draw this" stays distinguishable
    /// from "we have never heard of this".
    ///
    /// `AdventCountdownBlock` is the load-bearing entry: RN has a fragment and
    /// a model for it but no dispatcher case, so it renders nothing there.
    /// Parity is matching that, NOT writing countdown maths.
    ///
    /// RN's map also carries `ComponentSections*` keys from the retired Strapi
    /// schema. Admin's `ExperienceBlock` union has no such members, and Strapi
    /// is gone from this repo, so they are deliberately absent here.
    private static let renderableTypenames: Set<String> = [
        "VideoHeroBlock",
        "SectionBlock",
        "ContainerBlock",
        "MediaCollectionBlock",
        "VideoCarouselBlock",
        "NavigationCarouselBlock",
        "TextBlock",
        "EasterDatesBlock",
        "BibleQuotesCarouselBlock",
        "CtaBlock",
        "RelatedQuestionsBlock",
        "VideoBlock",
        "QuizButtonBlock",
    ]

    private static let recognisedButUndrawn: Set<String> = [
        "AdventCountdownBlock",
        "CardBlock",
        "PromoBannerBlock",
        "InfoBlocksBlock",
    ]

    static func project(_ data: ExperienceData) -> [ExperienceBlock] {
        blocks(data.experienceBySlug?.blocks, path: "b")
    }

    static func title(_ data: ExperienceData) -> String? {
        firstNonBlank(data.experienceBySlug?.title)
    }

    /// How many leading blocks the screen must render EAGERLY: everything up
    /// to and including the first one that can hold focus.
    ///
    /// The plan's Finding 1 in one number. `.focusSection()` does nothing in a
    /// region with no focusable descendants, and a lazy container has
    /// materialised none at the moment of a swipe — so "make the first block
    /// eager" is not enough when that block is a paragraph of text. The rule
    /// has to run until focus actually exists.
    ///
    /// A page with nothing focusable at all renders whole; those pages are
    /// prose and short, and there is no laziness worth buying with a focus
    /// dead end.
    static func eagerPrefixLength(_ blocks: [ExperienceBlock]) -> Int {
        guard let index = blocks.firstIndex(where: \.holdsFocus) else {
            return blocks.count
        }
        return index + 1
    }

    private static func blocks(
        _ wire: [WireExperienceBlock]?,
        path: String
    ) -> [ExperienceBlock] {
        (wire ?? []).enumerated().compactMap { index, item in
            block(item, id: "\(path).\(index)")
        }
    }

    private static func block(
        _ wire: WireExperienceBlock,
        id: String
    ) -> ExperienceBlock? {
        guard let typename = wire.__typename else { return nil }
        if recognisedButUndrawn.contains(typename) {
            return .unsupported(id: id, typename: typename)
        }
        // Includes `ContainerSlotBlock` when it appears outside a container,
        // where it is a marker with nothing to mark.
        guard renderableTypenames.contains(typename) else { return nil }

        let key = firstNonBlank(wire.sectionKey)

        switch typename {
        case "VideoHeroBlock":
            let playbackID = wire.videoDub?.muxVideo?.playbackId
            return .videoHero(ExperienceHero(
                id: id,
                sectionKey: key,
                heading: firstNonBlank(wire.heading),
                subheading: firstNonBlank(wire.subheading),
                ctaLabel: firstNonBlank(wire.ctaLabel),
                playbackID: playbackID,
                // The hero fragment carries no image field in either app, so
                // the poster is always derived from the Mux stream.
                posterURL: MuxURL.thumbnailURL(playbackID: playbackID, width: 1920)
            ))

        case "SectionBlock":
            return .section(ExperienceSection(
                id: id,
                sectionKey: key,
                backgroundImageURL: url(wire.backgroundImageAsset?.previewUrl),
                content: blocks(wire.sectionContent, path: id)
            ))

        case "ContainerBlock":
            return .container(ExperienceContainer(
                id: id,
                sectionKey: key,
                slots: slots(wire.content, path: id)
            ))

        case "MediaCollectionBlock":
            return .mediaCollection(ExperienceMediaCollection(
                id: id,
                sectionKey: key,
                eyebrow: firstNonBlank(wire.categoryLabel),
                title: firstNonBlank(wire.mcTitle),
                subtitle: firstNonBlank(wire.mcSubtitle),
                orientation: orientation(wire.thumbnailOrientation),
                cards: mediaCards(wire, path: id)
            ))

        case "VideoCarouselBlock":
            return .videoCarousel(ExperienceVideoCarousel(
                id: id,
                sectionKey: key,
                title: firstNonBlank(wire.vcTitle),
                subtitle: firstNonBlank(wire.vcSubtitle),
                cards: carouselCards(wire, path: id)
            ))

        case "NavigationCarouselBlock":
            return .navigationCarousel(ExperienceNavigationCarousel(
                id: id,
                sectionKey: key,
                cards: navigationCards(wire, path: id)
            ))

        case "TextBlock":
            return .text(ExperienceText(
                id: id,
                sectionKey: key,
                heading: firstNonBlank(wire.textHeading),
                subtitle: firstNonBlank(wire.subtitle),
                paragraphs: (wire.contentParagraphs ?? []).compactMap { firstNonBlank($0) }
            ))

        case "EasterDatesBlock":
            return .easterDates(ExperienceEasterDates(
                id: id,
                sectionKey: key,
                titleTemplate: firstNonBlank(wire.easterDatesTitle),
                westernLabel: firstNonBlank(wire.westernEasterLabel),
                orthodoxLabel: firstNonBlank(wire.orthodoxEasterLabel),
                passoverLabel: firstNonBlank(wire.passoverLabel),
                locale: firstNonBlank(wire.locale)
            ))

        case "BibleQuotesCarouselBlock":
            return .bibleQuotesCarousel(ExperienceBibleQuotes(
                id: id,
                sectionKey: key,
                heading: firstNonBlank(wire.bqcHeading),
                quotes: quotes(wire, path: id)
            ))

        case "CtaBlock":
            return .cta(ExperienceCta(
                id: id,
                sectionKey: key,
                heading: firstNonBlank(wire.ctaHeading),
                body: firstNonBlank(wire.body),
                buttonLabel: firstNonBlank(wire.buttonLabel),
                buttonURL: BlockURL.action(wire.buttonLink)
            ))

        case "RelatedQuestionsBlock":
            return .relatedQuestions(ExperienceRelatedQuestions(
                id: id,
                sectionKey: key,
                heading: firstNonBlank(wire.rqHeading),
                questions: (wire.questions ?? []).enumerated().compactMap { index, item in
                    guard let question = firstNonBlank(item.question) else { return nil }
                    return ExperienceQuestion(
                        id: "\(id).q\(index)",
                        question: question,
                        answer: firstNonBlank(item.answer)
                    )
                }
            ))

        case "VideoBlock":
            let playbackID = wire.videoDub?.muxVideo?.playbackId
            return .video(ExperienceVideo(
                id: id,
                sectionKey: key,
                title: firstNonBlank(wire.videoTitle),
                subtitle: firstNonBlank(wire.videoSubtitle),
                playbackID: playbackID,
                posterURL: MuxURL.thumbnailURL(playbackID: playbackID, width: 1280)
            ))

        case "QuizButtonBlock":
            return .quizButton(ExperienceQuizButton(
                id: id,
                sectionKey: key,
                label: firstNonBlank(wire.buttonText) ?? "Take the quiz",
                url: BlockURL.quiz(wire.iframeSrc)
            ))

        default:
            return nil
        }
    }

    // MARK: Rails

    private static func mediaCards(
        _ wire: WireExperienceBlock,
        path: String
    ) -> [RailCard] {
        (wire.mcItems ?? []).enumerated().map { index, item in
            let playbackID = item.videoDub?.muxVideo?.playbackId
            return RailCard(
                // Index-derived, not `videoId`: items routinely arrive with a
                // null videoId, and a duplicate id inside one ForEach silently
                // drops rows.
                id: "\(path).c\(index)",
                // Authored override wins; then admin's `resolvedTitle`, which
                // is the linked video's localized title. Empty strings fall
                // through — admin clears overrides to "".
                title: firstNonBlank(item.titleOverride, item.resolvedTitle) ?? "Untitled",
                eyebrow: firstNonBlank(item.labelOverride, wire.categoryLabel),
                badge: firstNonBlank(item.collectionSize),
                imageURL: url(item.imageAsset?.previewUrl)
                    ?? url(item.videoImage?.previewUrl)
                    ?? MuxURL.thumbnailURL(playbackID: playbackID),
                backgroundHex: nil,
                // In-page jump first (RN's only action here), then the Watch
                // route. A collection-shaped record still routes to /watch —
                // the watch screen owns the series redirect (plan Finding 4).
                route: firstNonBlank(item.linkToSectionKey).map(RailRoute.section(key:))
                    ?? firstNonBlank(item.videoSlug).map(RailRoute.video(slug:))
            )
        }
    }

    private static func carouselCards(
        _ wire: WireExperienceBlock,
        path: String
    ) -> [RailCard] {
        (wire.vcItems ?? []).enumerated().map { index, item in
            let playbackID = item.videoDub?.muxVideo?.playbackId
            return RailCard(
                id: "\(path).c\(index)",
                title: firstNonBlank(item.titleOverride) ?? "Untitled",
                eyebrow: nil,
                badge: nil,
                // RN renders a flat authored colour here because it never asks
                // Mux for a frame — but it holds the same playback id, and its
                // own hero renderer derives a poster exactly this way. The
                // fallback stays (an item with no dub has neither).
                imageURL: url(item.imageAsset?.previewUrl)
                    ?? MuxURL.thumbnailURL(playbackID: playbackID),
                backgroundHex: firstNonBlank(item.backgroundColor),
                route: playbackID.map(RailRoute.play(playbackID:))
            )
        }
    }

    private static func navigationCards(
        _ wire: WireExperienceBlock,
        path: String
    ) -> [RailCard] {
        (wire.ncItems ?? []).enumerated().map { index, item in
            RailCard(
                id: "\(path).c\(index)",
                title: firstNonBlank(item.title) ?? "Untitled",
                eyebrow: firstNonBlank(item.category),
                badge: nil,
                imageURL: url(item.imageAsset?.previewUrl),
                backgroundHex: firstNonBlank(item.backgroundColor),
                route: firstNonBlank(item.contentId).map(RailRoute.section(key:))
            )
        }
    }

    private static func quotes(
        _ wire: WireExperienceBlock,
        path: String
    ) -> [ExperienceQuote] {
        (wire.quotes ?? []).enumerated().map { index, quote in
            let ctaURL = BlockURL.action(quote.ctaLink)
            let ctaLabel = firstNonBlank(quote.ctaLabel)
            return ExperienceQuote(
                id: "\(path).q\(index)",
                reference: firstNonBlank(quote.reference),
                text: firstNonBlank(quote.text),
                attribution: firstNonBlank(quote.attribution),
                imageURL: url(quote.imageAsset?.previewUrl)
                    ?? url(quote.backgroundImageAsset?.previewUrl),
                backgroundHex: firstNonBlank(quote.backgroundColor),
                // Paired on purpose: a label with a rejected link would render
                // a CTA that does nothing.
                ctaLabel: ctaURL == nil ? nil : ctaLabel,
                ctaURL: ctaLabel == nil ? nil : ctaURL
            )
        }
    }

    // MARK: Containers

    /// Admin containers are FLAT: `ContainerSlotBlock` markers divide
    /// `content[]` into side-by-side slots, each marker carrying its span.
    /// Rebuild those groups, port of RN's `groupContainerSlots`.
    private static func slots(
        _ wire: [WireExperienceBlock]?,
        path: String
    ) -> [ExperienceSlot] {
        var groups: [(span: Int, content: [ExperienceBlock])] = []

        for (index, item) in (wire ?? []).enumerated() {
            if item.__typename == "ContainerSlotBlock" {
                groups.append((span: span(of: item), content: []))
                continue
            }
            guard let projected = block(item, id: "\(path).\(index)") else { continue }
            if groups.isEmpty {
                // Content authored with no leading marker collapses into one
                // slot rather than vanishing.
                groups.append((span: defaultSpan, content: []))
            }
            groups[groups.count - 1].content.append(projected)
        }

        return groups.enumerated()
            .filter { !$0.element.content.isEmpty }
            .map { ExperienceSlot(id: "\(path).s\($0.offset)", span: $0.element.span, content: $0.element.content) }
    }

    /// Half of a 12-column row — RN's `clampSpan` fallback.
    private static let defaultSpan = 6

    private static func span(of wire: WireExperienceBlock) -> Int {
        let base = clampSpan(wire.gridSpan) ?? defaultSpan
        // TV is a single wide breakpoint: take the widest authored override
        // available, exactly as RN's `tvSpan` does.
        let responsive = wire.spans?.xl ?? wire.spans?.lg ?? wire.spans?.md
        return clampSpan(responsive) ?? base
    }

    private static func clampSpan(_ value: Int?) -> Int? {
        guard let value else { return nil }
        return min(12, max(1, value))
    }

    // MARK: Helpers

    private static func orientation(_ raw: String?) -> MediaCardOrientation {
        // Unknown/absent keeps the legacy portrait shape, matching
        // `resolveMediaCollectionThumbnailOrientation(_, "vertical")`.
        MediaCardOrientation(rawValue: raw ?? "") ?? .vertical
    }

    private static func url(_ raw: String?) -> URL? {
        firstNonBlank(raw).flatMap(URL.init(string:))
    }
}

/// First value that is neither nil nor whitespace-only. Blank-vs-nil matters
/// here: admin clears an authored override to `""`, and treating that as a
/// present value puts an empty line where the fallback belongs.
///
/// File-scoped rather than shared: the name is generic enough that a
/// module-wide one would collide with the next screen's helper.
private func firstNonBlank(_ values: String?...) -> String? {
    for value in values {
        if let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return value
        }
    }
    return nil
}

// MARK: - Layout

/// Geometry shared by the block renderers, kept out of the views so the one
/// piece with arithmetic in it can be asserted directly.
///
/// The canvas is a CONSTANT, not a measurement: tvOS lays every app out in a
/// 1920×1080 POINT space (a 4K screen is the same point space at @2x). RN
/// makes the identical assumption — its `scale()` is a no-op on tvOS and
/// normalises Android TV against a 1920 reference — so every dimension here
/// is RN's number verbatim.
enum ExperienceLayout {
    static let canvasWidth: CGFloat = 1920
    /// Horizontal screen gutter, shared by every block.
    static let gutter: CGFloat = 80
    static let slotSpacing: CGFloat = 40

    /// Widths for one container row's side-by-side slots.
    ///
    /// Admin authors spans against a 12-column grid. The denominator is
    /// `max(12, total)` so a normal row (6 + 6) splits the row exactly in half
    /// while an over-authored row (7 + 7) shrinks proportionally instead of
    /// running off the screen.
    static func slotWidths(spans: [Int]) -> [CGFloat] {
        guard !spans.isEmpty else { return [] }
        let available = canvasWidth
            - 2 * gutter
            - slotSpacing * CGFloat(spans.count - 1)
        let denominator = CGFloat(max(12, spans.reduce(0, +)))
        return spans.map { max(0, available) * CGFloat($0) / denominator }
    }
}

// MARK: - CMS URL allowlists

/// Ports of `apps/tv/src/lib/validateUrl.ts`. Every link on this screen is
/// CMS-authored, so it is validated before anything is allowed to open it.
enum BlockURL {
    /// Action links (CTA buttons, quote CTAs): https only.
    ///
    /// RN also permits http under `__DEV__`; this app has no dev build, so the
    /// escape hatch is deliberately absent rather than ported as dead code.
    static func action(_ raw: String?) -> URL? {
        guard let raw = firstNonBlank(raw),
              let url = URL(string: raw),
              url.scheme?.lowercased() == "https",
              url.host != nil
        else { return nil }
        return url
    }

    /// Quiz iframes: https, default port, `nextstep.is` or a subdomain of it,
    /// and no embedded credentials.
    ///
    /// The userinfo check is the one that earns its keep:
    /// `https://evil.example@nextstep.is/` has host `nextstep.is` and would
    /// otherwise pass, while a QR of it sends a phone somewhere else.
    static func quiz(_ raw: String?) -> URL? {
        guard let url = action(raw),
              let host = url.host?.lowercased(),
              url.port == nil,
              url.user == nil,
              url.password == nil,
              host == "nextstep.is" || host.hasSuffix(".nextstep.is")
        else { return nil }
        return url
    }
}

// MARK: - Colour

enum HexColor {
    /// `#RRGGBB`, `RRGGBB`, or the 3-digit short form → 0…1 components.
    ///
    /// Returns nil rather than guessing for anything else: a mis-parsed CMS
    /// colour becomes a card-sized block of the wrong colour, and falling back
    /// to the theme surface is always the safer read.
    static func components(_ hex: String?) -> (red: Double, green: Double, blue: Double)? {
        guard var value = firstNonBlank(hex)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        else { return nil }

        if value.hasPrefix("#") { value.removeFirst() }
        if value.count == 3 {
            value = value.map { "\($0)\($0)" }.joined()
        }
        // `UInt32(_:radix:)` accepts a leading PLUS ("+01815" parses to 6165),
        // so the digit check is not redundant with the parse. A leading MINUS
        // is already rejected by the unsigned destination type — it is the
        // plus, not the minus, that this guard is here for.
        guard value.count == 6, value.allSatisfy(\.isHexDigit),
              let packed = UInt32(value, radix: 16)
        else { return nil }

        return (
            red: Double((packed >> 16) & 0xFF) / 255,
            green: Double((packed >> 8) & 0xFF) / 255,
            blue: Double(packed & 0xFF) / 255
        )
    }
}

// MARK: - Easter / Passover dates

/// The three dates the EasterDates block shows, ported from
/// `apps/tv/src/lib/easterDates.ts` + `EasterDatesRenderer.tsx`.
///
/// RN computes them Intl-free (a Hermes constraint) and formats with
/// `toLocaleDateString`. Neither half of that constraint applies here:
/// Foundation carries a real Hebrew calendar, so `@hebcal/hdate` — the RN
/// renderer's only reason for a third-party dependency — is not needed, and
/// `DateFormatter` is the direct `toLocaleDateString` equivalent.
enum EasterDates {
    /// Gregorian computus — Western (Catholic/Protestant) Easter Sunday.
    static func westernEaster(year: Int, timeZone: TimeZone = .current) -> Date? {
        let a = year % 19
        let b = year / 100
        let c = year % 100
        let d = b / 4
        let e = b % 4
        let f = (b + 8) / 25
        let g = (b - f + 1) / 3
        let h = (19 * a + b - d - g + 15) % 30
        let i = c / 4
        let k = c % 4
        let l = (32 + 2 * e + 2 * i - h - k) % 7
        let m = (a + 11 * h + 22 * l) / 451
        let month = (h + l - 7 * m + 114) / 31
        let day = ((h + l - 7 * m + 114) % 31) + 1
        return gregorianDate(year: year, month: month, day: day, timeZone: timeZone)
    }

    /// Julian computus shifted into the Gregorian calendar — Orthodox Easter.
    ///
    /// The `+ 13` can push the day past the end of its month (2024 lands on
    /// "April 35"). RN relies on `new Date(y, m, d)` normalising that to May 5;
    /// `Calendar.date(from:)` normalises identically, which is why the offset
    /// is applied to the day component instead of being pre-normalised by
    /// hand. Checked against 2024–2027: May 5, Apr 20, Apr 12, May 2.
    static func orthodoxEaster(year: Int, timeZone: TimeZone = .current) -> Date? {
        let a = year % 4
        let b = year % 7
        let c = year % 19
        let d = (19 * c + 15) % 30
        let e = (2 * a + 4 * b - d + 34) % 7
        let month = (d + e + 114) / 31
        let day = ((d + e + 114) % 31) + 1
        // Julian-to-Gregorian offset: 13 days for 1900–2099.
        return gregorianDate(year: year, month: month, day: day + 13, timeZone: timeZone)
    }

    /// 15 Nisan of the Hebrew year that contains 1 April of `year` — the same
    /// anchor `@hebcal/hdate` uses in the RN renderer.
    ///
    /// ICU's Hebrew calendar numbers months from Tishri = 1 with a FIXED slot
    /// for Adar I at 6, so Nisan is month 8 in both leap and common years; no
    /// leap-year branch is needed.
    static func passover(year: Int, timeZone: TimeZone = .current) -> Date? {
        var hebrew = Calendar(identifier: .hebrew)
        hebrew.timeZone = timeZone
        guard let april = gregorianDate(year: year, month: 4, day: 1, timeZone: timeZone) else {
            return nil
        }
        let hebrewYear = hebrew.component(.year, from: april)
        return hebrew.date(from: DateComponents(year: hebrewYear, month: 8, day: 15))
    }

    /// `toLocaleDateString(locale, { weekday, year, month, day })`.
    static func format(
        _ date: Date,
        locale: String?,
        timeZone: TimeZone = .current
    ) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = timeZone
        formatter.locale = Locale(identifier: locale ?? defaultLocale)
        // Template, not a fixed pattern: field ORDER is the locale's business,
        // and a hard-coded "EEEE, MMMM d, y" would read wrong outside en-US.
        formatter.setLocalizedDateFormatFromTemplate("EEEEyMMMMd")
        return formatter.string(from: date)
    }

    /// RN's `easterDatesTitle.replace("{year}", year)`.
    static func title(_ template: String?, year: Int) -> String? {
        guard let template else { return nil }
        return template.replacingOccurrences(of: "{year}", with: String(year))
    }

    /// RN's `section.locale ?? "en-US"`.
    static let defaultLocale = "en-US"

    private static func gregorianDate(
        year: Int,
        month: Int,
        day: Int,
        timeZone: TimeZone
    ) -> Date? {
        var gregorian = Calendar(identifier: .gregorian)
        gregorian.timeZone = timeZone
        return gregorian.date(from: DateComponents(year: year, month: month, day: day))
    }
}
