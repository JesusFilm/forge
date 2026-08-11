import SwiftUI

/// Home: hero banner + horizontal rails off the `watch-home` Experience.
struct HomeView: View {
    @ObservedObject var viewModel: HomeViewModel
    /// Programmatic navigation instead of NavigationLink. A NavigationLink
    /// card would not take focus in this composition — descent from the tab
    /// bar died the moment cards became links, and returned when they went
    /// back to Buttons. Buttons + an explicit path keep both the routing and
    /// the focus behavior the platform actually gives us.
    var navigate: (Route) -> Void = { _ in }
    @State private var presentedPlayback: PlayerPresentation?

    var body: some View {
        // No fullscreen background INSIDE the tab content: an ignoresSafeArea
        // Color as the subtree root gave the focus container bar-overlapping
        // bounds, and the bar then refused to hand focus down (RootView owns
        // the ground color instead).
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView()
                    .tint(.white)
                    .scaleEffect(1.4)
            case .failed:
                errorView
            case .loaded(let model):
                if model.rails.isEmpty {
                    emptyView
                } else {
                    content(model)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task { await viewModel.load() }
        .fullScreenCover(item: $presentedPlayback) { presentation in
            PlayerView(playbackID: presentation.playbackID)
        }
    }

    // MARK: - Content

    /// The focus contract, and why this is not a LazyVStack from the top.
    ///
    /// tvOS resolves a swipe GEOMETRICALLY: it looks for a focusable view
    /// along the path of travel. `.focusSection()` is documented to do
    /// NOTHING when the region has no focusable descendants — and a lazy
    /// container has materialized none at the moment of the swipe. That is
    /// what made this screen unreachable from the tab bar on real hardware:
    /// the first rail happened to hold zero playable items, so the hero had
    /// no Play button, every card was non-focusable, and every later rail
    /// was still unborn inside the LazyVStack. Zero focusable descendants,
    /// so every `.focusSection()` was inert and every swipe dead-ended.
    ///
    /// The fix is structural: the hero and the FIRST rail are eager, so the
    /// screen always offers focus somewhere the moment it appears. Rails
    /// beyond the first stay lazy — by then a focused element exists and
    /// the engine has somewhere to travel from.
    private func content(_ model: HomeModel) -> some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 56) {
                if let firstRail = model.rails.first, let featured = firstRail.items.first {
                    hero(featured, rail: firstRail)
                    railView(firstRail)
                }

                LazyVStack(alignment: .leading, spacing: 56) {
                    ForEach(model.rails.dropFirst()) { rail in
                        railView(rail)
                    }
                }
            }
            .padding(.bottom, 80)
        }
        .focusSection()
    }

    // MARK: - Hero

    private func hero(_ card: VideoCard, rail: Rail) -> some View {
        // The RN hero composition: full-bleed artwork, red uppercase eyebrow,
        // big left-aligned title, description paragraph, red CTA. The scrim
        // doubles near the text so any poster stays readable.
        ZStack(alignment: .bottomLeading) {
            poster(for: card, heroWidth: true)
                .frame(maxWidth: .infinity)
                .frame(height: 620)
                .clipped()

            LinearGradient(
                colors: [Theme.background.opacity(0.95), Theme.background.opacity(0.45), .clear],
                startPoint: .bottom,
                endPoint: .center
            )
            LinearGradient(
                colors: [Theme.background.opacity(0.8), .clear],
                startPoint: .leading,
                endPoint: .center
            )

            VStack(alignment: .leading, spacing: 20) {
                Theme.Eyebrow(text: rail.eyebrow ?? "Feature Film")

                Text(card.title)
                    .font(.system(size: 76, weight: .heavy))
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)

                if let description = rail.description, !description.isEmpty {
                    Text(description)
                        .font(.system(size: 30))
                        .foregroundStyle(Theme.text82)
                        .lineLimit(3)
                        .frame(maxWidth: 900, alignment: .leading)
                }

                // ALWAYS rendered, playable or not. A conditional CTA was half
                // of why this screen had no focusable descendant at first
                // layout; a hero that silently drops its only button leaves
                // the focus engine nothing to aim at.
                heroCTA(card)
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
            }
            .padding(.horizontal, 80)
            .padding(.bottom, 70)
        }
        // No `.focusScope` here, deliberately. Scoping the hero DID bound
        // default focus as intended, but it also constrained directional
        // movement: focus landed on the CTA and DOWN could no longer reach
        // the rail beneath it. The screen only ever needed a focusable
        // element to exist at first layout — which the eager hero and first
        // rail now guarantee — not a scope telling focus where to start.
    }

    /// The hero's call to action. Always present — a hero that drops its only
    /// button when the featured item is a collection was half of why this
    /// screen had no focusable descendant at first layout.
    @ViewBuilder
    private func heroCTA(_ card: VideoCard) -> some View {
        if let slug = card.slug {
            Button {
                navigate(.video(slug: slug))
            } label: {
                heroCTALabel(card)
            }
        } else if let playbackID = card.playbackID {
            Button {
                presentedPlayback = PlayerPresentation(playbackID: playbackID)
            } label: {
                heroCTALabel(card)
            }
        } else {
            // Focusable but inert: the focus engine needs a target here even
            // when there is nowhere to go.
            Button {} label: { heroCTALabel(card) }
        }
    }

    private func heroCTALabel(_ card: VideoCard) -> some View {
        Label(
            card.playbackID == nil ? "Explore" : "Play",
            systemImage: card.playbackID == nil ? "square.stack" : "play.fill"
        )
        .font(.system(size: 30, weight: .semibold))
    }

    // MARK: - Rails

    private func railView(_ rail: Rail) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                if let eyebrow = rail.eyebrow, !eyebrow.isEmpty {
                    Theme.Eyebrow(text: eyebrow)
                }
                if !rail.title.isEmpty {
                    Text(rail.title)
                        .font(.system(size: 40, weight: .bold))
                        .foregroundStyle(Theme.text)
                }
            }
            .padding(.horizontal, 80)
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 40) {
                    ForEach(rail.items) { card in
                        cardView(card)
                    }
                }
                .padding(.horizontal, 80)
                // Room for the .card focus lift/shadow — without it the
                // scroll view clips the focused card's raised edges.
                .padding(.vertical, 24)
            }
            .scrollClipDisabled()
            // Each rail is its own directional target. Apple's own example
            // for `focusSection()` is exactly this shape: without it, a
            // swipe toward a row whose cards sit outside the projected
            // corridor finds nothing and does nothing.
            .focusSection()
        }
    }

    private func cardView(_ card: VideoCard) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let slug = card.slug {
                // Routes to the DETAIL screen, matching RN — a card press
                // opens /watch, where the viewer picks language and
                // subtitles, rather than jumping straight into playback.
                Button {
                    navigate(.video(slug: slug))
                } label: {
                    cardPoster(for: card)
                }
                // The system card style: it owns tvOS focus movement and
                // visuals end to end. Browsing must never depend on a custom
                // style whose focus read could silently stop firing.
                .buttonStyle(.card)
            } else if let playbackID = card.playbackID {
                // No slug but playable — open the player directly rather than
                // stranding a watchable video behind a missing route.
                Button {
                    presentedPlayback = PlayerPresentation(playbackID: playbackID)
                } label: {
                    cardPoster(for: card)
                }
                .buttonStyle(.card)
            } else {
                // No playback id — select is deliberately inert (no detail
                // screen yet), but the card stays FOCUSABLE: skipping holes
                // makes D-pad browsing feel broken, and focus targets are
                // what directional descent navigates by.
                Button {} label: {
                    cardPoster(for: card)
                }
                .buttonStyle(.card)
            }

            Text(card.title)
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(Theme.text82)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(width: 400, alignment: .leading)
        }
    }

    private func cardPoster(for card: VideoCard) -> some View {
        poster(for: card, heroWidth: false)
            .frame(width: 400, height: 225)
            .clipped()
    }

    /// Poster precedence per the projection: CMS image first, Mux frame as
    /// fallback. Hero requests a full-bleed render; cards stay on the 640px
    /// size the RN app keeps warm in Mux's cache.
    private func poster(for card: VideoCard, heroWidth: Bool) -> some View {
        let url = card.posterURL
            ?? MuxURL.thumbnailURL(playbackID: card.playbackID, width: heroWidth ? 1920 : 640)
        return AsyncImage(url: url) { phase in
            if let image = phase.image {
                image
                    .resizable()
                    .scaledToFill()
            } else {
                ZStack {
                    Color(white: 0.12)
                    Image(systemName: "play.rectangle")
                        .font(.largeTitle)
                        .foregroundStyle(.white.opacity(0.2))
                }
            }
        }
    }

    // MARK: - Error / empty

    // Native ContentUnavailableView, matching Search's state screens — every
    // section reports loading/empty/failure through the same system component.

    private var errorView: some View {
        ContentUnavailableView {
            Label("Can't load Home", systemImage: "wifi.exclamationmark")
        } description: {
            Text("Something went wrong reaching the library.")
        } actions: {
            Button("Retry") {
                Task { await viewModel.load() }
            }
        }
    }

    private var emptyView: some View {
        ContentUnavailableView {
            Label("Nothing to show yet", systemImage: "film.stack")
        } actions: {
            Button("Retry") {
                Task { await viewModel.load() }
            }
        }
    }
}

/// `fullScreenCover(item:)` needs Identifiable; the playback id is the
/// identity.
struct PlayerPresentation: Identifiable {
    let playbackID: String
    var id: String { playbackID }
}
