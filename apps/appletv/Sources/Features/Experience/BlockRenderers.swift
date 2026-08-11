import SwiftUI

// The SDUI renderers — the Swift mirror of `apps/tv/src/components/sections/*`.
//
// Three of RN's renderers are collapsed into one here (`BlockRail`):
// MediaCollection, VideoCarousel, and NavigationCarousel are the same view —
// heading copy, a horizontal shelf of poster cards, one action per card — and
// differ only in card geometry and where the heading comes from. The
// projection already normalises all three to `[RailCard]`, so keeping three
// near-identical files would only give the focus rules three places to drift
// apart. Everything else stays distinct: the quote card, the accordion, the
// date card, and the quiz CTA have genuinely different shapes.
//
// FOCUS (plan Finding 1): every shelf is a plain `HStack`, never a
// `LazyHStack`. `.focusSection()` is documented to do NOTHING when a region
// has no focusable descendants, and a lazy container has materialised none at
// the moment of a swipe — which is exactly how the Home screen ended up
// unreachable from the tab bar. The largest rail across the live `easter`,
// `christmas`, and `tv-showcase` Experiences is 14 cards, so eagerness costs
// nothing here; revisit if a rail ever grows past ~40.

// MARK: - Actions

/// What a block can ask the screen to do. Passed down explicitly rather than
/// through the environment so every renderer's capabilities are visible in its
/// signature.
struct BlockActions {
    /// Push a detail screen.
    var navigate: (Route) -> Void
    /// Jump to another block on this page, by `sectionKey`.
    var scrollTo: (String) -> Void
    /// Open fullscreen playback for a Mux playback id.
    var play: (String) -> Void
    /// Show a CMS link as a QR code — a TV cannot browse, the phone continues.
    var openLink: (URL, String) -> Void

    func perform(_ route: RailRoute?) {
        switch route {
        case .section(let key): scrollTo(key)
        case .video(let slug): navigate(.video(slug: slug))
        case .play(let playbackID): play(playbackID)
        case nil: break
        }
    }
}

// MARK: - Dispatcher

/// One case per kind, mirroring RN's `SectionDispatcher`.
///
/// `body` is `AnyView`, deliberately: sections and containers render their
/// children through this same view, and a mutually recursive `some View`
/// cannot be type-checked — the opaque type would have to contain itself. The
/// erasure costs SwiftUI's structural diffing on a page of ~20 static blocks,
/// which is the cheaper side of the trade.
struct BlockView: View {
    let block: ExperienceBlock
    let actions: BlockActions

    var body: AnyView {
        switch block {
        case .videoHero(let model):
            return AnyView(HeroBlockView(model: model, actions: actions))
        case .section(let model):
            return AnyView(SectionBlockView(model: model, actions: actions))
        case .container(let model):
            return AnyView(ContainerBlockView(model: model, actions: actions))
        case .mediaCollection(let model):
            return AnyView(
                BlockRail(
                    eyebrow: model.eyebrow,
                    title: model.title,
                    subtitle: model.subtitle,
                    cards: model.cards,
                    cardSize: model.orientation == .horizontal
                        ? CGSize(width: 420, height: 236)
                        : CGSize(width: 260, height: 347),
                    actions: actions
                )
            )
        case .videoCarousel(let model):
            return AnyView(
                BlockRail(
                    eyebrow: nil,
                    title: model.title,
                    subtitle: model.subtitle,
                    cards: model.cards,
                    // 16:9, not RN's 32:15 cinematic crop: these cards now
                    // show a Mux frame (see the projection), and a 32:15
                    // window on a 16:9 frame cuts the top and bottom off
                    // every one of them.
                    cardSize: CGSize(width: 360, height: 203),
                    actions: actions
                )
            )
        case .navigationCarousel(let model):
            return AnyView(
                BlockRail(
                    // The fragment carries no heading in either app — this
                    // rail is always titled "Stories".
                    eyebrow: nil,
                    title: "Stories",
                    subtitle: nil,
                    cards: model.cards,
                    cardSize: CGSize(width: 260, height: 300),
                    actions: actions
                )
            )
        case .text(let model):
            return AnyView(TextBlockView(model: model))
        case .easterDates(let model):
            return AnyView(EasterDatesBlockView(model: model))
        case .bibleQuotesCarousel(let model):
            return AnyView(BibleQuotesBlockView(model: model, actions: actions))
        case .cta(let model):
            return AnyView(CtaBlockView(model: model, actions: actions))
        case .relatedQuestions(let model):
            return AnyView(RelatedQuestionsBlockView(model: model, actions: actions))
        case .video(let model):
            return AnyView(VideoBlockView(model: model, actions: actions))
        case .quizButton(let model):
            return AnyView(QuizButtonBlockView(model: model, actions: actions))
        case .unsupported:
            // The parity requirement for AdventCountdownBlock: RN carries a
            // fragment and a model for it but no dispatcher case, so it draws
            // nothing there and must draw nothing here.
            return AnyView(EmptyView())
        }
    }
}

