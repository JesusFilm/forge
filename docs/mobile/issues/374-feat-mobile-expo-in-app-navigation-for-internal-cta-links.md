---
artifactType: issue
issueNumber: 374
issueTitle: "feat(mobile-expo): in-app navigation for internal CTA links"
issueUrl: "https://github.com/JesusFilm/forge/issues/374"
state: "CLOSED"
closedAt: "2026-03-11T21:52:31Z"
labels: ["enhancement", "feat"]
linkedPrs: []
scope: "mobile"
---

# Issue Artifact: #374

## Background

Not provided in source issue.

## Expected outcome

Not provided in source issue.

## Acceptance criteria

- [ ] Internal links (relative paths like `/watch`, `/watch/easter.html`) navigate within the app (e.g. to a different experience screen)
- [ ] External links (absolute URLs like `https://www.jesusfilm.org`) still open in external browser
- [ ] Detection logic: if URL starts with `/` or matches app domain → internal navigation; otherwise → `Linking.openURL`
- [ ] `CTARenderer` and `VideoHeroRenderer` both use the shared navigation helper

## Possible solution(s)

Not provided in source issue.

## References

Not provided in source issue.

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
