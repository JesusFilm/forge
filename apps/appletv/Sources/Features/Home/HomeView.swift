import SwiftUI

/// Home: hero banner + horizontal rails off the `watch-home` Experience.
struct HomeView: View {
    @StateObject private var viewModel = HomeViewModel()
    @State private var presentedPlayback: PlayerPresentation?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

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
        .task { await viewModel.load() }
        .fullScreenCover(item: $presentedPlayback) { presentation in
            PlayerView(playbackID: presentation.playbackID)
        }
    }

    // MARK: - Content

    private func content(_ model: HomeModel) -> some View {
        ScrollView(.vertical) {
            LazyVStack(alignment: .leading, spacing: 56) {
                if let featured = model.rails.first?.items.first {
                    hero(featured)
                }
                ForEach(model.rails) { rail in
                    railView(rail)
                }
            }
            .padding(.bottom, 80)
        }
        // The hero bleeds to the screen edge; per-row padding is applied
        // inside each rail instead of on the scroll view.
        .ignoresSafeArea(edges: .top)
    }

    // MARK: - Hero

    private func hero(_ card: VideoCard) -> some View {
        ZStack(alignment: .bottomLeading) {
            poster(for: card, heroWidth: true)
                .frame(maxWidth: .infinity)
                .frame(height: 640)
                .clipped()

            // Scrim keeps the title readable over any poster; fading to clear
            // well below the top leaves the artwork dominant.
            LinearGradient(
                colors: [.black.opacity(0.85), .black.opacity(0.35), .clear],
                startPoint: .bottom,
                endPoint: .center
            )

            VStack(alignment: .leading, spacing: 28) {
                Text(card.title)
                    .font(.system(size: 56, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(2)

                if let playbackID = card.playbackID {
                    Button {
                        presentedPlayback = PlayerPresentation(playbackID: playbackID)
                    } label: {
                        Label("Play", systemImage: "play.fill")
                            .font(.title3.weight(.semibold))
                    }
                    .buttonStyle(.borderless)
                }
            }
            .padding(.horizontal, 80)
            .padding(.bottom, 60)
        }
    }

    // MARK: - Rails

    private func railView(_ rail: Rail) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            if !rail.title.isEmpty {
                Text(rail.title)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 80)
            }
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
                .buttonStyle(.card)
            } else {
                // No playback id — nothing to open, so nothing to focus.
                cardPoster(for: card)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }

            Text(card.title)
                .font(.callout)
                .foregroundStyle(.white.opacity(0.9))
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

    private var errorView: some View {
        VStack(spacing: 32) {
            Text("Something went wrong loading Home.")
                .font(.title3)
                .foregroundStyle(.white.opacity(0.85))
            Button("Retry") {
                Task { await viewModel.load() }
            }
        }
    }

    private var emptyView: some View {
        VStack(spacing: 32) {
            Text("Nothing to show yet.")
                .font(.title3)
                .foregroundStyle(.white.opacity(0.85))
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
