import SwiftUI

/// Home: hero banner + horizontal rails off the `watch-home` Experience.
struct HomeView: View {
    @ObservedObject var viewModel: HomeViewModel
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

    private func content(_ model: HomeModel) -> some View {
        ScrollView(.vertical) {
            LazyVStack(alignment: .leading, spacing: 56) {

                if let firstRail = model.rails.first, let featured = firstRail.items.first {
                    hero(featured, rail: firstRail)
                }
                ForEach(model.rails) { rail in
                    railView(rail)
                }
            }
            .padding(.bottom, 80)
        }

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

                if let playbackID = card.playbackID {
                    // Native prominent button, red via tint — the brand color
                    // rides a system style instead of a re-implemented one.
                    Button {
                        presentedPlayback = PlayerPresentation(playbackID: playbackID)
                    } label: {
                        Label("Play", systemImage: "play.fill")
                            .font(.system(size: 30, weight: .semibold))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                }
            }
            .padding(.horizontal, 80)
            .padding(.bottom, 70)
        }
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
        }
    }

    private func cardView(_ card: VideoCard) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let playbackID = card.playbackID {
                Button {
                    presentedPlayback = PlayerPresentation(playbackID: playbackID)
                } label: {
                    cardPoster(for: card)
                }
                // The system card style, not the custom one: it owns tvOS
                // focus movement + visuals end to end. The custom style is
                // reserved for chrome (pill, hero CTA) where its focus read
                // is verified working; browsing must never depend on it.
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
private struct PlayerPresentation: Identifiable {
    let playbackID: String
    var id: String { playbackID }
}
