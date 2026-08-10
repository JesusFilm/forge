import Foundation

/// Backend endpoints. All production, all public-or-authenticated surfaces the
/// React Native TV app already exercises — this app introduces no new server
/// dependencies.
enum Config {
    /// Admin GraphQL. Content queries here are public (`experienceBySlug`,
    /// `watchSearch`); no bearer is attached in this app yet.
    static let adminGraphQLURL = URL(string: "https://admin.jesusfilm.org/api/graphql")!

    /// apps/auth — RFC 8628 device grant (feat-322).
    static let authBaseURL = URL(string: "https://auth.jesusfilm.org")!

    /// The seeded production client id for TV device sign-in.
    static let deviceClientID = "jfp_tv_production"

    /// The admin Experience the Home screen renders.
    static let homeExperienceSlug = "watch-home"

    /// Content locale for GraphQL queries — the repo-wide convention.
    static let contentLocale = "en"
}
