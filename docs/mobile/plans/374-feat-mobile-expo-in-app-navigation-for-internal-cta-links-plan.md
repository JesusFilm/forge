---
artifactType: plan
sourceId: 374
sourceTitle: "feat(mobile-expo): in-app navigation for internal CTA links"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: "feat(mobile-expo): in-app navigation for internal CTA links"

## Objective

Not provided in source content.

## Planned approach

Not provided in source content.

## Validation

- [ ] Internal links (relative paths like `/watch`, `/watch/easter.html`) navigate within the app (e.g. to a different experience screen)
- [ ] External links (absolute URLs like `https://www.jesusfilm.org`) still open in external browser
- [ ] Detection logic: if URL starts with `/` or matches app domain → internal navigation; otherwise → `Linking.openURL`
- [ ] `CTARenderer` and `VideoHeroRenderer` both use the shared navigation helper

## References

Not provided in source content.

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