/// Attaches the scroll anchor that a NavigationCarousel item's `contentId` or
/// a MediaCollection item's `linkToSectionKey` jumps to.
///
/// `ScrollViewReader.scrollTo` addresses views by `.id`, so registration IS
/// the identifier — there is no hand-maintained position map to keep in sync
/// (RN builds one from `onLayout` callbacks at three nesting levels, plus a
/// separate index for focus transfer).
@ViewBuilder
func anchoredBlock(_ block: ExperienceBlock, actions: BlockActions) -> some View {
    if let key = block.sectionKey {
        BlockView(block: block, actions: actions).id(key)
    } else {
        BlockView(block: block, actions: actions)
    }
}

// MARK: - Shared pieces

private struct BlockHeading: View {
    @Environment(\.blockGutter) private var gutter
    let eyebrow: String?
    let title: String?
    let subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let eyebrow {
                Theme.Eyebrow(text: eyebrow)
            }
            if let title {
                Text(title)
                    .font(.system(size: 40, weight: .bold))
                    .foregroundStyle(Theme.text)
            }
            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 26))
                    .foregroundStyle(Theme.text62)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, gutter)
    }
}

/// Card/quote artwork with the authored fill as the ground beneath it.
private struct BlockArtwork: View {
    let url: URL?
    let backgroundHex: String?

    var body: some View {
        ZStack {
            Color(blockHex: backgroundHex) ?? Color(white: 0.10)
            if let url {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        Color.clear
                    }
                }
            }
        }
    }
}

// MARK: - Rails

private struct BlockRail: View {
    @Environment(\.blockGutter) private var gutter
    let eyebrow: String?
    let title: String?
    let subtitle: String?
    let cards: [RailCard]
    let cardSize: CGSize
    let actions: BlockActions

    var body: some View {
        // An empty rail draws nothing at all, matching every RN rail
        // renderer's `if (items.length === 0) return null`.
        if !cards.isEmpty {
            VStack(alignment: .leading, spacing: 20) {
                BlockHeading(eyebrow: eyebrow, title: title, subtitle: subtitle)

                ScrollView(.horizontal) {
                    HStack(alignment: .top, spacing: 32) {
                        ForEach(cards) { card in
                            RailCardView(card: card, size: cardSize, actions: actions)
                        }
                    }
                    .padding(.horizontal, gutter)
                    // Room for the `.card` focus lift; without it the scroll
                    // view clips the focused card's raised edges.
                    .padding(.vertical, 24)
                }
                .scrollClipDisabled()
                // Each shelf is its own directional target. Apple's own
                // example for `focusSection()` is exactly this shape.
                .focusSection()
            }
            .padding(.vertical, 24)
        }
    }
}

private struct RailCardView: View {
    let card: RailCard
    let size: CGSize
    let actions: BlockActions

    var body: some View {
        // A routeless card stays FOCUSABLE and inert rather than being
        // skipped: a hole in a shelf breaks directional browsing far worse
        // than a card that does nothing when selected.
        Button {
            actions.perform(card.route)
        } label: {
            ZStack(alignment: .bottomLeading) {
                BlockArtwork(url: card.imageURL, backgroundHex: card.backgroundHex)

                LinearGradient(
                    colors: [.clear, .black.opacity(0.85)],
                    startPoint: .center,
                    endPoint: .bottom
                )

                VStack(alignment: .leading, spacing: 2) {
                    if let eyebrow = card.eyebrow {
                        Text(eyebrow.uppercased())
                            .font(.system(size: 16, weight: .bold))
                            .kerning(0.8)
                            .foregroundStyle(Theme.text82)
                            .lineLimit(1)
                    }
                    Text(card.title)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(Theme.text)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                .padding(14)
            }
            .frame(width: size.width, height: size.height)
            .clipped()
            .overlay(alignment: .topTrailing) {
                if let badge = card.badge {
                    Text(badge)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.text)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 6))
                        .padding(8)
                }
            }
        }
        .buttonStyle(.card)
    }
}

