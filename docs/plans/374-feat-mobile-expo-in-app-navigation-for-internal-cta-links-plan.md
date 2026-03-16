---
artifactType: plan
sourceIssueNumber: 374
sourceIssueTitle: "feat(mobile-expo): in-app navigation for internal CTA links"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/374"
linkedPrs: []
---

# Plan Artifact: #374

## Objective

Not provided in source issue.

## Planned approach

Not provided in source issue.

## Validation

- [ ] Internal links (relative paths like `/watch`, `/watch/easter.html`) navigate within the app (e.g. to a different experience screen)
- [ ] External links (absolute URLs like `https://www.jesusfilm.org`) still open in external browser
- [ ] Detection logic: if URL starts with `/` or matches app domain → internal navigation; otherwise → `Linking.openURL`
- [ ] `CTARenderer` and `VideoHeroRenderer` both use the shared navigation helper

## Source links

- Issue: [#374](https://github.com/JesusFilm/forge/issues/374)
- PRs:
- None
