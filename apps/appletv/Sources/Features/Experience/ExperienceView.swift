import SwiftUI

/// One authored Experience page — the `/experience/[slug]` route.
///
/// The screen owns three things the blocks cannot: the scroll proxy that
/// in-page jumps target, the fullscreen player, and the QR sheet CMS links
/// open into. Everything else is the block tree.
struct ExperienceView: View {
    let slug: String
    /// Programmatic navigation rather than NavigationLink, matching HomeView:
    /// a NavigationLink card would not take focus in this composition.
    var navigate: (Route) -> Void = { _ in }

    @StateObject private var viewModel = ExperienceViewModel()
    @State private var presentedPlayback: PlayerPresentation?
    @State private var presentedLink: LinkPresentation?

    var body: some View {
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView()
                    .tint(.white)
                    .scaleEffect(1.4)
            case .failed:
                ContentUnavailableView {
                    Label("Can't load this page", systemImage: "wifi.exclamationmark")
                } description: {
                    Text("Something went wrong reaching the library.")
                } actions: {
                    Button("Retry") { Task { await viewModel.reload(slug: slug) } }
                }
            case .empty:
                // Distinct from `.failed` on purpose: the request succeeded and
                // there is simply nothing published, so "try again" would be
                // the wrong instruction — but Retry stays, because a publish
                // can land while the screen is open.
                ContentUnavailableView {
                    Label("Nothing to show yet", systemImage: "sparkles")
                } description: {
                    Text("This page has no published content.")
                } actions: {
                    Button("Retry") { Task { await viewModel.reload(slug: slug) } }
                }
            case .loaded(let title, let blocks):
                content(title: title, blocks: blocks)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background.ignoresSafeArea())
        .task { await viewModel.load(slug: slug) }
        .fullScreenCover(item: $presentedPlayback) { presentation in
            PlayerView(playbackID: presentation.playbackID)
        }
        .sheet(item: $presentedLink) { presentation in
            LinkSheet(presentation: presentation)
        }
    }

    // MARK: - Content

    /// The focus contract, and why the top of this list is not lazy.
    ///
    /// tvOS resolves a swipe GEOMETRICALLY: it looks for a focusable view
    /// along the path of travel. `.focusSection()` is documented to do NOTHING
    /// when a region has no focusable descendants, and a lazy container has
    /// materialised none at the moment of the swipe — which is how the Home
    /// screen ended up unreachable from the tab bar on real hardware.
    ///
    /// So the eager prefix runs until focus EXISTS, not merely to the first
    /// block: an Experience that opens on a paragraph would still have nothing
    /// to aim at if only block 0 were materialised. `eagerPrefixLength` is the
    /// rule, and it is asserted without a view host.
    private func content(title: String?, blocks: [ExperienceBlock]) -> some View {
        ScrollViewReader { proxy in
            let actions = blockActions(proxy)
            let eager = ExperienceProjection.eagerPrefixLength(blocks)
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 0) {
                    // Only when the page does not open on a hero: `tv-showcase`
                    // starts on a rail, and a page with no heading at all reads
                    // as a fragment of something else.
                    if let title, !opensOnHero(blocks) {
                        Text(title)
                            .font(.system(size: 56, weight: .heavy))
                            .foregroundStyle(Theme.text)
                            .padding(.horizontal, ExperienceLayout.gutter)
                            .padding(.top, 40)
                    }

                    ForEach(blocks.prefix(eager)) { block in
                        anchoredBlock(block, actions: actions)
                    }

                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(blocks.dropFirst(eager)) { block in
                            anchoredBlock(block, actions: actions)
                        }
                    }
                }
                // Lets the last block scroll clear of the bottom edge, so an
                // in-page jump to it can actually reach the top of the screen.
                .padding(.bottom, 200)
            }
        }
        .focusSection()
    }

    private func opensOnHero(_ blocks: [ExperienceBlock]) -> Bool {
        if case .videoHero = blocks.first { return true }
        return false
    }

    private func blockActions(_ proxy: ScrollViewProxy) -> BlockActions {
        BlockActions(
            navigate: navigate,
            scrollTo: { key in
                withAnimation { proxy.scrollTo(key, anchor: .top) }
            },
            play: { playbackID in
                presentedPlayback = PlayerPresentation(playbackID: playbackID)
            },
            openLink: { url, heading in
                presentedLink = LinkPresentation(url: url, heading: heading)
            }
        )
    }
}