// MARK: - Hero

private struct HeroBlockView: View {
    @Environment(\.blockGutter) private var gutter
    let model: ExperienceHero
    let actions: BlockActions

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            BlockArtwork(url: model.posterURL, backgroundHex: nil)
                .frame(maxWidth: .infinity)
                // Stops short of the full 1080 so the next block peeks above
                // the fold, mirroring RN's HERO_PEEK.
                .frame(height: 760)
                .clipped()

            LinearGradient(
                colors: [Theme.background.opacity(0.95), Theme.background.opacity(0.4), .clear],
                startPoint: .bottom,
                endPoint: .center
            )

            VStack(alignment: .leading, spacing: 20) {
                if let heading = model.heading {
                    Text(heading)
                        .font(.system(size: 78, weight: .heavy))
                        .foregroundStyle(Theme.text)
                        .lineLimit(2)
                }
                if let subheading = model.subheading {
                    Text(subheading)
                        .font(.system(size: 28))
                        .foregroundStyle(Theme.text82)
                        .lineLimit(2)
                        .frame(maxWidth: 1200, alignment: .leading)
                }

                // ALWAYS rendered, playable or not. RN puts an invisible
                // full-bleed Pressable here for the same reason: the hero is
                // the topmost region and the first thing laid out, so a hero
                // that drops its only control leaves the focus engine nothing
                // to aim at on a screen that has not scrolled yet.
                //
                // The copy is `ExperienceHero.ctaTitle`, not the raw authored
                // label — see its doc comment for why a stream-less hero must
                // not say "Watch now".
                Button {
                    if let playbackID = model.playbackID { actions.play(playbackID) }
                } label: {
                    Label(
                        model.ctaTitle,
                        systemImage: model.playbackID == nil ? "square.stack" : "play.fill"
                    )
                    .font(.system(size: 30, weight: .semibold))
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
            }
            .padding(.horizontal, gutter)
            .padding(.bottom, 70)
            .focusSection()
        }
    }
}

// MARK: - Inline video

private struct VideoBlockView: View {
    @Environment(\.blockGutter) private var gutter
    let model: ExperienceVideo
    let actions: BlockActions

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            BlockHeading(eyebrow: nil, title: model.title, subtitle: model.subtitle)

            Button {
                if let playbackID = model.playbackID { actions.play(playbackID) }
            } label: {
                ZStack {
                    BlockArtwork(url: model.posterURL, backgroundHex: nil)
                    LinearGradient(
                        colors: [.clear, .black.opacity(0.7)],
                        startPoint: .center,
                        endPoint: .bottom
                    )
                    Image(systemName: model.playbackID == nil ? "play.slash" : "play.circle.fill")
                        .font(.system(size: 84))
                        .foregroundStyle(.white.opacity(0.9))
                }
                // 65% of the canvas at 16:9, matching RN's TARGET_WIDTH_RATIO.
                .frame(width: 1248, height: 702)
                .clipped()
            }
            .buttonStyle(.card)
            .padding(.horizontal, gutter)
            .focusSection()
        }
        .padding(.vertical, 24)
    }
}

// MARK: - Prose

private struct TextBlockView: View {
    @Environment(\.blockGutter) private var gutter
    let model: ExperienceText

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let heading = model.heading {
                Text(heading)
                    .font(.system(size: 40, weight: .bold))
                    .foregroundStyle(Theme.text)
            }
            // RN's TextRenderer reads heading + paragraphs only, so an
            // authored subtitle silently disappears there ("Questioning?
            // Searching? …" on the live `easter` page). Rendering it is a
            // deliberate divergence — the copy was authored to be shown.
            if let subtitle = model.subtitle {
                Text(subtitle)
                    .font(.system(size: 28))
                    .foregroundStyle(Theme.text62)
            }
            ForEach(Array(model.paragraphs.enumerated()), id: \.offset) { _, paragraph in
                Text(paragraph)
                    .font(.system(size: 26))
                    .foregroundStyle(Theme.text82)
                    .lineSpacing(8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, gutter)
        .padding(.vertical, 32)
    }
}

// MARK: - CTA

private struct CtaBlockView: View {
    @Environment(\.blockGutter) private var gutter
    let model: ExperienceCta
    let actions: BlockActions

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let heading = model.heading {
                Text(heading)
                    .font(.system(size: 40, weight: .bold))
                    .foregroundStyle(Theme.text)
            }
            if let body = model.body {
                Text(body)
                    .font(.system(size: 26))
                    .foregroundStyle(Theme.text82)
            }
            if let label = model.buttonLabel {
                // Focusable even without a destination: `buttonLink` is null
                // on the live `christmas` page, and a CTA block whose only
                // control disappears is a focus dead end.
                Button {
                    if let url = model.buttonURL {
                        actions.openLink(url, "Scan to continue on your phone")
                    }
                } label: {
                    Text(label)
                        .font(.system(size: 28, weight: .semibold))
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .padding(.top, 8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, gutter)
        .padding(.vertical, 32)
        .focusSection()
    }
}

// MARK: - Easter dates

private struct EasterDatesBlockView: View {
    @Environment(\.blockGutter) private var gutter
    let model: ExperienceEasterDates

    var body: some View {
        // Computed at render time against the CURRENT year, matching RN. A
        // screen left open across New Year shows the old year until it is
        // rebuilt; that is RN's behaviour too and not worth a timer.
        let year = Calendar(identifier: .gregorian).component(.year, from: Date())

        VStack(alignment: .leading, spacing: 24) {
            if let title = EasterDates.title(model.titleTemplate, year: year) {
                Text(title)
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(Theme.text)
            }
            dateRow(model.westernLabel, EasterDates.westernEaster(year: year), primary: true)
            dateRow(model.orthodoxLabel, EasterDates.orthodoxEaster(year: year), primary: false)
            dateRow(model.passoverLabel, EasterDates.passover(year: year), primary: false)
        }
        .padding(.horizontal, 40)
        .padding(.vertical, 32)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [Theme.accent, Theme.accent.opacity(0.4)],
                startPoint: .bottomLeading,
                endPoint: .topTrailing
            ),
            in: RoundedRectangle(cornerRadius: Theme.cardRadius)
        )
        .padding(.horizontal, gutter)
        .padding(.vertical, 16)
    }

    @ViewBuilder
    private func dateRow(_ label: String?, _ date: Date?, primary: Bool) -> some View {
        if let date {
            VStack(alignment: .leading, spacing: 4) {
                if let label {
                    Text(label)
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(Theme.text62)
                }
                Text(EasterDates.format(date, locale: model.locale))
                    .font(.system(size: primary ? 30 : 24, weight: .heavy))
                    .foregroundStyle(primary ? Theme.text : Theme.text82)
            }
        }
    }
}

// MARK: - Bible quotes

private struct BibleQuotesBlockView: View {
    @Environment(\.blockGutter) private var gutter
    let model: ExperienceBibleQuotes
    let actions: BlockActions

    var body: some View {
        if !model.quotes.isEmpty {
            VStack(alignment: .leading, spacing: 20) {
                BlockHeading(eyebrow: nil, title: model.heading, subtitle: nil)

                ScrollView(.horizontal) {
                    HStack(alignment: .top, spacing: 24) {
                        ForEach(model.quotes) { quote in
                            quoteCard(quote)
                        }
                    }
                    .padding(.horizontal, gutter)
                    .padding(.vertical, 24)
                }
                .scrollClipDisabled()
                .focusSection()
            }
            .padding(.vertical, 24)
        }
    }

    private func quoteCard(_ quote: ExperienceQuote) -> some View {
        // A quote with no CTA is still a focusable card, exactly as RN's
        // FocusableCard-with-a-noop-onPress is.
        Button {
            if let url = quote.ctaURL {
                actions.openLink(url, "Scan to visit on your phone")
            }
        } label: {
            ZStack(alignment: .bottomLeading) {
                BlockArtwork(url: quote.imageURL, backgroundHex: quote.backgroundHex)

                LinearGradient(
                    colors: [.clear, Color(blockHex: quote.backgroundHex) ?? Theme.background],
                    startPoint: .center,
                    endPoint: .bottom
                )

                VStack(alignment: .leading, spacing: 6) {
                    if let attribution = quote.attribution {
                        Text(attribution.uppercased())
                            .font(.system(size: 16, weight: .heavy))
                            .kerning(0.8)
                            .foregroundStyle(Theme.text82)
                            .lineLimit(1)
                    }
                    if let reference = quote.reference {
                        Text(reference.uppercased())
                            .font(.system(size: 18, weight: .heavy))
                            .kerning(1.5)
                            .foregroundStyle(Theme.text62)
                            .lineLimit(1)
                    }
                    if let text = quote.text {
                        Text(text)
                            .font(.system(size: 25))
                            .italic()
                            .foregroundStyle(Theme.text)
                            .lineSpacing(6)
                            .lineLimit(6)
                            .multilineTextAlignment(.leading)
                    }
                    if let ctaLabel = quote.ctaLabel {
                        Text(ctaLabel)
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(Theme.text)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .background(Theme.pillFill, in: Capsule())
                            .padding(.top, 8)
                    }
                }
                .padding(20)
            }
            .frame(width: 570, height: 570)
            .clipped()
        }
        .buttonStyle(.card)
    }
}

// MARK: - Related questions

private struct RelatedQuestionsBlockView: View {
    @Environment(\.blockGutter) private var gutter
    let model: ExperienceRelatedQuestions
    let actions: BlockActions
    @State private var expandedID: String?

    /// Answer-fallback copy + destinations, ported verbatim from
    /// `apps/tv/src/lib/bibleContent.ts`. On TV both open as QR codes — the
    /// phone is the continuation surface.
    private static let fallbackBody =
        "Have a private discussion with someone who is ready to listen."
    private static let chatURL = URL(
        string: "https://chataboutjesus.com/chat/?utm_source=jesusfilm-watch"
    )
    private static let askURL = URL(
        string: "https://www.everystudent.com/contact.php?utm_source=jesusfilm-watch"
    )

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let heading = model.heading {
                Text(heading)
                    .font(.system(size: 40, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .padding(.bottom, 8)
            }

            ForEach(model.questions) { question in
                Button {
                    expandedID = expandedID == question.id ? nil : question.id
                } label: {
                    HStack {
                        Text(question.question)
                            .font(.system(size: 26, weight: .semibold))
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 24)
                        Image(systemName: expandedID == question.id ? "chevron.down" : "chevron.right")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)

                if expandedID == question.id {
                    if let answer = question.answer {
                        Text(answer)
                            .font(.system(size: 24))
                            .foregroundStyle(Theme.text82)
                            .lineSpacing(6)
                            .padding(.bottom, 12)
                    } else {
                        answerFallback
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, gutter)
        .padding(.vertical, 24)
        .focusSection()
    }

    private var answerFallback: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(Self.fallbackBody)
                .font(.system(size: 22))
                .foregroundStyle(Theme.text62)
            HStack(spacing: 16) {
                if let chatURL = Self.chatURL {
                    Button("Chat with a person") {
                        actions.openLink(chatURL, "Scan to continue on your phone")
                    }
                }
                if let askURL = Self.askURL {
                    Button("Ask a Bible question") {
                        actions.openLink(askURL, "Scan to continue on your phone")
                    }
                }
            }
            .buttonStyle(.bordered)
        }
        .padding(.bottom, 12)
    }
}

// MARK: - Quiz

private struct QuizButtonBlockView: View {
    let model: ExperienceQuizButton
    let actions: BlockActions

    /// A DELIBERATE exception to the WATCH palette, carried over from RN
    /// (`apps/tv/CLAUDE.md`: "do NOT auto-migrate it to WATCH" — a sweep did
    /// once and was reverted). Orange → Crimson Gallery primary.
    private static let gradient = [
        Color(red: 0xE8 / 255, green: 0x89 / 255, blue: 0x1C / 255),
        Color(red: 0xCB / 255, green: 0x33 / 255, blue: 0x3B / 255),
    ]

    var body: some View {
        // No allowlisted URL means no button at all — RN's silent drop. A quiz
        // CTA that opens nothing is worse than no CTA.
        if let url = model.url {
            Button {
                actions.openLink(url, "Scan to take the quiz on your phone")
            } label: {
                HStack(spacing: 16) {
                    Text("QUIZ")
                        .font(.system(size: 16, weight: .heavy))
                        .kerning(1.5)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(.white, lineWidth: 2))
                    Text(model.label)
                        .font(.system(size: 26, weight: .bold))
                        .frame(maxWidth: .infinity)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 26, weight: .bold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 24)
                .padding(.vertical, 24)
                // Half the canvas so it reads as a button, not a banner.
                .frame(width: ExperienceLayout.canvasWidth / 2)
                .background(
                    LinearGradient(colors: Self.gradient, startPoint: .leading, endPoint: .trailing),
                    in: RoundedRectangle(cornerRadius: Theme.cardRadius)
                )
            }
            .buttonStyle(.card)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
            .focusSection()
        }
    }
}

// MARK: - Nesting

private struct SectionBlockView: View {
    let model: ExperienceSection
    let actions: BlockActions

    var body: some View {
        // Nested content is never lazy. Depth is bounded by admin's schema (a
        // section cannot contain a section) and the largest live section holds
        // six children, so eager nesting keeps the focus guarantee for free.
        if !model.content.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(model.content) { child in
                    anchoredBlock(child, actions: actions)
                }
            }
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(sectionBackground)
        }
    }

    @ViewBuilder
    private var sectionBackground: some View {
        if let url = model.backgroundImageURL {
            ZStack {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        Theme.background
                    }
                }
                .clipped()
                // Scrim so authored artwork never wins against body copy.
                Theme.background.opacity(0.65)
            }
        } else {
            // RN maps every authored section colour onto ONE near-black
            // surface, so the raw `backgroundColor` is not even requested.
            Theme.background
        }
    }
}

private struct ContainerBlockView: View {
    @Environment(\.blockGutter) private var gutter
    let model: ExperienceContainer
    let actions: BlockActions

    var body: some View {
        if !model.slots.isEmpty {
            let widths = ExperienceLayout.slotWidths(spans: model.slots.map(\.span))
            HStack(alignment: .top, spacing: ExperienceLayout.slotSpacing) {
                ForEach(Array(model.slots.enumerated()), id: \.element.id) { index, slot in
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(slot.content) { child in
                            anchoredBlock(child, actions: actions)
                        }
                    }
                    .frame(width: widths[index], alignment: .leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, gutter)
            .padding(.vertical, 24)
            // The row already sits inside the screen gutter and its slot
            // widths were computed from it, so a child applying its own would
            // indent twice and overflow the slot.
            .environment(\.blockGutter, 0)
        }
    }
}

// MARK: - Link sheet

/// `sheet(item:)` needs Identifiable; the destination is the identity.
struct LinkPresentation: Identifiable {
    let url: URL
    let heading: String
    var id: String { url.absoluteString }
}

/// A CMS link handed to the phone. A TV has no browser and the Siri remote is
/// a terrible way to type a URL, so the QR is the whole interaction — the same
/// decision RN's LinkModal makes.
struct LinkSheet: View {
    let presentation: LinkPresentation
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 28) {
            Text(presentation.heading)
                .font(.system(size: 44, weight: .bold))
                .foregroundStyle(Theme.text)

            if let code = QRCode.image(for: presentation.url.absoluteString) {
                code
                    .resizable()
                    .frame(width: 420, height: 420)
                    .padding(20)
                    .background(.white, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
            }

            Text(presentation.url.absoluteString)
                .font(.system(size: 22))
                .foregroundStyle(Theme.text62)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 1000)

            Button("Done") { dismiss() }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background.ignoresSafeArea())
    }
}

// MARK: - Helpers

extension Color {
    /// CMS colours arrive as `#RRGGBB` strings; nil means "unset", which the
    /// caller resolves to a theme surface rather than to black.
    init?(blockHex: String?) {
        guard let rgb = HexColor.components(blockHex) else { return nil }
        self.init(red: rgb.red, green: rgb.green, blue: rgb.blue)
    }
}

private struct BlockGutterKey: EnvironmentKey {
    static let defaultValue = ExperienceLayout.gutter
}

extension EnvironmentValues {
    /// Horizontal screen gutter for the block currently being drawn. The
    /// container renderer sets it to 0 for its children, which is the only
    /// place a block is NOT laid out against the screen edges.
    var blockGutter: CGFloat {
        get { self[BlockGutterKey.self] }
        set { self[BlockGutterKey.self] = newValue }
    }
}
